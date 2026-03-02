import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export type AuthRole = 'admin' | 'manager' | 'staff';

export interface AuthUser {
  userId: string;
  role: AuthRole;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export const authenticateJwt = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthUser;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};