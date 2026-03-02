import { Router } from 'express';
import { z } from 'zod';
import { authenticateJwt, AuthenticatedRequest } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { validateRequest } from '../middleware/validate.js';
import { canManageLocation } from '../services/access.service.js';
import { getOnDutyStateForLocation } from '../services/on-duty.service.js';

const listOnDutySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    locationId: z.string().min(1),
  }),
});

export const onDutyRouter = Router();

onDutyRouter.get(
  '/',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(listOnDutySchema),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const locationId = req.query.locationId as string;

    if (user.role === 'manager') {
      const allowed = await canManageLocation(user, locationId);
      if (!allowed) {
        res.status(403).json({ message: 'Cannot view on-duty state for this location' });
        return;
      }
    }

    const onDuty = await getOnDutyStateForLocation(locationId);

    res.json({
      locationId,
      generatedAtUtc: new Date().toISOString(),
      onDuty,
    });
  },
);
