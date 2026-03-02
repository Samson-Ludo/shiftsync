import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, AuthRole } from './auth.js';

export const requireRoles = (...roles: AuthRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }

    next();
  };
};