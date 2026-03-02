import { Router } from 'express';
import { authenticateJwt } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';

export const deferredRouter = Router();

deferredRouter.post('/swap-requests', authenticateJwt, (_req, res) => {
  res.status(501).json({
    message: 'Swap request workflow is not implemented yet. This endpoint is a placeholder for MVP extension.',
  });
});

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