import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AuthRole } from '../middleware/auth.js';

export const signJwt = (payload: { userId: string; role: AuthRole; email: string }): string => {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
};
