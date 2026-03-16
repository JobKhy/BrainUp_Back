import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET as string;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

export function signAccess(payload: { userId: string; role: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function signRefresh(payload: { userId: string }): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyAccess(token: string): jwt.JwtPayload & { userId: string; role: string } {
  return jwt.verify(token, JWT_SECRET) as jwt.JwtPayload & { userId: string; role: string };
}

export function verifyRefresh(token: string): jwt.JwtPayload & { userId: string } {
  return jwt.verify(token, JWT_REFRESH_SECRET) as jwt.JwtPayload & { userId: string };
}
