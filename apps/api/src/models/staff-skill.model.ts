import { Schema, Types, model } from 'mongoose';

export interface StaffSkillDoc {
  staffId: Types.ObjectId;
  skill: string;
  level?: string;
  createdAt: Date;
  updatedAt: Date;
}

const staffSkillSchema = new Schema<StaffSkillDoc>(
  {
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    skill: { type: String, required: true },
    level: { type: String },
  },
  { timestamps: true },
);

staffSkillSchema.index({ staffId: 1, skill: 1 }, { unique: true });

export const StaffSkillModel = model<StaffSkillDoc>('StaffSkill', staffSkillSchema);