import { Router } from 'express';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticateJwt, AuthenticatedRequest } from '../middleware/auth.js';
import { requireRoles } from '../middleware/rbac.js';
import { validateRequest } from '../middleware/validate.js';
import { AuditLogModel, LocationModel, UserModel } from '../models/index.js';

const exportAuditSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    locationId: z.string().optional(),
    start: z.string().min(1),
    end: z.string().min(1),
    format: z.enum(['json', 'csv']).optional(),
  }),
});

const parseObjectId = (value: unknown): Types.ObjectId | null => {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    return null;
  }
  return new Types.ObjectId(value);
};

const toCsvValue = (value: unknown): string => {
  const raw =
    typeof value === 'string'
      ? value
      : value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);

  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }

  return raw;
};

const toCsv = (rows: Record<string, unknown>[]): string => {
  const headers = [
    'id',
    'createdAt',
    'actorId',
    'actorName',
    'action',
    'entityType',
    'entityId',
    'locationId',
    'beforeSnapshot',
    'afterSnapshot',
    'payload',
  ];

  const lines = rows.map((row) => headers.map((header) => toCsvValue(row[header])).join(','));
  return [headers.join(','), ...lines].join('\n');
};

export const auditRouter = Router();

auditRouter.get(
  '/export',
  authenticateJwt,
  requireRoles('admin'),
  validateRequest(exportAuditSchema),
  async (req: AuthenticatedRequest, res) => {
    const start = DateTime.fromISO(req.query.start as string, { zone: 'utc' });
    const end = DateTime.fromISO(req.query.end as string, { zone: 'utc' });

    if (!start.isValid || !end.isValid || end < start) {
      res.status(400).json({
        code: 'invalid_date_range',
        message: 'start and end must be valid ISO timestamps with end >= start',
      });
      return;
    }

    const locationObjectId = parseObjectId(req.query.locationId);
    if (req.query.locationId && !locationObjectId) {
      res.status(400).json({
        code: 'invalid_location_id',
        message: 'Invalid locationId',
      });
      return;
    }

    if (locationObjectId) {
      const exists = await LocationModel.exists({ _id: locationObjectId });
      if (!exists) {
        res.status(404).json({
          code: 'location_not_found',
          message: 'Location not found',
        });
        return;
      }
    }

    const query: Record<string, unknown> = {
      createdAt: {
        $gte: start.toJSDate(),
        $lte: end.toJSDate(),
      },
      ...(locationObjectId ? { locationId: locationObjectId } : {}),
    };

    const logs = await AuditLogModel.find(query)
      .sort({ createdAt: -1 })
      .select(
        '_id actorId actorUserId action entityType entityId locationId beforeSnapshot afterSnapshot payload createdAt',
      )
      .lean();

    const actorUserIds = Array.from(
      new Set(logs.map((log) => log.actorUserId?.toString()).filter((id): id is string => Boolean(id))),
    ).map((id) => new Types.ObjectId(id));

    const users = actorUserIds.length
      ? await UserModel.find({ _id: { $in: actorUserIds } }).select('_id firstName lastName').lean()
      : [];
    const actorNameById = new Map(
      users.map((user) => [user._id.toString(), `${user.firstName} ${user.lastName}`]),
    );

    const exportRows = logs.map((log) => ({
      id: log._id.toString(),
      createdAt: log.createdAt.toISOString(),
      actorId: log.actorId,
      actorName: log.actorUserId ? actorNameById.get(log.actorUserId.toString()) ?? null : null,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      locationId: log.locationId?.toString() ?? null,
      beforeSnapshot: log.beforeSnapshot ?? null,
      afterSnapshot: log.afterSnapshot ?? null,
      payload: log.payload ?? null,
    }));

    const format = req.query.format === 'csv' ? 'csv' : 'json';
    if (format === 'csv') {
      const csvBody = toCsv(exportRows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-export.csv"');
      res.status(200).send(csvBody);
      return;
    }

    res.json({
      range: {
        start: start.toISO(),
        end: end.toISO(),
      },
      locationId: locationObjectId?.toString() ?? null,
      count: exportRows.length,
      logs: exportRows,
    });
  },
);

