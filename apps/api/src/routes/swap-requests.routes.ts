import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { authenticateJwt, AuthenticatedRequest } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { validateRequest } from '../middleware/validate.js';
import {
  ShiftAssignmentModel,
  ShiftModel,
  SwapRequestDoc,
  SwapRequestModel,
  UserModel,
} from '../models/index.js';
import { canManageLocation, getManagerLocationIds } from '../services/access.service.js';
import { validateAssignment } from '../services/assignmentValidator.js';
import {
  acquireReservationLock,
  buildStaffLockKey,
  releaseReservationLock,
  ResourceLockedError,
} from '../services/lock.service.js';
import {
  ACTIVE_SWAP_REQUEST_STATUSES,
  APPROVAL_READY_SWAP_STATUSES,
  SwapServiceError,
  calculateDropExpiryUtc,
  countActiveSwapRequestsForStaff,
  dispatchSwapLifecycle,
} from '../services/swap.service.js';
import { recordAuditLog } from '../services/audit.service.js';

const createSwapRequestSchema = z.object({
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  body: z.object({
    type: z.enum(['swap', 'drop']),
    shiftId: z.string().min(1),
    toStaffId: z.string().optional(),
    note: z.string().max(500).optional(),
  }),
});

const requestIdSchema = z.object({
  query: z.object({}).optional().default({}),
  body: z.object({}).optional().default({}),
  params: z.object({
    id: z.string().min(1),
  }),
});

const cancelSwapRequestSchema = z.object({
  query: z.object({}).optional().default({}),
  body: z.object({
    reason: z.string().max(500).optional(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

const rejectSwapRequestSchema = z.object({
  query: z.object({}).optional().default({}),
  body: z.object({
    reason: z.string().min(1).max(500),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

const listSwapRequestsSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    mine: z.union([z.string(), z.boolean()]).optional(),
    available: z.union([z.string(), z.boolean()]).optional(),
    managerInbox: z.union([z.string(), z.boolean()]).optional(),
  }),
});

const eligibleStaffSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    shiftId: z.string().min(1),
  }),
});

type SwapLeanDoc = SwapRequestDoc & { _id: Types.ObjectId };

type ShiftLeanDoc = {
  _id: Types.ObjectId;
  locationId: Types.ObjectId;
  timezone: string;
  title: string;
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
  startAtUtc: string;
  endAtUtc: string;
  requiredSkill?: string;
  published: boolean;
};

const toObjectId = (value: unknown): Types.ObjectId | null => {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    return null;
  }

  return new Types.ObjectId(value);
};

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return false;
  }

  return value === '1' || value.toLowerCase() === 'true';
};

const isDropExpired = (request: SwapLeanDoc, shiftStartAtUtc: string): boolean => {
  const now = DateTime.utc();
  const shiftStart = DateTime.fromISO(shiftStartAtUtc, { zone: 'utc' });
  const within24Hours = shiftStart.diff(now, 'hours').hours <= 24;
  const explicitExpiryReached = DateTime.fromJSDate(request.expiresAtUtc, { zone: 'utc' }) <= now;

  return within24Hours || explicitExpiryReached;
};

const assertCanManageSwapRequest = async (req: AuthenticatedRequest, locationId: string): Promise<void> => {
  if (!req.user) {
    throw new SwapServiceError(401, 'unauthorized', 'Unauthorized');
  }

  if (req.user.role === 'admin') {
    return;
  }

  const allowed = await canManageLocation(req.user, locationId);
  if (!allowed) {
    throw new SwapServiceError(403, 'forbidden', 'Cannot manage swap requests for this location');
  }
};

const loadSwapRequestAndShift = async (requestId: Types.ObjectId): Promise<{
  request: SwapLeanDoc;
  shift: ShiftLeanDoc;
}> => {
  const request = (await SwapRequestModel.findById(requestId)
    .select('_id type shiftId fromStaffId toStaffId status note expiresAtUtc createdAt updatedAt')
    .lean()) as SwapLeanDoc | null;

  if (!request) {
    throw new SwapServiceError(404, 'swap_request_not_found', 'Swap request not found');
  }

  const shift = (await ShiftModel.findById(request.shiftId)
    .select(
      '_id locationId timezone title localDate startLocalTime endLocalTime startAtUtc endAtUtc requiredSkill published',
    )
    .lean()) as ShiftLeanDoc | null;

  if (!shift) {
    throw new SwapServiceError(404, 'shift_not_found', 'Shift for swap request no longer exists');
  }

  return { request, shift };
};

const toSwapRequestView = async (requests: SwapLeanDoc[]) => {
  if (requests.length === 0) {
    return [];
  }

  const shiftIds = Array.from(new Set(requests.map((request) => request.shiftId.toString()))).map(
    (id) => new Types.ObjectId(id),
  );
  const staffIds = Array.from(
    new Set(
      requests.flatMap((request) => [
        request.fromStaffId.toString(),
        ...(request.toStaffId ? [request.toStaffId.toString()] : []),
      ]),
    ),
  ).map((id) => new Types.ObjectId(id));

  const [shifts, users] = await Promise.all([
    ShiftModel.find({ _id: { $in: shiftIds } })
      .select('_id locationId timezone title localDate startLocalTime endLocalTime startAtUtc endAtUtc published')
      .lean(),
    UserModel.find({ _id: { $in: staffIds } }).select('_id firstName lastName email').lean(),
  ]);

  const shiftById = new Map(shifts.map((shift) => [shift._id.toString(), shift]));
  const userById = new Map(users.map((user) => [user._id.toString(), user]));

  return requests
    .map((request) => {
      const shift = shiftById.get(request.shiftId.toString());
      if (!shift) {
        return null;
      }

      const fromStaff = userById.get(request.fromStaffId.toString());
      const toStaff = request.toStaffId ? userById.get(request.toStaffId.toString()) : null;

      return {
        _id: request._id.toString(),
        type: request.type,
        status: request.status,
        note: request.note,
        expiresAtUtc: request.expiresAtUtc.toISOString(),
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
        shift: {
          _id: shift._id.toString(),
          locationId: shift.locationId.toString(),
          timezone: shift.timezone,
          title: shift.title,
          localDate: shift.localDate,
          startLocalTime: shift.startLocalTime,
          endLocalTime: shift.endLocalTime,
          startAtUtc: shift.startAtUtc,
          endAtUtc: shift.endAtUtc,
          published: shift.published,
        },
        fromStaff: {
          id: request.fromStaffId.toString(),
          name: fromStaff ? `${fromStaff.firstName} ${fromStaff.lastName}` : 'Unknown Staff',
          email: fromStaff?.email ?? null,
        },
        toStaff: request.toStaffId
          ? {
              id: request.toStaffId.toString(),
              name: toStaff ? `${toStaff.firstName} ${toStaff.lastName}` : 'Unknown Staff',
              email: toStaff?.email ?? null,
            }
          : null,
      };
    })
    .filter((request): request is NonNullable<typeof request> => Boolean(request));
};

const auditSwapStatusChange = async (args: {
  actorId: string;
  action: string;
  requestBefore: SwapLeanDoc;
  requestAfter: SwapLeanDoc;
  locationId: Types.ObjectId;
  reason?: string;
  session?: mongoose.ClientSession;
}) => {
  await recordAuditLog({
    actorId: args.actorId,
    action: args.action,
    entityType: 'swap_request',
    entityId: args.requestAfter._id.toString(),
    locationId: args.locationId,
    beforeSnapshot: {
      type: args.requestBefore.type,
      status: args.requestBefore.status,
      shiftId: args.requestBefore.shiftId.toString(),
      fromStaffId: args.requestBefore.fromStaffId.toString(),
      toStaffId: args.requestBefore.toStaffId?.toString() ?? null,
      note: args.requestBefore.note ?? null,
      expiresAtUtc: args.requestBefore.expiresAtUtc.toISOString(),
    },
    afterSnapshot: {
      type: args.requestAfter.type,
      status: args.requestAfter.status,
      shiftId: args.requestAfter.shiftId.toString(),
      fromStaffId: args.requestAfter.fromStaffId.toString(),
      toStaffId: args.requestAfter.toStaffId?.toString() ?? null,
      note: args.requestAfter.note ?? null,
      expiresAtUtc: args.requestAfter.expiresAtUtc.toISOString(),
    },
    payload: {
      shiftId: args.requestAfter.shiftId.toString(),
      ...(args.reason ? { reason: args.reason } : {}),
    },
    session: args.session,
  });
};

export const swapRequestsRouter = Router();

swapRequestsRouter.get(
  '/eligible-staff',
  authenticateJwt,
  requireRoles('staff'),
  validateRequest(eligibleStaffSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ code: 'unauthorized', message: 'Unauthorized' });
      return;
    }

    const shiftObjectId = toObjectId(req.query.shiftId);
    if (!shiftObjectId) {
      res.status(400).json({
        code: 'invalid_shift_id',
        message: 'Invalid shiftId',
      });
      return;
    }

    const fromStaffId = new Types.ObjectId(user.userId);

    const assignment = await ShiftAssignmentModel.findOne({
      shiftId: shiftObjectId,
      staffId: fromStaffId,
      status: 'assigned',
    })
      .select('_id')
      .lean();

    if (!assignment) {
      res.status(403).json({
        code: 'assignment_required',
        message: 'You must be assigned to this shift to request a swap',
      });
      return;
    }

    const validation = await validateAssignment({
      shiftId: shiftObjectId.toString(),
      staffId: fromStaffId.toString(),
      actorId: user.userId,
    });

    res.json({
      suggestions: validation.suggestions,
      violations: validation.violations,
    });
  },
);

swapRequestsRouter.post(
  '/',
  authenticateJwt,
  requireRoles('staff'),
  validateRequest(createSwapRequestSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ code: 'unauthorized', message: 'Unauthorized' });
      return;
    }

    const { type, note } = req.body;
    const shiftObjectId = toObjectId(req.body.shiftId);

    if (!shiftObjectId) {
      res.status(400).json({ code: 'invalid_shift_id', message: 'Invalid shiftId' });
      return;
    }

    const fromStaffId = new Types.ObjectId(user.userId);
    const shift = (await ShiftModel.findById(shiftObjectId)
      .select(
        '_id locationId timezone title localDate startLocalTime endLocalTime startAtUtc endAtUtc requiredSkill published',
      )
      .lean()) as ShiftLeanDoc | null;

    if (!shift) {
      res.status(404).json({ code: 'shift_not_found', message: 'Shift not found' });
      return;
    }

    const assignment = await ShiftAssignmentModel.findOne({
      shiftId: shiftObjectId,
      staffId: fromStaffId,
      status: 'assigned',
    })
      .select('_id')
      .lean();

    if (!assignment) {
      res.status(403).json({
        code: 'assignment_required',
        message: 'You must be assigned to this shift to request a swap or drop',
      });
      return;
    }

    const existingActiveRequest = await SwapRequestModel.exists({
      shiftId: shiftObjectId,
      fromStaffId,
      status: { $in: ACTIVE_SWAP_REQUEST_STATUSES },
    });

    if (existingActiveRequest) {
      res.status(409).json({
        code: 'request_already_active',
        message: 'You already have an active swap/drop request for this shift',
      });
      return;
    }

    const activeCount = await countActiveSwapRequestsForStaff(fromStaffId);
    if (activeCount >= 3) {
      res.status(409).json({
        code: 'pending_limit_reached',
        message: 'You cannot have more than 3 pending swap or drop requests',
        details: {
          limit: 3,
          current: activeCount,
        },
      });
      return;
    }

    const hoursUntilStart = DateTime.fromISO(shift.startAtUtc, { zone: 'utc' }).diffNow('hours').hours;
    if (hoursUntilStart <= 0) {
      res.status(409).json({
        code: 'shift_already_started',
        message: 'Cannot create requests for shifts that already started',
      });
      return;
    }

    let toStaffId: Types.ObjectId | undefined;

    if (type === 'swap') {
      toStaffId = toObjectId(req.body.toStaffId) ?? undefined;

      if (!toStaffId) {
        res.status(400).json({
          code: 'to_staff_required',
          message: 'toStaffId is required for swap requests',
        });
        return;
      }

      if (toStaffId.equals(fromStaffId)) {
        res.status(400).json({
          code: 'invalid_swap_target',
          message: 'Cannot request a swap with yourself',
        });
        return;
      }

      const validation = await validateAssignment({
        shiftId: shiftObjectId.toString(),
        staffId: toStaffId.toString(),
        actorId: user.userId,
      });

      if (!validation.ok) {
        res.status(409).json({
          code: 'swap_candidate_not_eligible',
          message: 'Selected staff member is not eligible for this shift',
          details: {
            violations: validation.violations,
            suggestions: validation.suggestions,
          },
        });
        return;
      }
    }

    if (type === 'drop' && hoursUntilStart <= 24) {
      res.status(409).json({
        code: 'drop_window_closed',
        message: 'Drop requests must be created more than 24 hours before shift start',
      });
      return;
    }

    const swapRequest = await SwapRequestModel.create({
      type,
      shiftId: shiftObjectId,
      fromStaffId,
      ...(toStaffId ? { toStaffId } : {}),
      status: 'pending',
      expiresAtUtc: type === 'drop' ? calculateDropExpiryUtc(shift.startAtUtc) : new Date(shift.startAtUtc),
      ...(note ? { note } : {}),
    });

    await recordAuditLog({
      actorId: user.userId,
      action: 'swap_request_created',
      entityType: 'swap_request',
      entityId: swapRequest._id.toString(),
      locationId: shift.locationId,
      beforeSnapshot: null,
      afterSnapshot: {
        type: swapRequest.type,
        status: swapRequest.status,
        shiftId: swapRequest.shiftId.toString(),
        fromStaffId: swapRequest.fromStaffId.toString(),
        toStaffId: swapRequest.toStaffId?.toString() ?? null,
        note: swapRequest.note ?? null,
        expiresAtUtc: swapRequest.expiresAtUtc.toISOString(),
      },
      payload: {
        shiftId: shift._id.toString(),
      },
    });

    await dispatchSwapLifecycle({
      io: req.app.get('io'),
      swapRequest: {
        _id: swapRequest._id,
        type: swapRequest.type,
        shiftId: swapRequest.shiftId,
        fromStaffId: swapRequest.fromStaffId,
        toStaffId: swapRequest.toStaffId,
        status: swapRequest.status,
        note: swapRequest.note,
        expiresAtUtc: swapRequest.expiresAtUtc,
      },
      shift,
      actorId: user.userId,
      action: 'requested',
      reason: swapRequest.note,
    });

    const [hydrated] = await toSwapRequestView([
      (await SwapRequestModel.findById(swapRequest._id).lean()) as SwapLeanDoc,
    ]);

    res.status(201).json({ swapRequest: hydrated });
  },
);

swapRequestsRouter.post(
  '/:id/accept',
  authenticateJwt,
  requireRoles('staff'),
  validateRequest(requestIdSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ code: 'unauthorized', message: 'Unauthorized' });
      return;
    }

    const requestObjectId = toObjectId(req.params.id);
    if (!requestObjectId) {
      res.status(400).json({ code: 'invalid_swap_request_id', message: 'Invalid swap request id' });
      return;
    }

    let loaded: Awaited<ReturnType<typeof loadSwapRequestAndShift>>;
    try {
      loaded = await loadSwapRequestAndShift(requestObjectId);
    } catch (error) {
      if (error instanceof SwapServiceError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message,
        });
        return;
      }
      throw error;
    }

    const { request, shift } = loaded;

    if (request.type !== 'swap') {
      res.status(409).json({
        code: 'invalid_request_type',
        message: 'Only swap requests can be accepted',
      });
      return;
    }

    if (request.status !== 'pending') {
      res.status(409).json({
        code: 'invalid_swap_status',
        message: 'Only pending swap requests can be accepted',
      });
      return;
    }

    if (!request.toStaffId || request.toStaffId.toString() !== user.userId) {
      res.status(403).json({
        code: 'forbidden',
        message: 'Only the targeted staff member can accept this swap request',
      });
      return;
    }

    const validation = await validateAssignment({
      shiftId: request.shiftId.toString(),
      staffId: user.userId,
      actorId: user.userId,
    });

    if (!validation.ok) {
      res.status(409).json({
        code: 'swap_candidate_not_eligible',
        message: 'You are no longer eligible for this shift',
        details: {
          violations: validation.violations,
          suggestions: validation.suggestions,
        },
      });
      return;
    }

    const accepted = (await SwapRequestModel.findOneAndUpdate(
      {
        _id: requestObjectId,
        type: 'swap',
        status: 'pending',
        toStaffId: new Types.ObjectId(user.userId),
      },
      {
        $set: {
          status: 'accepted',
        },
      },
      { new: true },
    ).lean()) as SwapLeanDoc | null;

    if (!accepted) {
      res.status(409).json({
        code: 'swap_state_changed',
        message: 'Swap request is no longer pending',
      });
      return;
    }

    await auditSwapStatusChange({
      actorId: user.userId,
      action: 'swap_request_accepted',
      requestBefore: request,
      requestAfter: accepted,
      locationId: shift.locationId,
      reason: accepted.note,
    });

    await dispatchSwapLifecycle({
      io: req.app.get('io'),
      swapRequest: {
        _id: accepted._id,
        type: accepted.type,
        shiftId: accepted.shiftId,
        fromStaffId: accepted.fromStaffId,
        toStaffId: accepted.toStaffId,
        status: accepted.status,
        note: accepted.note,
        expiresAtUtc: accepted.expiresAtUtc,
      },
      shift,
      actorId: user.userId,
      action: 'accepted',
      reason: accepted.note,
    });

    const [hydrated] = await toSwapRequestView([accepted]);
    res.json({ swapRequest: hydrated });
  },
);

swapRequestsRouter.post(
  '/:id/claim',
  authenticateJwt,
  requireRoles('staff'),
  validateRequest(requestIdSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ code: 'unauthorized', message: 'Unauthorized' });
      return;
    }

    const requestObjectId = toObjectId(req.params.id);
    if (!requestObjectId) {
      res.status(400).json({ code: 'invalid_swap_request_id', message: 'Invalid swap request id' });
      return;
    }

    let loaded: Awaited<ReturnType<typeof loadSwapRequestAndShift>>;
    try {
      loaded = await loadSwapRequestAndShift(requestObjectId);
    } catch (error) {
      if (error instanceof SwapServiceError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message,
        });
        return;
      }
      throw error;
    }

    const { request, shift } = loaded;

    if (request.type !== 'drop') {
      res.status(409).json({
        code: 'invalid_request_type',
        message: 'Only drop requests can be claimed',
      });
      return;
    }

    if (request.status !== 'pending') {
      res.status(409).json({
        code: 'invalid_swap_status',
        message: 'Only pending drop requests can be claimed',
      });
      return;
    }

    if (request.fromStaffId.toString() === user.userId) {
      res.status(409).json({
        code: 'invalid_drop_claimer',
        message: 'You cannot claim your own drop request',
      });
      return;
    }

    if (isDropExpired(request, shift.startAtUtc)) {
      const expired = (await SwapRequestModel.findOneAndUpdate(
        {
          _id: requestObjectId,
          status: 'pending',
          type: 'drop',
        },
        {
          $set: {
            status: 'expired',
            note: 'Drop request expired before claim/approval.',
          },
        },
        { new: true },
      ).lean()) as SwapLeanDoc | null;

      if (expired) {
        await auditSwapStatusChange({
          actorId: 'swap-expiry-guard',
          action: 'swap_request_expired',
          requestBefore: request,
          requestAfter: expired,
          locationId: shift.locationId,
          reason: expired.note,
        });

        await dispatchSwapLifecycle({
          io: req.app.get('io'),
          swapRequest: {
            _id: expired._id,
            type: expired.type,
            shiftId: expired.shiftId,
            fromStaffId: expired.fromStaffId,
            toStaffId: expired.toStaffId,
            status: expired.status,
            note: expired.note,
            expiresAtUtc: expired.expiresAtUtc,
          },
          shift,
          actorId: 'swap-expiry-guard',
          action: 'expired',
          reason: expired.note,
        });
      }

      res.status(409).json({
        code: 'drop_request_expired',
        message: 'Drop request is expired and cannot be claimed',
      });
      return;
    }

    const validation = await validateAssignment({
      shiftId: request.shiftId.toString(),
      staffId: user.userId,
      actorId: user.userId,
    });

    if (!validation.ok) {
      res.status(409).json({
        code: 'drop_claim_not_eligible',
        message: 'You are not eligible to claim this shift',
        details: {
          violations: validation.violations,
          suggestions: validation.suggestions,
        },
      });
      return;
    }

    const claimed = (await SwapRequestModel.findOneAndUpdate(
      {
        _id: requestObjectId,
        type: 'drop',
        status: 'pending',
      },
      {
        $set: {
          status: 'claimed',
          toStaffId: new Types.ObjectId(user.userId),
        },
      },
      { new: true },
    ).lean()) as SwapLeanDoc | null;

    if (!claimed) {
      res.status(409).json({
        code: 'swap_state_changed',
        message: 'Drop request is no longer claimable',
      });
      return;
    }

    await auditSwapStatusChange({
      actorId: user.userId,
      action: 'drop_request_claimed',
      requestBefore: request,
      requestAfter: claimed,
      locationId: shift.locationId,
      reason: claimed.note,
    });

    await dispatchSwapLifecycle({
      io: req.app.get('io'),
      swapRequest: {
        _id: claimed._id,
        type: claimed.type,
        shiftId: claimed.shiftId,
        fromStaffId: claimed.fromStaffId,
        toStaffId: claimed.toStaffId,
        status: claimed.status,
        note: claimed.note,
        expiresAtUtc: claimed.expiresAtUtc,
      },
      shift,
      actorId: user.userId,
      action: 'claimed',
      reason: claimed.note,
    });

    const [hydrated] = await toSwapRequestView([claimed]);
    res.json({ swapRequest: hydrated });
  },
);

swapRequestsRouter.post(
  '/:id/cancel',
  authenticateJwt,
  requireRoles('staff'),
  validateRequest(cancelSwapRequestSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ code: 'unauthorized', message: 'Unauthorized' });
      return;
    }

    const requestObjectId = toObjectId(req.params.id);
    if (!requestObjectId) {
      res.status(400).json({ code: 'invalid_swap_request_id', message: 'Invalid swap request id' });
      return;
    }

    let loaded: Awaited<ReturnType<typeof loadSwapRequestAndShift>>;
    try {
      loaded = await loadSwapRequestAndShift(requestObjectId);
    } catch (error) {
      if (error instanceof SwapServiceError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message,
        });
        return;
      }
      throw error;
    }

    const { request, shift } = loaded;

    if (request.fromStaffId.toString() !== user.userId) {
      res.status(403).json({
        code: 'forbidden',
        message: 'Only the request creator can cancel this request',
      });
      return;
    }

    if (!ACTIVE_SWAP_REQUEST_STATUSES.includes(request.status)) {
      res.status(409).json({
        code: 'invalid_swap_status',
        message: 'Only pending or awaiting-approval requests can be cancelled',
      });
      return;
    }

    const reason = req.body.reason?.trim() || 'Cancelled by requester';

    const cancelled = (await SwapRequestModel.findOneAndUpdate(
      {
        _id: requestObjectId,
        status: { $in: ACTIVE_SWAP_REQUEST_STATUSES },
      },
      {
        $set: {
          status: 'cancelled',
          note: reason,
        },
      },
      { new: true },
    ).lean()) as SwapLeanDoc | null;

    if (!cancelled) {
      res.status(409).json({
        code: 'swap_state_changed',
        message: 'Swap request is no longer cancellable',
      });
      return;
    }

    await auditSwapStatusChange({
      actorId: user.userId,
      action: 'swap_request_cancelled',
      requestBefore: request,
      requestAfter: cancelled,
      locationId: shift.locationId,
      reason,
    });

    await dispatchSwapLifecycle({
      io: req.app.get('io'),
      swapRequest: {
        _id: cancelled._id,
        type: cancelled.type,
        shiftId: cancelled.shiftId,
        fromStaffId: cancelled.fromStaffId,
        toStaffId: cancelled.toStaffId,
        status: cancelled.status,
        note: cancelled.note,
        expiresAtUtc: cancelled.expiresAtUtc,
      },
      shift,
      actorId: user.userId,
      action: 'cancelled',
      reason,
    });

    const [hydrated] = await toSwapRequestView([cancelled]);
    res.json({ swapRequest: hydrated });
  },
);

swapRequestsRouter.post(
  '/:id/approve',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(requestIdSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ code: 'unauthorized', message: 'Unauthorized' });
      return;
    }

    const requestObjectId = toObjectId(req.params.id);
    if (!requestObjectId) {
      res.status(400).json({ code: 'invalid_swap_request_id', message: 'Invalid swap request id' });
      return;
    }

    let lockHandles: Awaited<ReturnType<typeof acquireReservationLock>>[] = [];
    let session: mongoose.ClientSession | null = null;

    let approvedRequest: SwapLeanDoc | null = null;
    let shift: ShiftLeanDoc | null = null;
    let assignmentSummary:
      | {
          assignmentId: string;
          shiftId: string;
          locationId: string;
          fromStaffId: string;
          toStaffId: string;
        }
      | null = null;

    try {
      const loaded = await loadSwapRequestAndShift(requestObjectId);
      shift = loaded.shift;

      await assertCanManageSwapRequest(req, loaded.shift.locationId.toString());

      if (!APPROVAL_READY_SWAP_STATUSES.includes(loaded.request.status)) {
        throw new SwapServiceError(
          409,
          'invalid_swap_status',
          'Swap request must be accepted or claimed before approval',
        );
      }

      if (!loaded.request.toStaffId) {
        throw new SwapServiceError(
          409,
          'missing_swap_target',
          'Swap request cannot be approved without a target staff member',
        );
      }

      const lockOwner = `${user.userId}:${Date.now()}:${new Types.ObjectId().toString()}`;
      const lockKeys = [
        buildStaffLockKey(loaded.request.fromStaffId.toString()),
        buildStaffLockKey(loaded.request.toStaffId.toString()),
      ].sort();

      for (const key of lockKeys) {
        const lock = await acquireReservationLock({
          key,
          owner: lockOwner,
          ttlSeconds: 20,
        });
        lockHandles = [...lockHandles, lock];
      }

      session = await mongoose.startSession();
      session.startTransaction();

      try {
        const txRequest = (await SwapRequestModel.findById(requestObjectId)
          .session(session)
          .select('_id type shiftId fromStaffId toStaffId status note expiresAtUtc createdAt updatedAt')
          .lean()) as SwapLeanDoc | null;

        if (!txRequest) {
          throw new SwapServiceError(404, 'swap_request_not_found', 'Swap request not found');
        }

        if (!APPROVAL_READY_SWAP_STATUSES.includes(txRequest.status)) {
          throw new SwapServiceError(
            409,
            'invalid_swap_status',
            'Swap request is no longer awaiting manager approval',
          );
        }

        if (!txRequest.toStaffId) {
          throw new SwapServiceError(
            409,
            'missing_swap_target',
            'Swap request no longer has a valid target staff member',
          );
        }

        const txShift = (await ShiftModel.findById(txRequest.shiftId)
          .session(session)
          .select(
            '_id locationId timezone title localDate startLocalTime endLocalTime startAtUtc endAtUtc requiredSkill published',
          )
          .lean()) as ShiftLeanDoc | null;

        if (!txShift) {
          throw new SwapServiceError(404, 'shift_not_found', 'Shift not found');
        }

        const validation = await validateAssignment({
          shiftId: txShift._id.toString(),
          staffId: txRequest.toStaffId.toString(),
          actorId: user.userId,
          session,
        });

        if (!validation.ok) {
          throw new SwapServiceError(
            409,
            'assignment_constraints_failed',
            'Target staff is no longer eligible for this shift',
            {
              violations: validation.violations,
              suggestions: validation.suggestions,
            },
          );
        }

        const assignment = await ShiftAssignmentModel.findOne({
          shiftId: txShift._id,
          staffId: txRequest.fromStaffId,
          status: 'assigned',
        })
          .session(session)
          .select('_id shiftId staffId')
          .lean();

        if (!assignment) {
          throw new SwapServiceError(
            409,
            'assignment_not_found',
            'Original assignment no longer exists for this shift',
          );
        }

        await ShiftAssignmentModel.updateOne(
          {
            _id: assignment._id,
            shiftId: txShift._id,
            staffId: txRequest.fromStaffId,
            status: 'assigned',
          },
          {
            $set: {
              staffId: txRequest.toStaffId,
              assignedBy: new Types.ObjectId(user.userId),
            },
          },
          { session },
        );

        await SwapRequestModel.updateOne(
          {
            _id: requestObjectId,
            status: { $in: APPROVAL_READY_SWAP_STATUSES },
          },
          {
            $set: {
              status: 'approved',
            },
          },
          { session },
        );

        const approvedInTx = {
          ...txRequest,
          status: 'approved' as const,
        };

        await auditSwapStatusChange({
          actorId: user.userId,
          action: 'swap_request_approved',
          requestBefore: txRequest,
          requestAfter: approvedInTx,
          locationId: txShift.locationId,
          session,
        });

        await recordAuditLog({
          actorId: user.userId,
          action: 'assignment_reassigned_via_swap_approval',
          entityType: 'shift_assignment',
          entityId: assignment._id.toString(),
          locationId: txShift.locationId,
          beforeSnapshot: {
            shiftId: assignment.shiftId.toString(),
            staffId: txRequest.fromStaffId.toString(),
            status: 'assigned',
          },
          afterSnapshot: {
            shiftId: assignment.shiftId.toString(),
            staffId: txRequest.toStaffId.toString(),
            status: 'assigned',
          },
          payload: {
            shiftId: txShift._id.toString(),
            swapRequestId: txRequest._id.toString(),
            fromStaffId: txRequest.fromStaffId.toString(),
            toStaffId: txRequest.toStaffId.toString(),
          },
          session,
        });

        await session.commitTransaction();

        approvedRequest = (await SwapRequestModel.findById(requestObjectId)
          .select('_id type shiftId fromStaffId toStaffId status note expiresAtUtc createdAt updatedAt')
          .lean()) as SwapLeanDoc | null;

        shift = txShift;
        assignmentSummary = {
          assignmentId: assignment._id.toString(),
          shiftId: txShift._id.toString(),
          locationId: txShift.locationId.toString(),
          fromStaffId: txRequest.fromStaffId.toString(),
          toStaffId: txRequest.toStaffId.toString(),
        };
      } catch (txError) {
        await session.abortTransaction();
        throw txError;
      }
    } catch (error: unknown) {
      if (error instanceof ResourceLockedError) {
        res.status(409).json({
          code: 'conflict_detected',
          message: 'Swap approval conflict detected. Another operation is updating these staff assignments.',
        });
        return;
      }

      if (error instanceof SwapServiceError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        });
        return;
      }

      const maybeMongo = error as { code?: number };
      if (maybeMongo.code === 11000) {
        res.status(409).json({
          code: 'conflict_detected',
          message: 'Approval failed due to a concurrent assignment update',
        });
        return;
      }

      throw error;
    } finally {
      if (session) {
        await session.endSession();
      }

      for (const lock of lockHandles) {
        try {
          await releaseReservationLock(lock);
        } catch {
          // Lock TTL is short; ignore release failures to avoid masking primary result.
        }
      }
    }

    if (!approvedRequest || !shift || !assignmentSummary) {
      res.status(500).json({
        code: 'approval_persist_failed',
        message: 'Approval result could not be persisted',
      });
      return;
    }

    await dispatchSwapLifecycle({
      io: req.app.get('io'),
      swapRequest: {
        _id: approvedRequest._id,
        type: approvedRequest.type,
        shiftId: approvedRequest.shiftId,
        fromStaffId: approvedRequest.fromStaffId,
        toStaffId: approvedRequest.toStaffId,
        status: approvedRequest.status,
        note: approvedRequest.note,
        expiresAtUtc: approvedRequest.expiresAtUtc,
      },
      shift,
      actorId: user.userId,
      action: 'approved',
      reason: approvedRequest.note,
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`location:${assignmentSummary.locationId}`).emit('assignment_removed', {
        assignmentId: assignmentSummary.assignmentId,
        shiftId: assignmentSummary.shiftId,
        staffId: assignmentSummary.fromStaffId,
        locationId: assignmentSummary.locationId,
        removedBy: user.userId,
        occurredAtUtc: new Date().toISOString(),
      });

      io.to(`user:${assignmentSummary.fromStaffId}`).emit('assignment_removed', {
        assignmentId: assignmentSummary.assignmentId,
        shiftId: assignmentSummary.shiftId,
        staffId: assignmentSummary.fromStaffId,
        locationId: assignmentSummary.locationId,
        removedBy: user.userId,
        occurredAtUtc: new Date().toISOString(),
      });

      io.to(`location:${assignmentSummary.locationId}`).emit('assignment_created', {
        assignmentId: assignmentSummary.assignmentId,
        shiftId: assignmentSummary.shiftId,
        staffId: assignmentSummary.toStaffId,
        locationId: assignmentSummary.locationId,
        assignedBy: user.userId,
        createdAtUtc: new Date().toISOString(),
      });

      io.to(`user:${assignmentSummary.toStaffId}`).emit('assignment_created', {
        assignmentId: assignmentSummary.assignmentId,
        shiftId: assignmentSummary.shiftId,
        staffId: assignmentSummary.toStaffId,
        locationId: assignmentSummary.locationId,
        assignedBy: user.userId,
        createdAtUtc: new Date().toISOString(),
      });
    }

    const [hydrated] = await toSwapRequestView([approvedRequest]);
    res.json({ swapRequest: hydrated });
  },
);

swapRequestsRouter.post(
  '/:id/reject',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(rejectSwapRequestSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ code: 'unauthorized', message: 'Unauthorized' });
      return;
    }

    const requestObjectId = toObjectId(req.params.id);
    if (!requestObjectId) {
      res.status(400).json({ code: 'invalid_swap_request_id', message: 'Invalid swap request id' });
      return;
    }

    let loaded: Awaited<ReturnType<typeof loadSwapRequestAndShift>>;
    try {
      loaded = await loadSwapRequestAndShift(requestObjectId);
    } catch (error) {
      if (error instanceof SwapServiceError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message,
        });
        return;
      }
      throw error;
    }

    const { request, shift } = loaded;
    try {
      await assertCanManageSwapRequest(req, shift.locationId.toString());
    } catch (error) {
      if (error instanceof SwapServiceError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message,
        });
        return;
      }
      throw error;
    }

    if (!ACTIVE_SWAP_REQUEST_STATUSES.includes(request.status)) {
      res.status(409).json({
        code: 'invalid_swap_status',
        message: 'Only active requests can be rejected',
      });
      return;
    }

    const reason = req.body.reason.trim();

    const rejected = (await SwapRequestModel.findOneAndUpdate(
      {
        _id: requestObjectId,
        status: { $in: ACTIVE_SWAP_REQUEST_STATUSES },
      },
      {
        $set: {
          status: 'rejected',
          note: reason,
        },
      },
      { new: true },
    ).lean()) as SwapLeanDoc | null;

    if (!rejected) {
      res.status(409).json({
        code: 'swap_state_changed',
        message: 'Swap request is no longer rejectable',
      });
      return;
    }

    await auditSwapStatusChange({
      actorId: user.userId,
      action: 'swap_request_rejected',
      requestBefore: request,
      requestAfter: rejected,
      locationId: shift.locationId,
      reason,
    });

    await dispatchSwapLifecycle({
      io: req.app.get('io'),
      swapRequest: {
        _id: rejected._id,
        type: rejected.type,
        shiftId: rejected.shiftId,
        fromStaffId: rejected.fromStaffId,
        toStaffId: rejected.toStaffId,
        status: rejected.status,
        note: rejected.note,
        expiresAtUtc: rejected.expiresAtUtc,
      },
      shift,
      actorId: user.userId,
      action: 'rejected',
      reason,
    });

    const [hydrated] = await toSwapRequestView([rejected]);
    res.json({ swapRequest: hydrated });
  },
);

swapRequestsRouter.get(
  '/',
  authenticateJwt,
  requireRoles('admin', 'manager', 'staff'),
  validateRequest(listSwapRequestsSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ code: 'unauthorized', message: 'Unauthorized' });
      return;
    }

    const mine = parseBoolean(req.query.mine);
    const available = parseBoolean(req.query.available);
    const managerInbox = parseBoolean(req.query.managerInbox);

    if (available && user.role !== 'staff') {
      res.status(403).json({
        code: 'forbidden',
        message: 'Only staff users can list available drop requests',
      });
      return;
    }

    if (available) {
      const userObjectId = new Types.ObjectId(user.userId);
      const pendingDrops = (await SwapRequestModel.find({
        type: 'drop',
        status: 'pending',
        fromStaffId: { $ne: userObjectId },
      })
        .sort({ createdAt: -1 })
        .select('_id type shiftId fromStaffId toStaffId status note expiresAtUtc createdAt updatedAt')
        .lean()) as SwapLeanDoc[];

      const shiftIds = Array.from(new Set(pendingDrops.map((request) => request.shiftId.toString()))).map(
        (id) => new Types.ObjectId(id),
      );

      const shifts = (await ShiftModel.find({ _id: { $in: shiftIds } })
        .select('_id startAtUtc')
        .lean()) as Array<{ _id: Types.ObjectId; startAtUtc: string }>;

      const shiftStartById = new Map(shifts.map((shift) => [shift._id.toString(), shift.startAtUtc]));

      const eligible: SwapLeanDoc[] = [];

      for (const request of pendingDrops) {
        const shiftStartAtUtc = shiftStartById.get(request.shiftId.toString());
        if (!shiftStartAtUtc || isDropExpired(request, shiftStartAtUtc)) {
          continue;
        }

        const validation = await validateAssignment({
          shiftId: request.shiftId.toString(),
          staffId: user.userId,
          actorId: user.userId,
        });

        if (validation.ok) {
          eligible.push(request);
        }
      }

      const swapRequests = await toSwapRequestView(eligible);
      res.json({ swapRequests });
      return;
    }

    const query: Record<string, unknown> = {};

    if (mine || user.role === 'staff') {
      query.$or = [
        { fromStaffId: new Types.ObjectId(user.userId) },
        { toStaffId: new Types.ObjectId(user.userId) },
      ];
    } else if (user.role === 'manager') {
      const managedLocationIds = await getManagerLocationIds(user.userId);
      const shifts = await ShiftModel.find({
        locationId: { $in: managedLocationIds.map((id) => new Types.ObjectId(id)) },
      })
        .select('_id')
        .lean();

      query.shiftId = { $in: shifts.map((shift) => shift._id) };
    }

    if (!mine && user.role !== 'staff' && (managerInbox || !('status' in query))) {
      query.status = { $in: APPROVAL_READY_SWAP_STATUSES };
    }

    const requests = (await SwapRequestModel.find(query)
      .sort({ createdAt: -1 })
      .select('_id type shiftId fromStaffId toStaffId status note expiresAtUtc createdAt updatedAt')
      .lean()) as SwapLeanDoc[];

    const swapRequests = await toSwapRequestView(requests);
    res.json({ swapRequests });
  },
);
