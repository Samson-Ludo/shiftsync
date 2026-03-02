import { Schema, Types, model } from 'mongoose';

export interface ShiftDoc {
  locationId: Types.ObjectId;
  title: string;
  requiredSkill?: string;
  timezone: string;
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
  startAtUtc: string;
  endAtUtc: string;
  overnight: boolean;
  weekStartLocal: string;
  published: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const shiftSchema = new Schema<ShiftDoc>(
  {
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    title: { type: String, required: true },
    requiredSkill: { type: String },
    timezone: { type: String, required: true },
    localDate: { type: String, required: true },
    startLocalTime: { type: String, required: true },
    endLocalTime: { type: String, required: true },
    startAtUtc: { type: String, required: true },
    endAtUtc: { type: String, required: true },
    overnight: { type: Boolean, default: false },
    weekStartLocal: { type: String, required: true },
    published: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

shiftSchema.index({ locationId: 1, startAtUtc: 1 });

export const ShiftModel = model<ShiftDoc>('Shift', shiftSchema);
