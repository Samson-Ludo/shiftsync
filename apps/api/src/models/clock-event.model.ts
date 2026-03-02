import { Schema, Types, model } from 'mongoose';

export type ClockEventType = 'clock_in' | 'clock_out';

export interface ClockEventDoc {
  staffId: Types.ObjectId;
  locationId: Types.ObjectId;
  shiftId?: Types.ObjectId;
  eventType: ClockEventType;
  atUtc: string;
  createdAt: Date;
  updatedAt: Date;
}

const clockEventSchema = new Schema<ClockEventDoc>(
  {
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift' },
    eventType: { type: String, enum: ['clock_in', 'clock_out'], required: true },
    atUtc: { type: String, required: true },
  },
  { timestamps: true },
);

clockEventSchema.index({ staffId: 1, atUtc: -1 });

export const ClockEventModel = model<ClockEventDoc>('ClockEvent', clockEventSchema);