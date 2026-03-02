import { Schema, model, Types } from 'mongoose';

export interface LocationDoc {
  name: string;
  code: string;
  timezone: string;
  address?: string;
  createdAt: Date;
  updatedAt: Date;
}

const locationSchema = new Schema<LocationDoc>(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    timezone: { type: String, required: true },
    address: { type: String },
  },
  { timestamps: true },
);

export const LocationModel = model<LocationDoc>('Location', locationSchema);