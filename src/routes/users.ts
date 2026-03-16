import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma';
import { authenticate, requireAdmin, requireAdminOrStaff } from '../middleware/auth';

const router = Router();

// ─── Current User ─────────────────────────────────────────────────────────────

router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: {
      subscription: {
        include: { plan: true },
      },
    },
  });
  if (!user || user.deletedAt) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }
  const { passwordHash, ...rest } = user;
  void passwordHash;
  res.json({ success: true, data: rest });
});

router.put('/me', authenticate, async (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
  });
  const { name, email, phone } = schema.parse(req.body);

  const emailConflict = await prisma.user.findFirst({
    where: { email, NOT: { id: req.user.id }, deletedAt: null },
  });
  if (emailConflict) {
    res.status(409).json({ success: false, message: 'Email already in use' });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { name, email, phone },
  });
  const { passwordHash, ...rest } = updated;
  void passwordHash;
  res.json({ success: true, data: rest });
});

router.post('/me/change-password', authenticate, async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6),
  });
  const { currentPassword, newPassword } = schema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || user.deletedAt) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ success: false, message: 'Current password is incorrect' });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash: newHash },
  });

  res.json({ success: true, data: null });
});

// ─── Admin / Staff Endpoints ──────────────────────────────────────────────────

router.get('/', authenticate, requireAdminOrStaff, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, parseInt(req.query.pageSize as string) || 20);
  const search = (req.query.search as string) || '';

  const where: Record<string, unknown> = { deletedAt: null };
  if (search) {
    where['OR'] = [
      { name: { contains: search, mode: 'insensitive' as const } },
      { email: { contains: search, mode: 'insensitive' as const } },
    ];
  }

  const [totalCount, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: {
          include: { plan: { select: { name: true } } },
        },
      },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  const items = users.map(({ passwordHash, subscription, ...u }) => {
    void passwordHash;
    return {
      ...u,
      subscription: subscription
        ? { planName: subscription.plan.name, status: subscription.status }
        : null,
    };
  });

  res.json({
    success: true,
    data: {
      items,
      page,
      pageSize,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  });
});

router.get('/:id', authenticate, requireAdminOrStaff, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      subscription: { include: { plan: true } },
      enrollments: {
        include: { course: { select: { id: true, title: true, scheduleDate: true } } },
        orderBy: { enrolledAt: 'desc' },
      },
      consulting: { include: { purchases: { orderBy: { purchasedAt: 'desc' }, take: 5 } } },
    },
  });
  if (!user || user.deletedAt) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }
  const { passwordHash, ...rest } = user;
  void passwordHash;
  res.json({ success: true, data: rest });
});

router.put('/:id/activate', authenticate, requireAdminOrStaff, async (req, res) => {
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive: true },
  });
  const { passwordHash, ...rest } = user;
  void passwordHash;
  res.json({ success: true, data: rest });
});

router.put('/:id/deactivate', authenticate, requireAdminOrStaff, async (req, res) => {
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  const { passwordHash, ...rest } = user;
  void passwordHash;
  res.json({ success: true, data: rest });
});

// Soft delete — Admin only
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }
  await prisma.user.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });
  res.json({ success: true, data: null });
});

export default router;
