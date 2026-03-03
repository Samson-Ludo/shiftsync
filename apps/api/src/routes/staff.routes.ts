import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticateJwt, AuthenticatedRequest } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { validateRequest } from '../middleware/validate.js';
import {
  AvailabilityExceptionModel,
  AvailabilityRuleModel,
  StaffCertificationModel,
  StaffSkillModel,
  UserModel,
} from '../models/index.js';
import { canManageLocation, getManagerLocationIds, getStaffCertifiedLocationIds } from '../services/access.service.js';
import { recordAuditLog } from '../services/audit.service.js';

const listStaffSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    locationId: z.string().optional(),
  }),
});

const staffIdSchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  params: z.object({
    id: z.string().min(1),
  }),
});

const createAvailabilityRuleSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({}).optional().default({}),
  body: z.object({
    locationId: z.string().optional(),
    dayOfWeek: z.coerce.number().int().min(1).max(7),
    startLocalTime: z.string().min(1),
    endLocalTime: z.string().min(1),
    timezone: z.string().min(1),
  }),
});

const updateAvailabilityRuleSchema = z.object({
  params: z.object({
    id: z.string().min(1),
    ruleId: z.string().min(1),
  }),
  query: z.object({}).optional().default({}),
  body: z.object({
    locationId: z.string().optional(),
    dayOfWeek: z.coerce.number().int().min(1).max(7).optional(),
    startLocalTime: z.string().min(1).optional(),
    endLocalTime: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
  }),
});

const deleteAvailabilityRuleSchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  params: z.object({
    id: z.string().min(1),
    ruleId: z.string().min(1),
  }),
});

const createAvailabilityExceptionSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({}).optional().default({}),
  body: z.object({
    dateLocal: z.string().min(1),
    timezone: z.string().min(1),
    type: z.enum(['available', 'unavailable', 'allow', 'block']),
    startLocalTime: z.string().optional(),
    endLocalTime: z.string().optional(),
    reason: z.string().max(500).optional(),
  }),
});

const updateAvailabilityExceptionSchema = z.object({
  params: z.object({
    id: z.string().min(1),
    exceptionId: z.string().min(1),
  }),
  query: z.object({}).optional().default({}),
  body: z.object({
    dateLocal: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    type: z.enum(['available', 'unavailable', 'allow', 'block']).optional(),
    startLocalTime: z.string().optional(),
    endLocalTime: z.string().optional(),
    reason: z.string().max(500).optional(),
  }),
});

const deleteAvailabilityExceptionSchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  params: z.object({
    id: z.string().min(1),
    exceptionId: z.string().min(1),
  }),
});

const toObjectId = (value: unknown): Types.ObjectId | null => {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    return null;
  }
  return new Types.ObjectId(value);
};

export const staffRouter = Router();

staffRouter.get(
  '/',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(listStaffSchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const locationIdRaw = req.query.locationId;
    const locationId = typeof locationIdRaw === 'string' ? locationIdRaw : undefined;

    if (user.role === 'manager') {
      if (!locationId) {
        res.status(400).json({ message: 'locationId is required for managers' });
        return;
      }

      const canManage = await canManageLocation(user, locationId);
      if (!canManage) {
        res.status(403).json({ message: 'Cannot view staff for this location' });
        return;
      }
    }

    const locationObjectId = locationId ? toObjectId(locationId) : null;
    if (locationId && !locationObjectId) {
      res.status(400).json({ message: 'Invalid locationId' });
      return;
    }

    const staffUsers = await UserModel.find({ role: 'staff', active: true })
      .select('firstName lastName email')
      .sort({ firstName: 1, lastName: 1 })
      .lean();

    const staffIds = staffUsers.map((userRow) => userRow._id);

    const [skills, certifications] = await Promise.all([
      StaffSkillModel.find({ staffId: { $in: staffIds } }).select('staffId skill').lean(),
      StaffCertificationModel.find({
        staffId: { $in: staffIds },
        ...(locationObjectId ? { locationId: locationObjectId } : {}),
      })
        .select('staffId locationId certification')
        .lean(),
    ]);

    const skillsByStaff = new Map<string, string[]>();
    for (const row of skills) {
      const key = row.staffId.toString();
      skillsByStaff.set(key, [...(skillsByStaff.get(key) ?? []), row.skill]);
    }

    const certificationsByStaff = new Map<string, string[]>();
    for (const row of certifications) {
      const key = row.staffId.toString();
      certificationsByStaff.set(key, [
        ...(certificationsByStaff.get(key) ?? []),
        row.locationId.toString(),
      ]);
    }

    res.json({
      staff: staffUsers.map((staffUser) => {
        const id = staffUser._id.toString();
        const certifiedLocationIds = certificationsByStaff.get(id) ?? [];

        return {
          id,
          firstName: staffUser.firstName,
          lastName: staffUser.lastName,
          name: `${staffUser.firstName} ${staffUser.lastName}`,
          email: staffUser.email,
          skills: skillsByStaff.get(id) ?? [],
          certifiedLocationIds,
          isCertifiedForLocation: locationObjectId
            ? certifiedLocationIds.includes(locationObjectId.toString())
            : null,
        };
      }),
    });
  },
);

const resolveTargetStaff = async (staffIdValue: unknown) => {
  const staffId = toObjectId(staffIdValue);
  if (!staffId) {
    return null;
  }

  const staff = await UserModel.findOne({ _id: staffId, role: 'staff', active: true })
    .select('_id firstName lastName')
    .lean();
  if (!staff) {
    return null;
  }

  return { staffId, staff };
};

const canManageStaffAvailability = async (args: {
  actor: NonNullable<AuthenticatedRequest['user']>;
  staffId: string;
  locationId?: string;
}): Promise<boolean> => {
  if (args.actor.role === 'admin') {
    return true;
  }

  if (args.actor.role !== 'manager') {
    return false;
  }

  if (args.locationId) {
    return canManageLocation(args.actor, args.locationId);
  }

  const [managedLocationIds, certifiedLocationIds] = await Promise.all([
    getManagerLocationIds(args.actor.userId),
    getStaffCertifiedLocationIds(args.staffId),
  ]);

  return managedLocationIds.some((locationId) => certifiedLocationIds.includes(locationId));
};

staffRouter.get(
  '/:id/availability',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(staffIdSchema),
  async (req: AuthenticatedRequest, res) => {
    const actor = req.user;
    if (!actor) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const resolved = await resolveTargetStaff(req.params.id);
    if (!resolved) {
      res.status(404).json({ code: 'staff_not_found', message: 'Staff user not found' });
      return;
    }

    const canManage = await canManageStaffAvailability({
      actor,
      staffId: resolved.staffId.toString(),
    });
    if (!canManage) {
      res.status(403).json({ code: 'forbidden', message: 'Cannot view availability for this staff member' });
      return;
    }

    const [rules, exceptions] = await Promise.all([
      AvailabilityRuleModel.find({ staffId: resolved.staffId }).sort({ dayOfWeek: 1 }).lean(),
      AvailabilityExceptionModel.find({ staffId: resolved.staffId }).sort({ dateLocal: -1 }).lean(),
    ]);

    res.json({
      staff: {
        _id: resolved.staff._id.toString(),
        name: `${resolved.staff.firstName} ${resolved.staff.lastName}`,
      },
      rules: rules.map((rule) => ({
        _id: rule._id.toString(),
        staffId: rule.staffId.toString(),
        locationId: rule.locationId?.toString() ?? null,
        dayOfWeek: rule.dayOfWeek,
        startLocalTime: rule.startLocalTime,
        endLocalTime: rule.endLocalTime,
        timezone: rule.timezone,
      })),
      exceptions: exceptions.map((exception) => ({
        _id: exception._id.toString(),
        staffId: exception.staffId.toString(),
        dateLocal: exception.dateLocal,
        timezone: exception.timezone,
        type: exception.type,
        startLocalTime: exception.startLocalTime ?? null,
        endLocalTime: exception.endLocalTime ?? null,
        reason: exception.reason ?? null,
      })),
    });
  },
);

staffRouter.post(
  '/:id/availability-rules',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(createAvailabilityRuleSchema),
  async (req: AuthenticatedRequest, res) => {
    const actor = req.user;
    if (!actor) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const resolved = await resolveTargetStaff(req.params.id);
    if (!resolved) {
      res.status(404).json({ code: 'staff_not_found', message: 'Staff user not found' });
      return;
    }

    const locationObjectId = req.body.locationId ? toObjectId(req.body.locationId) : null;
    if (req.body.locationId && !locationObjectId) {
      res.status(400).json({ code: 'invalid_location_id', message: 'Invalid locationId' });
      return;
    }

    const canManage = await canManageStaffAvailability({
      actor,
      staffId: resolved.staffId.toString(),
      locationId: locationObjectId?.toString(),
    });
    if (!canManage) {
      res.status(403).json({ code: 'forbidden', message: 'Cannot modify availability for this staff member' });
      return;
    }

    const created = await AvailabilityRuleModel.create({
      staffId: resolved.staffId,
      ...(locationObjectId ? { locationId: locationObjectId } : {}),
      dayOfWeek: req.body.dayOfWeek,
      startLocalTime: req.body.startLocalTime,
      endLocalTime: req.body.endLocalTime,
      timezone: req.body.timezone,
    });

    await recordAuditLog({
      actorId: actor.userId,
      action: 'availability_rule_created',
      entityType: 'availability_rule',
      entityId: created._id.toString(),
      locationId: locationObjectId ?? undefined,
      beforeSnapshot: null,
      afterSnapshot: {
        staffId: created.staffId.toString(),
        locationId: created.locationId?.toString() ?? null,
        dayOfWeek: created.dayOfWeek,
        startLocalTime: created.startLocalTime,
        endLocalTime: created.endLocalTime,
        timezone: created.timezone,
      },
      payload: {
        staffId: resolved.staffId.toString(),
      },
    });

    res.status(201).json({ rule: created });
  },
);

staffRouter.patch(
  '/:id/availability-rules/:ruleId',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(updateAvailabilityRuleSchema),
  async (req: AuthenticatedRequest, res) => {
    const actor = req.user;
    if (!actor) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const resolved = await resolveTargetStaff(req.params.id);
    if (!resolved) {
      res.status(404).json({ code: 'staff_not_found', message: 'Staff user not found' });
      return;
    }

    const ruleObjectId = toObjectId(req.params.ruleId);
    if (!ruleObjectId) {
      res.status(400).json({ code: 'invalid_rule_id', message: 'Invalid ruleId' });
      return;
    }

    const existing = await AvailabilityRuleModel.findOne({
      _id: ruleObjectId,
      staffId: resolved.staffId,
    });
    if (!existing) {
      res.status(404).json({ code: 'availability_rule_not_found', message: 'Availability rule not found' });
      return;
    }

    const locationObjectId =
      req.body.locationId !== undefined
        ? req.body.locationId
          ? toObjectId(req.body.locationId)
          : null
        : existing.locationId;
    if (req.body.locationId && !locationObjectId) {
      res.status(400).json({ code: 'invalid_location_id', message: 'Invalid locationId' });
      return;
    }

    const canManage = await canManageStaffAvailability({
      actor,
      staffId: resolved.staffId.toString(),
      locationId: locationObjectId?.toString(),
    });
    if (!canManage) {
      res.status(403).json({ code: 'forbidden', message: 'Cannot modify availability for this staff member' });
      return;
    }

    const beforeSnapshot = {
      staffId: existing.staffId.toString(),
      locationId: existing.locationId?.toString() ?? null,
      dayOfWeek: existing.dayOfWeek,
      startLocalTime: existing.startLocalTime,
      endLocalTime: existing.endLocalTime,
      timezone: existing.timezone,
    };

    existing.locationId = locationObjectId ?? undefined;
    if (req.body.dayOfWeek !== undefined) {
      existing.dayOfWeek = req.body.dayOfWeek;
    }
    if (req.body.startLocalTime !== undefined) {
      existing.startLocalTime = req.body.startLocalTime;
    }
    if (req.body.endLocalTime !== undefined) {
      existing.endLocalTime = req.body.endLocalTime;
    }
    if (req.body.timezone !== undefined) {
      existing.timezone = req.body.timezone;
    }
    await existing.save();

    await recordAuditLog({
      actorId: actor.userId,
      action: 'availability_rule_updated',
      entityType: 'availability_rule',
      entityId: existing._id.toString(),
      locationId: existing.locationId ?? undefined,
      beforeSnapshot,
      afterSnapshot: {
        staffId: existing.staffId.toString(),
        locationId: existing.locationId?.toString() ?? null,
        dayOfWeek: existing.dayOfWeek,
        startLocalTime: existing.startLocalTime,
        endLocalTime: existing.endLocalTime,
        timezone: existing.timezone,
      },
      payload: {
        staffId: resolved.staffId.toString(),
      },
    });

    res.json({ rule: existing });
  },
);

staffRouter.delete(
  '/:id/availability-rules/:ruleId',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(deleteAvailabilityRuleSchema),
  async (req: AuthenticatedRequest, res) => {
    const actor = req.user;
    if (!actor) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const resolved = await resolveTargetStaff(req.params.id);
    if (!resolved) {
      res.status(404).json({ code: 'staff_not_found', message: 'Staff user not found' });
      return;
    }

    const ruleObjectId = toObjectId(req.params.ruleId);
    if (!ruleObjectId) {
      res.status(400).json({ code: 'invalid_rule_id', message: 'Invalid ruleId' });
      return;
    }

    const existing = await AvailabilityRuleModel.findOne({
      _id: ruleObjectId,
      staffId: resolved.staffId,
    }).lean();
    if (!existing) {
      res.status(404).json({ code: 'availability_rule_not_found', message: 'Availability rule not found' });
      return;
    }

    const canManage = await canManageStaffAvailability({
      actor,
      staffId: resolved.staffId.toString(),
      locationId: existing.locationId?.toString(),
    });
    if (!canManage) {
      res.status(403).json({ code: 'forbidden', message: 'Cannot modify availability for this staff member' });
      return;
    }

    await AvailabilityRuleModel.deleteOne({ _id: existing._id, staffId: resolved.staffId });

    await recordAuditLog({
      actorId: actor.userId,
      action: 'availability_rule_deleted',
      entityType: 'availability_rule',
      entityId: existing._id.toString(),
      locationId: existing.locationId ?? undefined,
      beforeSnapshot: {
        staffId: existing.staffId.toString(),
        locationId: existing.locationId?.toString() ?? null,
        dayOfWeek: existing.dayOfWeek,
        startLocalTime: existing.startLocalTime,
        endLocalTime: existing.endLocalTime,
        timezone: existing.timezone,
      },
      afterSnapshot: null,
      payload: {
        staffId: resolved.staffId.toString(),
      },
    });

    res.json({ message: 'Availability rule removed' });
  },
);

staffRouter.post(
  '/:id/availability-exceptions',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(createAvailabilityExceptionSchema),
  async (req: AuthenticatedRequest, res) => {
    const actor = req.user;
    if (!actor) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const resolved = await resolveTargetStaff(req.params.id);
    if (!resolved) {
      res.status(404).json({ code: 'staff_not_found', message: 'Staff user not found' });
      return;
    }

    const canManage = await canManageStaffAvailability({
      actor,
      staffId: resolved.staffId.toString(),
    });
    if (!canManage) {
      res.status(403).json({ code: 'forbidden', message: 'Cannot modify availability for this staff member' });
      return;
    }

    const created = await AvailabilityExceptionModel.create({
      staffId: resolved.staffId,
      dateLocal: req.body.dateLocal,
      timezone: req.body.timezone,
      type: req.body.type,
      ...(req.body.startLocalTime ? { startLocalTime: req.body.startLocalTime } : {}),
      ...(req.body.endLocalTime ? { endLocalTime: req.body.endLocalTime } : {}),
      ...(req.body.reason ? { reason: req.body.reason } : {}),
    });

    await recordAuditLog({
      actorId: actor.userId,
      action: 'availability_exception_created',
      entityType: 'availability_exception',
      entityId: created._id.toString(),
      beforeSnapshot: null,
      afterSnapshot: {
        staffId: created.staffId.toString(),
        dateLocal: created.dateLocal,
        timezone: created.timezone,
        type: created.type,
        startLocalTime: created.startLocalTime ?? null,
        endLocalTime: created.endLocalTime ?? null,
        reason: created.reason ?? null,
      },
      payload: {
        staffId: resolved.staffId.toString(),
      },
    });

    res.status(201).json({ exception: created });
  },
);

staffRouter.patch(
  '/:id/availability-exceptions/:exceptionId',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(updateAvailabilityExceptionSchema),
  async (req: AuthenticatedRequest, res) => {
    const actor = req.user;
    if (!actor) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const resolved = await resolveTargetStaff(req.params.id);
    if (!resolved) {
      res.status(404).json({ code: 'staff_not_found', message: 'Staff user not found' });
      return;
    }

    const exceptionObjectId = toObjectId(req.params.exceptionId);
    if (!exceptionObjectId) {
      res.status(400).json({ code: 'invalid_exception_id', message: 'Invalid exceptionId' });
      return;
    }

    const existing = await AvailabilityExceptionModel.findOne({
      _id: exceptionObjectId,
      staffId: resolved.staffId,
    });
    if (!existing) {
      res.status(404).json({
        code: 'availability_exception_not_found',
        message: 'Availability exception not found',
      });
      return;
    }

    const canManage = await canManageStaffAvailability({
      actor,
      staffId: resolved.staffId.toString(),
    });
    if (!canManage) {
      res.status(403).json({ code: 'forbidden', message: 'Cannot modify availability for this staff member' });
      return;
    }

    const beforeSnapshot = {
      staffId: existing.staffId.toString(),
      dateLocal: existing.dateLocal,
      timezone: existing.timezone,
      type: existing.type,
      startLocalTime: existing.startLocalTime ?? null,
      endLocalTime: existing.endLocalTime ?? null,
      reason: existing.reason ?? null,
    };

    if (req.body.dateLocal !== undefined) {
      existing.dateLocal = req.body.dateLocal;
    }
    if (req.body.timezone !== undefined) {
      existing.timezone = req.body.timezone;
    }
    if (req.body.type !== undefined) {
      existing.type = req.body.type;
    }
    if (req.body.startLocalTime !== undefined) {
      existing.startLocalTime = req.body.startLocalTime;
    }
    if (req.body.endLocalTime !== undefined) {
      existing.endLocalTime = req.body.endLocalTime;
    }
    if (req.body.reason !== undefined) {
      existing.reason = req.body.reason;
    }
    await existing.save();

    await recordAuditLog({
      actorId: actor.userId,
      action: 'availability_exception_updated',
      entityType: 'availability_exception',
      entityId: existing._id.toString(),
      beforeSnapshot,
      afterSnapshot: {
        staffId: existing.staffId.toString(),
        dateLocal: existing.dateLocal,
        timezone: existing.timezone,
        type: existing.type,
        startLocalTime: existing.startLocalTime ?? null,
        endLocalTime: existing.endLocalTime ?? null,
        reason: existing.reason ?? null,
      },
      payload: {
        staffId: resolved.staffId.toString(),
      },
    });

    res.json({ exception: existing });
  },
);

staffRouter.delete(
  '/:id/availability-exceptions/:exceptionId',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(deleteAvailabilityExceptionSchema),
  async (req: AuthenticatedRequest, res) => {
    const actor = req.user;
    if (!actor) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const resolved = await resolveTargetStaff(req.params.id);
    if (!resolved) {
      res.status(404).json({ code: 'staff_not_found', message: 'Staff user not found' });
      return;
    }

    const exceptionObjectId = toObjectId(req.params.exceptionId);
    if (!exceptionObjectId) {
      res.status(400).json({ code: 'invalid_exception_id', message: 'Invalid exceptionId' });
      return;
    }

    const existing = await AvailabilityExceptionModel.findOne({
      _id: exceptionObjectId,
      staffId: resolved.staffId,
    }).lean();
    if (!existing) {
      res.status(404).json({
        code: 'availability_exception_not_found',
        message: 'Availability exception not found',
      });
      return;
    }

    const canManage = await canManageStaffAvailability({
      actor,
      staffId: resolved.staffId.toString(),
    });
    if (!canManage) {
      res.status(403).json({ code: 'forbidden', message: 'Cannot modify availability for this staff member' });
      return;
    }

    await AvailabilityExceptionModel.deleteOne({
      _id: existing._id,
      staffId: resolved.staffId,
    });

    await recordAuditLog({
      actorId: actor.userId,
      action: 'availability_exception_deleted',
      entityType: 'availability_exception',
      entityId: existing._id.toString(),
      beforeSnapshot: {
        staffId: existing.staffId.toString(),
        dateLocal: existing.dateLocal,
        timezone: existing.timezone,
        type: existing.type,
        startLocalTime: existing.startLocalTime ?? null,
        endLocalTime: existing.endLocalTime ?? null,
        reason: existing.reason ?? null,
      },
      afterSnapshot: null,
      payload: {
        staffId: resolved.staffId.toString(),
      },
    });

    res.json({ message: 'Availability exception removed' });
  },
);
