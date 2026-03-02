import { Schema, model } from 'mongoose';

export interface LockDoc {
  key: string;
  owner: string;
  expiresAtUtc: Date;
  createdAt: Date;
  updatedAt: Date;
}

const lockSchema = new Schema<LockDoc>(
  {
    key: { type: String, required: true, unique: true },
    owner: { type: String, required: true },
    expiresAtUtc: { type: Date, required: true },
  },
  { timestamps: true },
);

lockSchema.index({ expiresAtUtc: 1 }, { expireAfterSeconds: 0 });

export const LockModel = model<LockDoc>('Lock', lockSchema);
