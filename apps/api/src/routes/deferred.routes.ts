import { Router } from 'express';
import { z } from 'zod';
import { authenticateJwt } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { validateRequest } from '../middleware/validate.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

const swapSubmitSchema = z.object({
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  body: z.object({
    shiftId: z.string().min(1),
    fromStaffId: z.string().min(1),
    toStaffId: z.string().optional(),
    locationId: z.string().optional(),
  }),
});

const swapUpdateSchema = z.object({
  query: z.object({}).optional().default({}),
  body: z.object({
    locationId: z.string().optional(),
    status: z.enum(['approved', 'rejected', 'cancelled']),
  }),
  params: z.object({ id: z.string().min(1) }),
});

export const deferredRouter = Router();

deferredRouter.post(
  '/swap-requests',
  authenticateJwt,
  validateRequest(swapSubmitSchema),
  (req: AuthenticatedRequest, res) => {
    const userId = req.user?.userId;
    const io = req.app.get('io');
    if (io && userId) {
      io.to(`user:${userId}`).emit('swap_requested', {
        shiftId: req.body.shiftId,
        fromStaffId: req.body.fromStaffId,
        toStaffId: req.body.toStaffId,
        locationId: req.body.locationId,
        requestedBy: userId,
        occurredAtUtc: new Date().toISOString(),
        stub: true,
      });

      if (req.body.locationId) {
        io.to(`location:${req.body.locationId}`).emit('swap_requested', {
          shiftId: req.body.shiftId,
          fromStaffId: req.body.fromStaffId,
          toStaffId: req.body.toStaffId,
          locationId: req.body.locationId,
          requestedBy: userId,
          occurredAtUtc: new Date().toISOString(),
          stub: true,
        });
      }
    }

    res.status(202).json({
      message:
        'Swap workflow is not implemented yet. Event plumbing is active and emitted swap_requested.',
    });
  },
);

deferredRouter.post(
  '/swap-requests/:id/resolve',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  validateRequest(swapUpdateSchema),
  (req: AuthenticatedRequest, res) => {
    const io = req.app.get('io');
    const actorId = req.user?.userId;
    const eventName = req.body.status === 'cancelled' ? 'swap_cancelled' : 'swap_updated';

    if (io && actorId) {
      io.to(`user:${actorId}`).emit(eventName, {
        swapRequestId: req.params.id,
        status: req.body.status,
        locationId: req.body.locationId,
        resolvedBy: actorId,
        occurredAtUtc: new Date().toISOString(),
        stub: true,
      });

      if (req.body.locationId) {
        io.to(`location:${req.body.locationId}`).emit(eventName, {
          swapRequestId: req.params.id,
          status: req.body.status,
          locationId: req.body.locationId,
          resolvedBy: actorId,
          occurredAtUtc: new Date().toISOString(),
          stub: true,
        });
      }
    }

    res.status(202).json({
      message: `Swap workflow is not implemented yet. Event plumbing emitted ${eventName}.`,
    });
  },
);

deferredRouter.get(
  '/analytics/schedule-health',
  authenticateJwt,
  requireRoles('admin', 'manager'),
  (_req, res) => {
    res.status(501).json({
      message: 'Scheduling analytics is not implemented yet. This endpoint is a placeholder for MVP extension.',
    });
  },
);
