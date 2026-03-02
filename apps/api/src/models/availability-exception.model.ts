import { Schema, Types, model } from 'mongoose';

export type AvailabilityExceptionType = 'available' | 'unavailable';

export interface AvailabilityExceptionDoc {
  staffId: Types.ObjectId;
  dateLocal: string;
  timezone: string;
  type: AvailabilityExceptionType;
  startLocalTime?: string;
  endLocalTime?: string;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const availabilityExceptionSchema = new Schema<AvailabilityExceptionDoc>(
  {
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dateLocal: { type: String, required: true },
    timezone: { type: String, required: true },
    type: { type: String, enum: ['available', 'unavailable'], required: true },
    startLocalTime: { type: String },
    endLocalTime: { type: String },
    reason: { type: String },
  },
  { timestamps: true },
);

availabilityExceptionSchema.index({ staffId: 1, dateLocal: 1 });

export const AvailabilityExceptionModel = model<AvailabilityExceptionDoc>(
  'AvailabilityException',
  availabilityExceptionSchema,
);