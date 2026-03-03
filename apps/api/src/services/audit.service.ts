import { ClientSession, Types } from 'mongoose';
import { AuditLogModel } from '../models/index.js';

type AuditSnapshot = Record<string, unknown> | null | undefined;

type RecordAuditLogInput = {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  locationId?: string | Types.ObjectId;
  beforeSnapshot?: AuditSnapshot;
  afterSnapshot?: AuditSnapshot;
  payload?: Record<string, unknown>;
  session?: ClientSession;
};

const toObjectId = (value: string | Types.ObjectId | undefined): Types.ObjectId | undefined => {
  if (!value) {
    return undefined;
  }

  if (value instanceof Types.ObjectId) {
    return value;
  }

  if (!Types.ObjectId.isValid(value)) {
    return undefined;
  }

  return new Types.ObjectId(value);
};

const toActorUserId = (actorId: string): Types.ObjectId | undefined => {
  if (!Types.ObjectId.isValid(actorId)) {
    return undefined;
  }

  return new Types.ObjectId(actorId);
};

export const recordAuditLog = async (input: RecordAuditLogInput): Promise<void> => {
  const doc = {
    actorId: input.actorId,
    actorUserId: toActorUserId(input.actorId),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    locationId: toObjectId(input.locationId),
    ...(input.beforeSnapshot !== undefined ? { beforeSnapshot: input.beforeSnapshot } : {}),
    ...(input.afterSnapshot !== undefined ? { afterSnapshot: input.afterSnapshot } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
  };

  await AuditLogModel.create([doc], input.session ? { session: input.session } : undefined);
};

