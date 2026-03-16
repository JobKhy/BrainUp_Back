import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, requireAdmin, requireAdminOrStaff } from '../middleware/auth';

const router = Router();

function formatConsulting(c: {
  id: string;
  userId: string;
  totalHours: number;
  usedHours: number;
  whatsapp: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...c,
    remainingHours: Math.max(0, c.totalHours - c.usedHours),
  };
}

// ─── User Routes ──────────────────────────────────────────────────────────────

// GET /consulting/my — get own consulting balance + history
router.get('/my', authenticate, async (req, res) => {
  const consulting = await prisma.consulting.findUnique({
    where: { userId: req.user.id },
    include: {
      purchases: { orderBy: { purchasedAt: 'desc' } },
      deductions: {
        orderBy: { createdAt: 'desc' },
        include: { admin: { select: { name: true } } },
      },
    },
  });

  if (!consulting) {
    res.json({ success: true, data: null });
    return;
  }

  const { purchases, deductions, ...base } = consulting;
  res.json({
    success: true,
    data: {
      ...formatConsulting(base),
      purchases,
      deductions: deductions.map(({ admin, ...d }) => ({
        ...d,
        adminName: admin.name,
      })),
    },
  });
});

// PUT /consulting/my/whatsapp — update own WhatsApp number
router.put('/my/whatsapp', authenticate, async (req, res) => {
  const schema = z.object({ whatsapp: z.string().min(1) });
  const { whatsapp } = schema.parse(req.body);

  const consulting = await prisma.consulting.upsert({
    where: { userId: req.user.id },
    update: { whatsapp },
    create: { userId: req.user.id, whatsapp },
  });

  res.json({ success: true, data: formatConsulting(consulting) });
});

// ─── Admin / Staff Routes ─────────────────────────────────────────────────────

// GET /consulting — paginated list of all consulting accounts
router.get('/', authenticate, requireAdminOrStaff, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, parseInt(req.query.pageSize as string) || 20);

  const [totalCount, accounts] = await Promise.all([
    prisma.consulting.count(),
    prisma.consulting.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  const items = accounts.map(({ user, ...c }) => ({
    ...formatConsulting(c),
    userName: user.name,
    userEmail: user.email,
  }));

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

// GET /consulting/:userId — get a specific user's consulting detail
router.get('/:userId', authenticate, requireAdminOrStaff, async (req, res) => {
  const consulting = await prisma.consulting.findUnique({
    where: { userId: req.params.userId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      purchases: { orderBy: { purchasedAt: 'desc' } },
      deductions: {
        orderBy: { createdAt: 'desc' },
        include: { admin: { select: { name: true } } },
      },
    },
  });

  if (!consulting) {
    res.status(404).json({ success: false, message: 'Consulting account not found' });
    return;
  }

  const { user, purchases, deductions, ...base } = consulting;
  res.json({
    success: true,
    data: {
      ...formatConsulting(base),
      userName: user.name,
      userEmail: user.email,
      purchases,
      deductions: deductions.map(({ admin, ...d }) => ({
        ...d,
        adminName: admin.name,
      })),
    },
  });
});

// POST /consulting/:userId/add — Admin only: manually add hours (e.g. after payment)
router.post('/:userId/add', authenticate, requireAdmin, async (req, res) => {
  const schema = z.object({
    packageType: z.enum(['Hourly', 'Pack8']),
    stripePriceId: z.string().optional().nullable(),
    stripeSessionId: z.string().optional().nullable(),
  });
  const { packageType, stripePriceId, stripeSessionId } = schema.parse(req.body);

  const hours = packageType === 'Pack8' ? 8 : 1;

  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
  });
  if (!user || user.deletedAt) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  const consulting = await prisma.consulting.upsert({
    where: { userId: req.params.userId },
    update: { totalHours: { increment: hours } },
    create: { userId: req.params.userId, totalHours: hours },
  });

  await prisma.consultingPurchase.create({
    data: {
      consultingId: consulting.id,
      packageType,
      hours,
      stripePriceId: stripePriceId ?? null,
      stripeSessionId: stripeSessionId ?? null,
    },
  });

  res.status(201).json({ success: true, data: formatConsulting(consulting) });
});

// POST /consulting/:userId/deduct — Admin only: subtract consumed hours
router.post('/:userId/deduct', authenticate, requireAdmin, async (req, res) => {
  const schema = z.object({
    hours: z.number().positive(),
    note: z.string().optional(),
  });
  const { hours, note } = schema.parse(req.body);

  const consulting = await prisma.consulting.findUnique({
    where: { userId: req.params.userId },
  });
  if (!consulting) {
    res.status(404).json({ success: false, message: 'Consulting account not found' });
    return;
  }

  const remaining = consulting.totalHours - consulting.usedHours;
  if (hours > remaining) {
    res.status(400).json({
      success: false,
      message: `Cannot deduct ${hours}h — only ${remaining}h remaining`,
    });
    return;
  }

  const [updated] = await prisma.$transaction([
    prisma.consulting.update({
      where: { id: consulting.id },
      data: { usedHours: { increment: hours } },
    }),
    prisma.consultingDeduction.create({
      data: {
        consultingId: consulting.id,
        hoursDeducted: hours,
        note: note ?? null,
        adminId: req.user.id,
      },
    }),
  ]);

  res.json({ success: true, data: formatConsulting(updated) });
});

export default router;
