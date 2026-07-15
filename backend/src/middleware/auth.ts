import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types';

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

// API key auth for Camera AI ingest endpoints (events, heartbeat).
// Reads `x-api-key` header and compares with CAMERA_API_KEY env.
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const provided = req.headers['x-api-key'];
  const expected = process.env.CAMERA_API_KEY;

  if (!expected) {
    res.status(500).json({ success: false, message: 'CAMERA_API_KEY not configured on server' });
    return;
  }
  if (!provided || provided !== expected) {
    res.status(401).json({ success: false, message: 'Invalid or missing API key' });
    return;
  }
  next();
}

export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
