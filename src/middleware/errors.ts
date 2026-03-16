import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    const message = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    res.status(400).json({ success: false, message });
    return;
  }

  if (err instanceof Error) {
    const statusMatch = (err as Error & { status?: number; statusCode?: number });
    const status = statusMatch.status || statusMatch.statusCode || 500;
    res.status(status).json({ success: false, message: err.message });
    return;
  }

  res.status(500).json({ success: false, message: 'Internal server error' });
}
