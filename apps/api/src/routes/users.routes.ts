import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticateJwt, AuthenticatedRequest } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import { UserModel } from '../models/index.js';

const patchNotificationPreferenceSchema = z.object({
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  body: z.object({
    preference: z.enum(['in_app_only', 'in_app_plus_email_sim']),
  }),
});

export const usersRouter = Router();

usersRouter.patch(
  '/me/notification-preferences',
  authenticateJwt,
  validateRequest(patchNotificationPreferenceSchema),
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.userId;

    if (!userId || !Types.ObjectId.isValid(userId)) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const updated = await UserModel.findByIdAndUpdate(
      new Types.ObjectId(userId),
      {
        $set: {
          notificationPreference: req.body.preference,
        },
      },
      { new: true },
    )
      .select('notificationPreference')
      .lean();

    if (!updated) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.json({
      preference: updated.notificationPreference,
      message: 'Notification preference updated',
    });
  },
);
