import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticateJwt, AuthenticatedRequest } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import { NotificationModel } from '../models/index.js';

const markReadSchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  params: z.object({
    id: z.string().min(1),
  }),
});

export const notificationRouter = Router();

const getParamValue = (value: string | string[] | undefined): string | null => {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return null;
};

notificationRouter.get('/', authenticateJwt, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.userId;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const notifications = await NotificationModel.find({ userId: new Types.ObjectId(userId) })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  res.json({ notifications });
});

notificationRouter.patch(
  '/:id/read',
  authenticateJwt,
  validateRequest(markReadSchema),
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.userId;
    const id = getParamValue(req.params.id);

    if (!userId || !Types.ObjectId.isValid(userId) || !id || !Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: 'Invalid identifiers' });
      return;
    }

    const updated = await NotificationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      },
      { $set: { read: true } },
      { new: true },
    ).lean();

    if (!updated) {
      res.status(404).json({ message: 'Notification not found' });
      return;
    }

    res.json({ notification: updated });
  },
);
