import { Schema, Types, model } from 'mongoose';

export interface ManagerLocationDoc {
  managerId: Types.ObjectId;
  locationId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const managerLocationSchema = new Schema<ManagerLocationDoc>(
  {
    managerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
  },
  { timestamps: true },
);

managerLocationSchema.index({ managerId: 1, locationId: 1 }, { unique: true });

export const ManagerLocationModel = model<ManagerLocationDoc>(
  'ManagerLocation',
  managerLocationSchema,
);