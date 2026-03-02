import { Schema, model } from 'mongoose';

export type UserRole = 'admin' | 'manager' | 'staff';

export interface UserDoc {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    role: { type: String, enum: ['admin', 'manager', 'staff'], required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const UserModel = model<UserDoc>('User', userSchema);