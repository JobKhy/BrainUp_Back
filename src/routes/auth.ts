import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma';
import { signAccess, signRefresh, verifyRefresh } from '../lib/jwt';
import { authenticate } from '../middleware/auth';

const router = Router();

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
});

function calcRefreshExpiry(): Date {
  const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  const days = parseInt(expiresIn) || 7;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

router.post('/register', async (req, res) => {
  const { name, email, password, phone } = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ success: false, message: 'Email already registered' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, phone },
  });

  const accessToken = signAccess({ userId: user.id, role: user.role });
  const refreshToken = signRefresh({ userId: user.id });

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: calcRefreshExpiry(),
    },
  });

  res.status(201).json({
    success: true,
    data: {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    },
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
    return;
  }

  if (!user.isActive) {
    res.status(401).json({ success: false, message: 'Account is deactivated' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
    return;
  }

  const accessToken = signAccess({ userId: user.id, role: user.role });
  const refreshToken = signRefresh({ userId: user.id });

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: calcRefreshExpiry(),
    },
  });

  res.json({
    success: true,
    data: {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    },
  });
});

router.post('/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).json({ success: false, message: 'Refresh token required' });
    return;
  }

  let decoded: { userId: string };
  try {
    decoded = verifyRefresh(refreshToken);
  } catch {
    res.status(401).json({ success: false, message: 'Invalid refresh token' });
    return;
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
  if (!stored || stored.expiresAt < new Date()) {
    res.status(401).json({ success: false, message: 'Refresh token expired or not found' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  if (!user || !user.isActive) {
    res.status(401).json({ success: false, message: 'User not found or inactive' });
    return;
  }

  const newAccessToken = signAccess({ userId: user.id, role: user.role });
  const newRefreshToken = signRefresh({ userId: user.id });

  // Rotate: delete old, create new
  await prisma.refreshToken.delete({ where: { token: refreshToken } });
  await prisma.refreshToken.create({
    data: {
      token: newRefreshToken,
      userId: user.id,
      expiresAt: calcRefreshExpiry(),
    },
  });

  res.json({
    success: true,
    data: {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    },
  });
});

router.post('/logout', authenticate, async (req, res) => {
  await prisma.refreshToken.deleteMany({ where: { userId: req.user.id } });
  res.json({ success: true, data: null });
});

export default router;
