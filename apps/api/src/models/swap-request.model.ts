import { Schema, Types, model } from 'mongoose';

export type SwapRequestType = 'swap' | 'drop';
export type SwapStatus =
  | 'pending'
  | 'accepted'
  | 'claimed'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export interface SwapRequestDoc {
  type: SwapRequestType;
  shiftId: Types.ObjectId;
  fromStaffId: Types.ObjectId;
  toStaffId?: Types.ObjectId;
  status: SwapStatus;
  expiresAtUtc: Date;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const swapRequestSchema = new Schema<SwapRequestDoc>(
  {
    type: { type: String, enum: ['swap', 'drop'], required: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
    fromStaffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    toStaffId: { type: Schema.Types.ObjectId, ref: 'User' },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'claimed', 'approved', 'rejected', 'cancelled', 'expired'],
      default: 'pending',
    },
    expiresAtUtc: { type: Date, required: true },
    note: { type: String },
  },
  { timestamps: true },
);

swapRequestSchema.index({ fromStaffId: 1, status: 1 });
swapRequestSchema.index({ shiftId: 1, status: 1 });
swapRequestSchema.index({ type: 1, status: 1, expiresAtUtc: 1 });

export const SwapRequestModel = model<SwapRequestDoc>('SwapRequest', swapRequestSchema);
