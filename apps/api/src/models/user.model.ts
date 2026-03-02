import { Schema, model } from 'mongoose';

export type UserRole = 'admin' | 'manager' | 'staff';
export type NotificationPreference = 'in_app_only' | 'in_app_plus_email_sim';

export interface UserDoc {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  notificationPreference: NotificationPreference;
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
    notificationPreference: {
      type: String,
      enum: ['in_app_only', 'in_app_plus_email_sim'],
      default: 'in_app_only',
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const UserModel = model<UserDoc>('User', userSchema);
