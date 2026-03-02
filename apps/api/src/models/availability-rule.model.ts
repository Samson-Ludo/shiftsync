import { Schema, Types, model } from 'mongoose';

export interface AvailabilityRuleDoc {
  staffId: Types.ObjectId;
  locationId?: Types.ObjectId;
  dayOfWeek: number;
  startLocalTime: string;
  endLocalTime: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

const availabilityRuleSchema = new Schema<AvailabilityRuleDoc>(
  {
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
    dayOfWeek: { type: Number, min: 1, max: 7, required: true },
    startLocalTime: { type: String, required: true },
    endLocalTime: { type: String, required: true },
    timezone: { type: String, required: true },
  },
  { timestamps: true },
);

availabilityRuleSchema.index({ staffId: 1, dayOfWeek: 1 });

export const AvailabilityRuleModel = model<AvailabilityRuleDoc>('AvailabilityRule', availabilityRuleSchema);