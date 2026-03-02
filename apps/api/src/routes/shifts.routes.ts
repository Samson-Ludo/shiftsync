import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env.js';
import { authenticateJwt, AuthenticatedRequest } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { validateRequest } from '../middleware/validate.js';
import {
  ClockEventModel,
  LocationModel,
  StaffCertificationModel,
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
import {
  createAndDispatchNotifications,
  emitNotificationCreated,
  simulateEmailForNotifications,
} from '../services/notification.service.js';
import { getOnDutyStateForLocation } from '../services/on-duty.service.js';
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

const clockActionSchema = z.object({
  query: z.object({}).optional().default({}),
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    staffId: z.string().optional(),
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

const resolveClockTargetStaffId = (
  req: AuthenticatedRequest,
  bodyStaffId: unknown,
): { ok: true; staffId: Types.ObjectId } | { ok: false; status: number; message: string } => {
  const user = req.user;
  if (!user) {
    return { ok: false, status: 401, message: 'Unauthorized' };
  }

  if (user.role === 'staff') {
    const requestedStaffId = getSingleValue(bodyStaffId);
    if (requestedStaffId && requestedStaffId !== user.userId) {
      return { ok: false, status: 403, message: 'Staff cannot clock events for other users' };
    }

    if (!Types.ObjectId.isValid(user.userId)) {
      return { ok: false, status: 401, message: 'Invalid user token' };
    }

    return { ok: true, staffId: new Types.ObjectId(user.userId) };
  }

  const staffIdRaw = getSingleValue(bodyStaffId);
  if (!staffIdRaw || !Types.ObjectId.isValid(staffIdRaw)) {
    return { ok: false, status: 400, message: 'staffId is required for manager/admin clock actions' };
  }

  return { ok: true, staffId: new Types.ObjectId(staffIdRaw) };
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

type ScheduleEventName = 'schedule_published' | 'schedule_updated';

type ScheduleEventPayload = {
  locationId: string;
  weekStartLocal: string;
  sourceShiftId?: string;
  reason?: string;
  occurredAtUtc: string;
};

const loadAffectedStaffIdsForSchedule = async (args: {
  locationId: Types.ObjectId;
  weekStartLocal: string;
}): Promise<string[]> => {
  const [certifiedStaff, shifts] = await Promise.all([
    StaffCertificationModel.find({ locationId: args.locationId }).select('staffId').lean(),
    ShiftModel.find({
      locationId: args.locationId,
      weekStartLocal: args.weekStartLocal,
    })
      .select('_id')
      .lean(),
  ]);

  const shiftIds = shifts.map((shift) => shift._id);
  const assignedStaff =
    shiftIds.length > 0
      ? await ShiftAssignmentModel.find({ shiftId: { $in: shiftIds } }).select('staffId').lean()
      : [];

  return Array.from(
    new Set(
      [...certifiedStaff, ...assignedStaff].map((entry) =>
        entry.staffId instanceof Types.ObjectId ? entry.staffId.toString() : String(entry.staffId),
      ),
    ),
  );
};

const emitScheduleEvent = async (
  req: AuthenticatedRequest,
  eventName: ScheduleEventName,
  payload: Omit<ScheduleEventPayload, 'occurredAtUtc'>,
): Promise<void> => {
  const io = req.app.get('io');
  if (!io) {
    return;
  }

  const fullPayload: ScheduleEventPayload = {
    ...payload,
    occurredAtUtc: new Date().toISOString(),
  };

  io.to(`location:${payload.locationId}`).emit(eventName, fullPayload);

  const staffIds = await loadAffectedStaffIdsForSchedule({
    locationId: new Types.ObjectId(payload.locationId),
    weekStartLocal: payload.weekStartLocal,
  });

  for (const staffId of staffIds) {
    io.to(`user:${staffId}`).emit(eventName, fullPayload);
  }
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

    const io = req.app.get('io');
    if (io) {
      io.to(`location:${locationObjectId.toString()}`).emit('shift_created', {
        shiftId: created._id.toString(),
        locationId: locationObjectId.toString(),
        weekStartLocal: created.weekStartLocal,
        title: created.title,
        occurredAtUtc: new Date().toISOString(),
      });
    }

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

    if (updated) {
      const io = req.app.get('io');
      if (io) {
        io.to(`location:${updated.locationId.toString()}`).emit('shift_updated', {
          shiftId: updated._id.toString(),
          locationId: updated.locationId.toString(),
          weekStartLocal: updated.weekStartLocal,
          title: updated.title,
          occurredAtUtc: new Date().toISOString(),
        });
      }

      await emitScheduleEvent(req, 'schedule_updated', {
        locationId: updated.locationId.toString(),
        weekStartLocal: updated.weekStartLocal,
        sourceShiftId: updated._id.toString(),
        reason: 'shift_modified',
      });
    }

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

    await emitScheduleEvent(req, 'schedule_published', {
      locationId: sourceShift.locationId.toString(),
      weekStartLocal: sourceShift.weekStartLocal,
      sourceShiftId: sourceShift._id.toString(),
      reason: 'week_published',
    });

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

    const io = req.app.get('io');
    if (io) {
      io.to(`location:${shift.locationId.toString()}`).emit('shift_updated', {
        shiftId: shift._id.toString(),
        locationId: shift.locationId.toString(),
        weekStartLocal: shift.weekStartLocal,
        title: shift.title,
        occurredAtUtc: new Date().toISOString(),
      });
    }

    await emitScheduleEvent(req, 'schedule_updated', {
      locationId: shift.locationId.toString(),
      weekStartLocal: shift.weekStartLocal,
      sourceShiftId: shift._id.toString(),
      reason: 'shift_unpublished',
    });

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
    let persistedNotifications: Awaited<ReturnType<typeof createAndDispatchNotifications>> = [];

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

        persistedNotifications = await createAndDispatchNotifications({
          notifications: [
            {
              userId: staffObjectId,
              type: 'assignment',
              title: 'New shift assignment',
              body: `You were assigned to ${shift.title} on ${shift.localDate} (${shift.startLocalTime}-${shift.endLocalTime}).`,
              metadata: { shiftId: shift._id.toString() },
            },
            {
              userId: new Types.ObjectId(user.userId),
              type: 'assignment_action',
              title: 'Assignment recorded',
              body: `You assigned ${staffUser.firstName} ${staffUser.lastName} to ${shift.title}.`,
              metadata: {
                shiftId: shift._id.toString(),
                staffId: staffObjectId.toString(),
              },
            },
          ],
          session,
          simulateEmailAsync: false,
        });

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
        emitNotificationCreated({ io, notifications: persistedNotifications });

        io.to(`location:${persistedAssignment.shift.locationId.toString()}`).emit('assignment_created', {
          assignmentId: persistedAssignment.assignment._id.toString(),
          shiftId: persistedAssignment.shift._id.toString(),
          staffId: staffObjectId.toString(),
          staffName: `${persistedAssignment.staff.firstName} ${persistedAssignment.staff.lastName}`,
          locationId: persistedAssignment.shift.locationId.toString(),
          assignedBy: user.userId,
          createdAtUtc: new Date().toISOString(),
        });

        io.to(`user:${staffObjectId.toString()}`).emit('assignment_created', {
          assignmentId: persistedAssignment.assignment._id.toString(),
          shiftId: persistedAssignment.shift._id.toString(),
          staffId: staffObjectId.toString(),
          staffName: `${persistedAssignment.staff.firstName} ${persistedAssignment.staff.lastName}`,
          locationId: persistedAssignment.shift.locationId.toString(),
          assignedBy: user.userId,
          createdAtUtc: new Date().toISOString(),
        });
      }

      void simulateEmailForNotifications(persistedNotifications);

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

    const io = req.app.get('io');
    if (io) {
      io.to(`location:${shift.locationId.toString()}`).emit('assignment_removed', {
        assignmentId: assignmentObjectId.toString(),
        shiftId: shiftObjectId.toString(),
        staffId: assignment.staffId.toString(),
        locationId: shift.locationId.toString(),
        removedBy: user.userId,
        occurredAtUtc: new Date().toISOString(),
      });

      io.to(`user:${assignment.staffId.toString()}`).emit('assignment_removed', {
        assignmentId: assignmentObjectId.toString(),
        shiftId: shiftObjectId.toString(),
        staffId: assignment.staffId.toString(),
        locationId: shift.locationId.toString(),
        removedBy: user.userId,
        occurredAtUtc: new Date().toISOString(),
      });
    }

    res.json({ message: 'Assignment removed' });
  },
);

shiftsRouter.post(
  '/:id/clock-in',
  authenticateJwt,
  requireRoles('admin', 'manager', 'staff'),
  validateRequest(clockActionSchema),
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

    const target = resolveClockTargetStaffId(req, req.body.staffId);
    if (!target.ok) {
      res.status(target.status).json({ message: target.message });
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
        res.status(403).json({ message: 'Cannot clock staff for this location' });
        return;
      }
    }

    const [staffUser, assignment] = await Promise.all([
      UserModel.findOne({ _id: target.staffId, role: 'staff', active: true })
        .select('_id firstName lastName')
        .lean(),
      ShiftAssignmentModel.findOne({
        shiftId: shiftObjectId,
        staffId: target.staffId,
        status: 'assigned',
      })
        .select('_id')
        .lean(),
    ]);

    if (!staffUser) {
      res.status(404).json({ message: 'Staff user not found' });
      return;
    }

    if (!assignment) {
      res.status(409).json({ message: 'Staff must be assigned to this shift before clocking in' });
      return;
    }

    const lastEvent = await ClockEventModel.findOne({
      shiftId: shiftObjectId,
      staffId: target.staffId,
    })
      .sort({ atUtc: -1, createdAt: -1 })
      .lean();

    if (lastEvent?.eventType === 'clock_in') {
      res.status(409).json({ message: 'Staff is already clocked in for this shift' });
      return;
    }

    const event = await ClockEventModel.create({
      shiftId: shiftObjectId,
      staffId: target.staffId,
      locationId: shift.locationId,
      eventType: 'clock_in',
      atUtc: new Date().toISOString(),
    });

    const onDuty = await getOnDutyStateForLocation(shift.locationId.toString());
    const io = req.app.get('io');
    if (io) {
      io.to(`location:${shift.locationId.toString()}`).emit('on_duty_updated', {
        locationId: shift.locationId.toString(),
        shiftId: shiftObjectId.toString(),
        staffId: target.staffId.toString(),
        eventType: 'clock_in',
        onDuty,
        occurredAtUtc: new Date().toISOString(),
      });
    }

    res.status(201).json({ event, onDutyCount: onDuty.length, onDuty });
  },
);

shiftsRouter.post(
  '/:id/clock-out',
  authenticateJwt,
  requireRoles('admin', 'manager', 'staff'),
  validateRequest(clockActionSchema),
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

    const target = resolveClockTargetStaffId(req, req.body.staffId);
    if (!target.ok) {
      res.status(target.status).json({ message: target.message });
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
        res.status(403).json({ message: 'Cannot clock staff for this location' });
        return;
      }
    }

    const [staffUser, assignment] = await Promise.all([
      UserModel.findOne({ _id: target.staffId, role: 'staff', active: true })
        .select('_id firstName lastName')
        .lean(),
      ShiftAssignmentModel.findOne({
        shiftId: shiftObjectId,
        staffId: target.staffId,
        status: 'assigned',
      })
        .select('_id')
        .lean(),
    ]);

    if (!staffUser) {
      res.status(404).json({ message: 'Staff user not found' });
      return;
    }

    if (!assignment) {
      res.status(409).json({ message: 'Staff must be assigned to this shift before clocking out' });
      return;
    }

    const lastEvent = await ClockEventModel.findOne({
      shiftId: shiftObjectId,
      staffId: target.staffId,
    })
      .sort({ atUtc: -1, createdAt: -1 })
      .lean();

    if (!lastEvent || lastEvent.eventType !== 'clock_in') {
      res.status(409).json({ message: 'Staff is not currently clocked in for this shift' });
      return;
    }

    const event = await ClockEventModel.create({
      shiftId: shiftObjectId,
      staffId: target.staffId,
      locationId: shift.locationId,
      eventType: 'clock_out',
      atUtc: new Date().toISOString(),
    });

    const onDuty = await getOnDutyStateForLocation(shift.locationId.toString());
    const io = req.app.get('io');
    if (io) {
      io.to(`location:${shift.locationId.toString()}`).emit('on_duty_updated', {
        locationId: shift.locationId.toString(),
        shiftId: shiftObjectId.toString(),
        staffId: target.staffId.toString(),
        eventType: 'clock_out',
        onDuty,
        occurredAtUtc: new Date().toISOString(),
      });
    }

    res.status(201).json({ event, onDutyCount: onDuty.length, onDuty });
  },
);
