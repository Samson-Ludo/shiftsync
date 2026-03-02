import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Types } from 'mongoose';
import { authenticateJwt, AuthenticatedRequest } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import {
  ManagerLocationModel,
  LocationModel,
  StaffCertificationModel,
  UserModel,
} from '../models/index.js';
import { signJwt } from '../utils/jwt.js';

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
});

export const authRouter = Router();

authRouter.post('/login', validateRequest(loginSchema), async (req, res) => {
  const { email, password } = req.body;

  const user = await UserModel.findOne({ email: email.toLowerCase() });
  if (!user || !user.active) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const token = signJwt({
    userId: user._id.toString(),
    role: user.role,
    email: user.email,
  });

  res.json({
    token,
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  });
});

authRouter.get('/me', authenticateJwt, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.userId;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    res.status(401).json({ message: 'Invalid user token' });
    return;
  }

  const user = await UserModel.findById(userId).lean();
  if (!user || !user.active) {
    res.status(401).json({ message: 'User not found or inactive' });
    return;
  }

  const result: Record<string, unknown> = {
    id: user._id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  };

  if (user.role === 'manager') {
    const locations = await ManagerLocationModel.find({ managerId: user._id })
      .populate('locationId', 'name code timezone')
      .lean();
    result.managerLocations = locations.map((row) => row.locationId);
  }

  if (user.role === 'admin') {
    const allLocations = await LocationModel.find({}).select('name code timezone').lean();
    result.managerLocations = allLocations;
  }

  if (user.role === 'staff') {
    const certifications = await StaffCertificationModel.find({ staffId: user._id })
      .populate('locationId', 'name code timezone')
      .lean();
    result.certifiedLocations = certifications.map((row) => ({
      location: row.locationId,
      certification: row.certification,
    }));
  }

  res.json({ user: result });
});
