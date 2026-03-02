import { Schema, Types, model } from 'mongoose';

export interface StaffCertificationDoc {
  staffId: Types.ObjectId;
  locationId: Types.ObjectId;
  certification: string;
  createdAt: Date;
  updatedAt: Date;
}

const staffCertificationSchema = new Schema<StaffCertificationDoc>(
  {
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    certification: { type: String, default: 'general' },
  },
  { timestamps: true },
);

staffCertificationSchema.index({ staffId: 1, locationId: 1, certification: 1 }, { unique: true });

export const StaffCertificationModel = model<StaffCertificationDoc>(
  'StaffCertification',
  staffCertificationSchema,
);