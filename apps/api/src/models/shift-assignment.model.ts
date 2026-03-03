import { Schema, Types, model } from 'mongoose';

export interface ShiftAssignmentDoc {
  shiftId: Types.ObjectId;
  staffId: Types.ObjectId;
  assignedBy: Types.ObjectId;
  status: 'assigned' | 'removed';
  overrideReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const shiftAssignmentSchema = new Schema<ShiftAssignmentDoc>(
  {
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['assigned', 'removed'], default: 'assigned' },
    overrideReason: { type: String },
  },
  { timestamps: true },
);

shiftAssignmentSchema.index({ staffId: 1, shiftId: 1 }, { unique: true });

export const ShiftAssignmentModel = model<ShiftAssignmentDoc>('ShiftAssignment', shiftAssignmentSchema);
