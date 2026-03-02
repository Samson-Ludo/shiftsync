import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env.js';
import { authenticateJwt, AuthenticatedRequest } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { validateRequest } from '../middleware/validate.js';
import {
  LocationModel,
  NotificationModel,
  ShiftAssignmentModel,
  ShiftModel,
  UserModel,
} from '../models/index.js';
import { canManageLocation, getStaffCertifiedLocationIds } from '../services/access.service.js';
import { validateAssignment } from '../services/assignmentValidator.js';
import {
  acquireReservationLock,
  buildStaffLockKey,
  releaseReservationLock,
  ResourceLockedError,
} from '../services/lock.service.js';
import { cancelPendingSwapRequestsForShift } from '../services/swap.service.js';
import { computeWeekStart, hoursUntilUtc, resolveShiftUtcWindow, utcToLocationString } from '../utils/time.js';

const getShiftsSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    locationId: z.string().optional(),
    weekStart: z.string().optional(),
  }),
});

const createShiftSchema = z.object({
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  body: z.object({
    locationId: z.string().min(1),
    title: z.string().min(1),
    requiredSkill: z.string().optional(),
    localDate: z.string().min(1),
    startLocalTime: z.string().min(1),
    endLocalTime: z.string().min(1),
  }),
});

const patchShiftSchema = z.object({
  query: z.object({}).optional().default({}),
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    title: z.string().min(1).optional(),
    requiredSkill: z.string().optional(),
    localDate: z.string().min(1).optional(),
    startLocalTime: z.string().min(1).optional(),
    endLocalTime: z.string().min(1).optional(),
  }),
});

const shiftIdSchema = z.object({
  query: z.object({}).optional().default({}),
  body: z.object({}).optional().default({}),
  params: z.object({ id: z.string().min(1) }),
});

const assignShiftSchema = z.object({
  query: z.object({}).optional().default({}),
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ staffId: z.string().min(1) }),
});

const validateAssignSchema = z.object({
  query: z.object({}).optional().default({}),
  body: z.object({}).optional().default({}),
  params: z.object({
    id: z.string().min(1),
    staffId: z.string().min(1),
  }),
});

const deleteAssignmentSchema = z.object({
  query: z.object({}).optional().default({}),
  body: z.object({}).optional().default({}),
  params: z.object({
    id: z.string().min(1),
    assignmentId: z.string().min(1),
  }),
});

const withinCutoff = (shiftStartAtUtc: string): boolean => {
  const hours = hoursUntilUtc(shiftStartAtUtc);
  return hours <= env.CUTOFF_HOURS;
};

const getSingleValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return null;
};

const parseObjectId = (value: unknown): Types.ObjectId | null => {
  const singleValue = getSingleValue(value);
  if (!singleValue || !Types.ObjectId.isValid(singleValue)) {
    return null;
  }
  return new Types.ObjectId(singleValue);
};

type ConflictEventPayload = {
  code: 'conflict_detected';
  message: string;
  shiftId: string;
  staffId: string;
  detectedAtUtc: string;
};

class RouteHttpError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super((typeof payload.message === 'string' ? payload.message : 'Request failed') as string);
    this.name = 'RouteHttpError';
    this.status = status;
    this.payload = payload;
  }
}

class AssignmentConflictError extends Error {
  validation: Awaited<ReturnType<typeof validateAssignment>>;

  constructor(validation: Awaited<ReturnType<typeof validateAssignment>>) {
    super('Assignment conflict detected');
    this.name = 'AssignmentConflictError';
    this.validation = validation;
  }
}

const emitConflictDetected = (
  req: AuthenticatedRequest,
  userId: string,
  payload: Omit<ConflictEventPayload, 'code' | 'detectedAtUtc'>,
): void => {
  const io = req.app.get('io');
  if (!io) {
    return;
  }

  io.to(`user:${userId}`).emit('conflict_detected', {
    code: 'conflict_detected',
    ...payload,
    detectedAtUtc: new Date().toISOString(),
  } satisfies ConflictEventPayload);
};

export const shiftsRouter = Router();

shiftsRouter.get(
  '/',
  authenticateJwt,
  validateRequest(getShiftsSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const { locationId, weekStart } = req.query as { locationId?: string; weekStart?: string };
    const filters: Record<string, unknown> = {};

    if (weekStart) {
      filters.weekStartLocal = weekStart;
    }

    if (locationId) {
      const locObjectId = parseObjectId(locationId);
      if (!locObjectId) {
        res.status(400).json({ message: 'Invalid locationId' });
        return;
      }
      filters.locationId = locObjectId;
    }

    if (user.role === 'manager') {
      if (!locationId) {
        res.status(400).json({ message: 'locationId is required for managers' });
        return;
      }

      const allowed = await canManageLocation(user, locationId);
      if (!allowed) {
        res.status(403).json({ message: 'Cannot view shifts for this location' });
        return;
      }
    }

    if (user.role === 'staff') {
      const certifiedLocationIds = await getStaffCertifiedLocationIds(user.userId);
      const ownAssignments = await ShiftAssignmentModel.find({ staffId: new Types.ObjectId(user.userId) })
        .select('shiftId')
        .lean();
      const assignedShiftIds = ownAssignments.map((assignment) => assignment.shiftId);

      const staffFilter: Record<string, unknown> = {
        ...filters,
        $or: [
          {
            published: true,
            locationId: {
              $in: certifiedLocationIds.map((id) => new Types.ObjectId(id)),
            },
          },
          {
            _id: { $in: assignedShiftIds },
          },
        ],
      };

      const shifts = await ShiftModel.find(staffFilter)
        .populate('locationId', 'name code timezone')
        .sort({ startAtUtc: 1 })
        .lean();

      const assignments = await ShiftAssignmentModel.find({
        shiftId: { $in: shifts.map((shift) => shift._id) },
      })
        .populate('staffId', 'firstName lastName email')
        .lean();

      const assignmentsByShift = new Map<string, unknown[]>();
      for (const assignment of assignments) {
        const key = assignment.shiftId.toString();
        assignmentsByShift.set(key, [...(assignmentsByShift.get(key) ?? []), assignment]);
      }

      res.json({
        shifts: shifts.map((shift) => ({
          ...shift,
          startAtLocal: utcToLocationString(shift.startAtUtc, shift.timezone),
          endAtLocal: utcToLocationString(shift.endAtUtc, shift.timezone),
          assignments: assignmentsByShift.get(shift._id.toString()) ?? [],
        })),
      });
      return;
    }

    const shifts = await ShiftModel.find(filters)
      .populate('locationId', 'name code timezone')
      .sort({ startAtUtc: 1 })
      .lean();

    const assignments = await ShiftAssignmentModel.find({
      shiftId: { $in: shifts.map((shift) => shift._id) },
    })
      .populate('staffId', 'firstName lastName email')
      .lean();

    const assignmentsByShift = new Map<string, unknown[]>();
    for (const assignment of assignments) {
      const key = assignment.shiftId.toString();
      assignmentsByShift.set(key, [...(assignmentsByShift.get(key) ?? []), assignment]);
    }

    res.json({
      shifts: shifts.map((shift) => ({
        ...shift,
        startAtLocal: utcToLocationString(shift.startAtUtc, shift.timezone),
        endAtLocal: utcToLocationString(shift.endAtUtc, shift.timezone),
        assignments: assignmentsByShift.get(shift._id.toString()) ?? [],
      })),
    });
  },
);

shiftsRouter.post(
  '/',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(createShiftSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const { locationId, title, requiredSkill, localDate, startLocalTime, endLocalTime } = req.body;
    const locationObjectId = parseObjectId(locationId);

    if (!locationObjectId) {
      res.status(400).json({ message: 'Invalid locationId' });
      return;
    }

    if (user.role === 'manager') {
      const allowed = await canManageLocation(user, locationId);
      if (!allowed) {
        res.status(403).json({ message: 'Cannot create shifts for this location' });
        return;
      }
    }

    const location = await LocationModel.findById(locationObjectId).lean();
    if (!location) {
      res.status(404).json({ message: 'Location not found' });
      return;
    }

    const utcWindow = resolveShiftUtcWindow({
      localDate,
      startLocalTime,
      endLocalTime,
      timezone: location.timezone,
    });

    const weekStartLocal = computeWeekStart(localDate, location.timezone);

    const created = await ShiftModel.create({
      locationId: locationObjectId,
      title,
      requiredSkill: requiredSkill?.trim() || undefined,
      timezone: location.timezone,
      localDate,
      startLocalTime,
      endLocalTime,
      startAtUtc: utcWindow.startAtUtc,
      endAtUtc: utcWindow.endAtUtc,
      overnight: utcWindow.overnight,
      weekStartLocal,
      published: false,
      createdBy: new Types.ObjectId(user.userId),
      updatedBy: new Types.ObjectId(user.userId),
    });

    res.status(201).json({ shift: created });
  },
);

shiftsRouter.patch(
  '/:id',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(patchShiftSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const shiftObjectId = parseObjectId(req.params.id);
    if (!shiftObjectId) {
      res.status(400).json({ message: 'Invalid shift id' });
      return;
    }

    const shift = await ShiftModel.findById(shiftObjectId);
    if (!shift) {
      res.status(404).json({ message: 'Shift not found' });
      return;
    }

    if (user.role === 'manager') {
      const allowed = await canManageLocation(user, shift.locationId.toString());
      if (!allowed) {
        res.status(403).json({ message: 'Cannot edit this shift' });
        return;
      }
    }

    if (withinCutoff(shift.startAtUtc)) {
      res.status(409).json({
        message: `Cannot edit shift within ${env.CUTOFF_HOURS} hours of start`,
      });
      return;
    }

    const nextLocalDate = req.body.localDate ?? shift.localDate;
    const nextStart = req.body.startLocalTime ?? shift.startLocalTime;
    const nextEnd = req.body.endLocalTime ?? shift.endLocalTime;

    const utcWindow = resolveShiftUtcWindow({
      localDate: nextLocalDate,
      startLocalTime: nextStart,
      endLocalTime: nextEnd,
      timezone: shift.timezone,
    });

    const weekStartLocal = computeWeekStart(nextLocalDate, shift.timezone);

    const cancelledSwapRequests = await cancelPendingSwapRequestsForShift(
      shift._id.toString(),
      'Cancelled because shift details changed',
    );

    // TODO: After swap workflows are implemented, emit explicit notifications to impacted users.
    const updated = await ShiftModel.findByIdAndUpdate(
      shiftObjectId,
      {
        $set: {
          title: req.body.title ?? shift.title,
          requiredSkill: req.body.requiredSkill ?? shift.requiredSkill,
          localDate: nextLocalDate,
          startLocalTime: nextStart,
          endLocalTime: nextEnd,
          startAtUtc: utcWindow.startAtUtc,
          endAtUtc: utcWindow.endAtUtc,
          overnight: utcWindow.overnight,
          weekStartLocal,
          updatedBy: new Types.ObjectId(user.userId),
        },
      },
      { new: true },
    ).lean();

    res.json({ shift: updated, cancelledSwapRequests });
  },
);

shiftsRouter.post(
  '/:id/validate-assign/:staffId',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(validateAssignSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const shiftObjectId = parseObjectId(req.params.id);
    const staffObjectId = parseObjectId(req.params.staffId);

    if (!shiftObjectId || !staffObjectId) {
      res.status(400).json({ message: 'Invalid shiftId or staffId' });
      return;
    }

    const shift = await ShiftModel.findById(shiftObjectId).lean();
    if (!shift) {
      res.status(404).json({ message: 'Shift not found' });
      return;
    }

    if (user.role === 'manager') {
      const allowed = await canManageLocation(user, shift.locationId.toString());
      if (!allowed) {
        res.status(403).json({ message: 'Cannot validate assignments for this shift' });
        return;
      }
    }

    const validation = await validateAssignment({
      shiftId: shiftObjectId.toString(),
      staffId: staffObjectId.toString(),
      actorId: user.userId,
    });

    res.status(validation.ok ? 200 : 409).json(validation);
  },
);

shiftsRouter.post(
  '/:id/publish',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(shiftIdSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const shiftObjectId = parseObjectId(req.params.id);
    if (!shiftObjectId) {
      res.status(400).json({ message: 'Invalid shift id' });
      return;
    }

    const sourceShift = await ShiftModel.findById(shiftObjectId).lean();
    if (!sourceShift) {
      res.status(404).json({ message: 'Shift not found' });
      return;
    }

    if (user.role === 'manager') {
      const allowed = await canManageLocation(user, sourceShift.locationId.toString());
      if (!allowed) {
        res.status(403).json({ message: 'Cannot publish shifts for this location' });
        return;
      }
    }

    // TODO: If future publish includes implicit edits, cancel pending swaps and notify affected staff.
    const result = await ShiftModel.updateMany(
      {
        locationId: sourceShift.locationId,
        weekStartLocal: sourceShift.weekStartLocal,
      },
      {
        $set: {
          published: true,
          updatedBy: new Types.ObjectId(user.userId),
        },
      },
    );

    res.json({
      message: 'Published shifts for location week',
      weekStartLocal: sourceShift.weekStartLocal,
      modifiedCount: result.modifiedCount,
    });
  },
);

shiftsRouter.post(
  '/:id/unpublish',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(shiftIdSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const shiftObjectId = parseObjectId(req.params.id);
    if (!shiftObjectId) {
      res.status(400).json({ message: 'Invalid shift id' });
      return;
    }

    const shift = await ShiftModel.findById(shiftObjectId);
    if (!shift) {
      res.status(404).json({ message: 'Shift not found' });
      return;
    }

    if (user.role === 'manager') {
      const allowed = await canManageLocation(user, shift.locationId.toString());
      if (!allowed) {
        res.status(403).json({ message: 'Cannot unpublish this shift' });
        return;
      }
    }

    if (withinCutoff(shift.startAtUtc)) {
      res.status(409).json({
        message: `Cannot unpublish shift within ${env.CUTOFF_HOURS} hours of start`,
      });
      return;
    }

    shift.published = false;
    shift.updatedBy = new Types.ObjectId(user.userId);
    await shift.save();

    res.json({ shift });
  },
);

shiftsRouter.post(
  '/:id/assign',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(assignShiftSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const shiftObjectId = parseObjectId(req.params.id);
    const staffIdRaw = getSingleValue(req.body.staffId);
    const staffObjectId = parseObjectId(staffIdRaw);

    if (!shiftObjectId || !staffObjectId) {
      res.status(400).json({ message: 'Invalid shiftId or staffId' });
      return;
    }

    const lockOwner = `${user.userId}:${Date.now()}:${new Types.ObjectId().toString()}`;
    const lockKey = buildStaffLockKey(staffObjectId.toString());
    let lockAcquired: Awaited<ReturnType<typeof acquireReservationLock>> | null = null;
    let session: mongoose.ClientSession | null = null;

    let persistedAssignment:
      | {
          shift: {
            _id: Types.ObjectId;
            locationId: Types.ObjectId;
            title: string;
            localDate: string;
            startLocalTime: string;
            endLocalTime: string;
          };
          staff: { firstName: string; lastName: string };
          assignment: {
            _id: Types.ObjectId;
            shiftId: Types.ObjectId;
            staffId: Types.ObjectId;
            assignedBy: Types.ObjectId;
            status: string;
          };
        }
      | null = null;

    try {
      lockAcquired = await acquireReservationLock({
        key: lockKey,
        owner: lockOwner,
        ttlSeconds: 15,
      });
    } catch (error: unknown) {
      if (error instanceof ResourceLockedError) {
        const conflictMessage =
          'Assignment conflict detected. Another manager is currently assigning this staff member.';
        emitConflictDetected(req, user.userId, {
          message: conflictMessage,
          shiftId: shiftObjectId.toString(),
          staffId: staffObjectId.toString(),
        });
        res.status(409).json({
          code: 'conflict_detected',
          message: conflictMessage,
        });
        return;
      }
      throw error;
    }

    try {
      session = await mongoose.startSession();

      let txValidation: Awaited<ReturnType<typeof validateAssignment>> = {
        ok: false,
        violations: [],
        suggestions: [],
      };

      session.startTransaction();
      try {
        const shift = await ShiftModel.findById(shiftObjectId)
          .select('locationId title localDate startLocalTime endLocalTime')
          .session(session)
          .lean();
        if (!shift) {
          throw new RouteHttpError(404, { message: 'Shift not found' });
        }

        if (user.role === 'manager') {
          const allowed = await canManageLocation(user, shift.locationId.toString());
          if (!allowed) {
            throw new RouteHttpError(403, { message: 'Cannot assign for this shift' });
          }
        }

        const staffUser = await UserModel.findOne({
          _id: staffObjectId,
          role: 'staff',
          active: true,
        })
          .select('firstName lastName')
          .session(session)
          .lean();

        if (!staffUser) {
          throw new RouteHttpError(404, { message: 'Staff user not found' });
        }

        txValidation = await validateAssignment({
          shiftId: shiftObjectId.toString(),
          staffId: staffObjectId.toString(),
          actorId: user.userId,
          session,
        });

        if (!txValidation.ok) {
          throw new AssignmentConflictError(txValidation);
        }

        const createdAssignments = await ShiftAssignmentModel.create(
          [
            {
              shiftId: shiftObjectId,
              staffId: staffObjectId,
              assignedBy: new Types.ObjectId(user.userId),
              status: 'assigned',
            },
          ],
          { session },
        );

        const assignment = createdAssignments[0];

        await NotificationModel.insertMany(
          [
            {
              userId: staffObjectId,
              type: 'assignment',
              title: 'New shift assignment',
              body: `You were assigned to ${shift.title} on ${shift.localDate} (${shift.startLocalTime}-${shift.endLocalTime}).`,
              read: false,
              metadata: { shiftId: shift._id.toString() },
            },
            {
              userId: new Types.ObjectId(user.userId),
              type: 'assignment_action',
              title: 'Assignment recorded',
              body: `You assigned ${staffUser.firstName} ${staffUser.lastName} to ${shift.title}.`,
              read: false,
              metadata: {
                shiftId: shift._id.toString(),
                staffId: staffObjectId.toString(),
              },
            },
          ],
          { session },
        );

        persistedAssignment = {
          shift: {
            _id: shift._id,
            locationId: shift.locationId,
            title: shift.title,
            localDate: shift.localDate,
            startLocalTime: shift.startLocalTime,
            endLocalTime: shift.endLocalTime,
          },
          staff: {
            firstName: staffUser.firstName,
            lastName: staffUser.lastName,
          },
          assignment: {
            _id: assignment._id,
            shiftId: assignment.shiftId,
            staffId: assignment.staffId,
            assignedBy: assignment.assignedBy,
            status: assignment.status,
          },
        };

        await session.commitTransaction();
      } catch (txError) {
        await session.abortTransaction();
        throw txError;
      }

      if (!persistedAssignment) {
        throw new RouteHttpError(500, { message: 'Assignment was not persisted' });
      }

      const io = req.app.get('io');
      if (io) {
        io.to(`user:${staffObjectId.toString()}`).emit('notification:new', {
          type: 'assignment',
          shiftId: persistedAssignment.shift._id.toString(),
        });

        io.to(`user:${user.userId}`).emit('notification:new', {
          type: 'assignment_action',
          shiftId: persistedAssignment.shift._id.toString(),
        });

        io.to(`location:${persistedAssignment.shift.locationId.toString()}`).emit('assignment_created', {
          assignmentId: persistedAssignment.assignment._id.toString(),
          shiftId: persistedAssignment.shift._id.toString(),
          staffId: staffObjectId.toString(),
          staffName: `${persistedAssignment.staff.firstName} ${persistedAssignment.staff.lastName}`,
          locationId: persistedAssignment.shift.locationId.toString(),
          assignedBy: user.userId,
          createdAtUtc: new Date().toISOString(),
        });
      }

      res.status(201).json({
        assignment: persistedAssignment.assignment,
        validation: { ok: true, violations: [], suggestions: [] },
      });
    } catch (error: unknown) {
      if (error instanceof RouteHttpError) {
        res.status(error.status).json(error.payload);
        return;
      }

      if (error instanceof AssignmentConflictError) {
        const conflictMessage =
          'Assignment conflict detected. Revalidation failed because another update changed availability.';
        emitConflictDetected(req, user.userId, {
          message: conflictMessage,
          shiftId: shiftObjectId.toString(),
          staffId: staffObjectId.toString(),
        });
        res.status(409).json({
          code: 'conflict_detected',
          message: conflictMessage,
          ...error.validation,
        });
        return;
      }

      const maybeMongoError = error as { code?: number };
      if (maybeMongoError.code === 11000) {
        const conflictMessage =
          'Assignment conflict detected. This staff member was assigned by another request.';
        emitConflictDetected(req, user.userId, {
          message: conflictMessage,
          shiftId: shiftObjectId.toString(),
          staffId: staffObjectId.toString(),
        });
        res.status(409).json({
          code: 'conflict_detected',
          message: conflictMessage,
        });
        return;
      }

      throw error;
    } finally {
      if (session) {
        await session.endSession();
      }

      if (lockAcquired) {
        try {
          await releaseReservationLock(lockAcquired);
        } catch {
          // Lock has a short TTL; ignore release failures to avoid masking assignment results.
        }
      }
    }
  },
);

shiftsRouter.delete(
  '/:id/assignments/:assignmentId',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(deleteAssignmentSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const shiftObjectId = parseObjectId(req.params.id);
    const assignmentObjectId = parseObjectId(req.params.assignmentId);

    if (!shiftObjectId || !assignmentObjectId) {
      res.status(400).json({ message: 'Invalid identifiers' });
      return;
    }

    const shift = await ShiftModel.findById(shiftObjectId).lean();
    if (!shift) {
      res.status(404).json({ message: 'Shift not found' });
      return;
    }

    if (user.role === 'manager') {
      const allowed = await canManageLocation(user, shift.locationId.toString());
      if (!allowed) {
        res.status(403).json({ message: 'Cannot remove assignment for this shift' });
        return;
      }
    }

    const assignment = await ShiftAssignmentModel.findOneAndDelete({
      _id: assignmentObjectId,
      shiftId: shiftObjectId,
    }).lean();

    if (!assignment) {
      res.status(404).json({ message: 'Assignment not found' });
      return;
    }

    res.json({ message: 'Assignment removed' });
  },
);
