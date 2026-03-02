import { Schema, Types, model } from 'mongoose';

export interface NotificationDoc {
  userId: Types.ObjectId;
  type: string;
  title: string;
  body: string;
  read: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    read: { type: Boolean, default: false },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export const NotificationModel = model<NotificationDoc>('Notification', notificationSchema);