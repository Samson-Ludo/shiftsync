import { Schema, Types, model } from 'mongoose';

export interface StaffProfileDoc {
  userId: Types.ObjectId;
  maxHoursPerWeek: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const staffProfileSchema = new Schema<StaffProfileDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    maxHoursPerWeek: { type: Number, default: 40 },
    notes: { type: String },
  },
  { timestamps: true },
);

export const StaffProfileModel = model<StaffProfileDoc>('StaffProfile', staffProfileSchema);