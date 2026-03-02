import { Router } from 'express';
import { Types } from 'mongoose';
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

    const shift = await ShiftModel.findById(shiftObjectId).lean();
    if (!shift) {
      res.status(404).json({ message: 'Shift not found' });
      return;
    }

    if (user.role === 'manager') {
      const allowed = await canManageLocation(user, shift.locationId.toString());
      if (!allowed) {
        res.status(403).json({ message: 'Cannot assign for this shift' });
        return;
      }
    }

    const validation = await validateAssignment({
      shiftId: shiftObjectId.toString(),
      staffId: staffObjectId.toString(),
      actorId: user.userId,
    });

    if (!validation.ok) {
      res.status(409).json({
        message: 'Assignment blocked by constraints',
        ...validation,
      });
      return;
    }

    const staffUser = await UserModel.findOne({ _id: staffObjectId, role: 'staff', active: true })
      .select('firstName lastName')
      .lean();

    if (!staffUser) {
      res.status(404).json({ message: 'Staff user not found' });
      return;
    }

    try {
      const assignment = await ShiftAssignmentModel.create({
        shiftId: shiftObjectId,
        staffId: staffObjectId,
        assignedBy: new Types.ObjectId(user.userId),
        status: 'assigned',
      });

      await NotificationModel.insertMany([
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
      ]);

      const io = req.app.get('io');
      if (io) {
        io.to(`user:${staffObjectId.toString()}`).emit('notification:new', {
          type: 'assignment',
          shiftId: shift._id.toString(),
        });

        io.to(`user:${user.userId}`).emit('notification:new', {
          type: 'assignment_action',
          shiftId: shift._id.toString(),
        });
      }

      res.status(201).json({ assignment, validation });
    } catch (error: unknown) {
      const maybeMongoError = error as { code?: number };
      if (maybeMongoError.code === 11000) {
        res.status(409).json({
          message: 'Staff is already assigned to this shift',
          ok: false,
          violations: [
            {
              code: 'ALREADY_ASSIGNED',
              message: 'Staff member is already assigned to this shift.',
              details: { shiftId: shiftObjectId.toString(), staffId: staffObjectId.toString() },
            },
          ],
          suggestions: [],
        });
        return;
      }
      throw error;
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