import { Request, Response, NextFunction } from 'express';
import { verifyAccess } from '../lib/jwt';

declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
        role: string;
      };
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'No token provided' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = verifyAccess(token);
    req.user = { id: decoded.userId, role: decoded.role };
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

/** Admin only — destructive actions, plan edits, subscription management */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'Admin') {
    res.status(403).json({ success: false, message: 'Forbidden: admin access required' });
    return;
  }
  next();
}

/** Admin or Staff — read/write access but not delete or plan/subscription mutations */
export function requireAdminOrStaff(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || (req.user.role !== 'Admin' && req.user.role !== 'Staff')) {
    res.status(403).json({ success: false, message: 'Forbidden: staff access required' });
    return;
  }
  next();
}
