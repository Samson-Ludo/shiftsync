import { Schema, Types, model } from 'mongoose';

export interface AuditLogDoc {
  actorUserId: Types.ObjectId;
  action: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    payload: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export const AuditLogModel = model<AuditLogDoc>('AuditLog', auditLogSchema);