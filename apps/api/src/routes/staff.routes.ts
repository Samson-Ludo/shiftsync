import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticateJwt, AuthenticatedRequest } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { validateRequest } from '../middleware/validate.js';
import { StaffCertificationModel, StaffSkillModel, UserModel } from '../models/index.js';
import { canManageLocation } from '../services/access.service.js';

const listStaffSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    locationId: z.string().optional(),
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