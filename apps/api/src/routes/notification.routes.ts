import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticateJwt, AuthenticatedRequest } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import { NotificationModel } from '../models/index.js';

const getNotificationsSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  }),
});

const markReadSchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  params: z.object({
    id: z.string().min(1),
  }),
});

const markReadBatchSchema = z.object({
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  body: z.object({
    notificationIds: z.array(z.string().min(1)).min(1),
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

notificationRouter.get(
  '/',
  authenticateJwt,
  validateRequest(getNotificationsSchema),
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.userId;
    if (!userId || !Types.ObjectId.isValid(userId)) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const pageRaw = req.query.page;
    const pageSizeRaw = req.query.pageSize;
    const page =
      typeof pageRaw === 'number' ? pageRaw : typeof pageRaw === 'string' ? Number(pageRaw) : 1;
    const pageSize =
      typeof pageSizeRaw === 'number'
        ? pageSizeRaw
        : typeof pageSizeRaw === 'string'
          ? Number(pageSizeRaw)
          : 20;
    const filter = { userId: new Types.ObjectId(userId) };
    const skip = (page - 1) * pageSize;

    const [notifications, total] = await Promise.all([
      NotificationModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      NotificationModel.countDocuments(filter),
    ]);

    res.json({
      notifications,
      page,
      pageSize,
      total,
      hasMore: skip + notifications.length < total,
    });
  },
);

notificationRouter.post(
  '/mark-read',
  authenticateJwt,
  validateRequest(markReadBatchSchema),
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.userId;
    if (!userId || !Types.ObjectId.isValid(userId)) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const objectIds = req.body.notificationIds
      .filter((id: string) => Types.ObjectId.isValid(id))
      .map((id: string) => new Types.ObjectId(id));

    if (objectIds.length === 0) {
      res.status(400).json({ message: 'No valid notification IDs were provided' });
      return;
    }

    const result = await NotificationModel.updateMany(
      {
        _id: { $in: objectIds },
        userId: new Types.ObjectId(userId),
      },
      { $set: { read: true } },
    );

    res.json({
      message: 'Notifications marked as read',
      modifiedCount: result.modifiedCount,
    });
  },
);

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
