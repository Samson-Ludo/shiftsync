import { Schema, Types, model } from 'mongoose';

export interface AuditLogDoc {
  actorId: string;
  actorUserId?: Types.ObjectId;
  action: string;
  entityType: string;
  entityId: string;
  locationId?: Types.ObjectId;
  beforeSnapshot?: Record<string, unknown>;
  afterSnapshot?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    actorId: { type: String, required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
    beforeSnapshot: { type: Schema.Types.Mixed },
    afterSnapshot: { type: Schema.Types.Mixed },
    payload: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ locationId: 1, createdAt: -1 });

export const AuditLogModel = model<AuditLogDoc>('AuditLog', auditLogSchema);
