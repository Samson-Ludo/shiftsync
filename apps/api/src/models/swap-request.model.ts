import { Schema, Types, model } from 'mongoose';

export type SwapStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface SwapRequestDoc {
  shiftId: Types.ObjectId;
  fromStaffId: Types.ObjectId;
  toStaffId?: Types.ObjectId;
  status: SwapStatus;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const swapRequestSchema = new Schema<SwapRequestDoc>(
  {
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
    fromStaffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    toStaffId: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
    note: { type: String },
  },
  { timestamps: true },
);

swapRequestSchema.index({ fromStaffId: 1, status: 1 });

export const SwapRequestModel = model<SwapRequestDoc>('SwapRequest', swapRequestSchema);