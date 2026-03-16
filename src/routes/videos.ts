import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { authenticate, requireAdmin, requireAdminOrStaff } from '../middleware/auth';

const router = Router();

const JWT_SECRET = () => process.env.JWT_SECRET as string;

async function checkVideoSubscription(userId: string, role: string): Promise<boolean> {
  if (role === 'Admin' || role === 'Staff') return true;
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    include: { plan: true },
  });
  return !!(sub && sub.status === 'Active' && sub.plan.includesVideos);
}

// ─── Public / Subscriber Routes ───────────────────────────────────────────────

router.get('/categories', authenticate, async (_req, res) => {
  const videos = await prisma.video.findMany({
    where: { isActive: true, deletedAt: null },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  res.json({ success: true, data: videos.map((v) => v.category) });
});

router.get('/', authenticate, async (req, res) => {
  const hasAccess = await checkVideoSubscription(req.user.id, req.user.role);
  if (!hasAccess) {
    res.status(403).json({ success: false, message: 'Video subscription required' });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, parseInt(req.query.pageSize as string) || 20);
  const category = (req.query.category as string) || '';
  const search = (req.query.search as string) || '';

  const where: Record<string, unknown> = { isActive: true, deletedAt: null };
  if (category) where['category'] = category;
  if (search) {
    where['OR'] = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [totalCount, videos] = await Promise.all([
    prisma.video.count({ where }),
    prisma.video.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);
  res.json({
    success: true,
    data: {
      items: videos,
      page,
      pageSize,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  });
});

router.get('/stream/:token', async (req, res) => {
  const { token } = req.params;
  let decoded: { videoId: string; type: string };
  try {
    decoded = jwt.verify(token, JWT_SECRET()) as { videoId: string; type: string };
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired stream token' });
    return;
  }

  if (decoded.type !== 'stream') {
    res.status(401).json({ success: false, message: 'Invalid token type' });
    return;
  }

  const video = await prisma.video.findUnique({ where: { id: decoded.videoId } });
  if (!video || !video.isActive || video.deletedAt) {
    res.status(404).json({ success: false, message: 'Video not found' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, video.url);
});

router.get('/:id', authenticate, async (req, res) => {
  const hasAccess = await checkVideoSubscription(req.user.id, req.user.role);
  if (!hasAccess) {
    res.status(403).json({ success: false, message: 'Video subscription required' });
    return;
  }

  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video || !video.isActive || video.deletedAt) {
    res.status(404).json({ success: false, message: 'Video not found' });
    return;
  }

  const streamToken = jwt.sign(
    { videoId: video.id, type: 'stream' },
    JWT_SECRET(),
    { expiresIn: '2h' }
  );

  res.json({ success: true, data: { ...video, streamToken } });
});

// ─── Admin / Staff Routes ─────────────────────────────────────────────────────

router.get('/admin/list', authenticate, requireAdminOrStaff, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, parseInt(req.query.pageSize as string) || 20);
  const search = (req.query.search as string) || '';

  const where: Record<string, unknown> = { deletedAt: null };
  if (search) {
    where['OR'] = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { category: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [totalCount, videos] = await Promise.all([
    prisma.video.count({ where }),
    prisma.video.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);
  res.json({
    success: true,
    data: {
      items: videos,
      page,
      pageSize,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  });
});

const videoSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  url: z.string().url(),
  thumbnailUrl: z.string().url().optional().nullable(),
  category: z.string().min(1),
  durationSeconds: z.number().int().positive(),
  isActive: z.boolean().optional(),
});

router.post('/', authenticate, requireAdminOrStaff, async (req, res) => {
  const data = videoSchema.parse(req.body);
  const video = await prisma.video.create({ data: { ...data, isActive: data.isActive ?? true } });
  res.status(201).json({ success: true, data: video });
});

router.put('/:id', authenticate, requireAdminOrStaff, async (req, res) => {
  const existing = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ success: false, message: 'Video not found' });
    return;
  }
  const data = videoSchema.partial().parse(req.body);
  const video = await prisma.video.update({ where: { id: req.params.id }, data });
  res.json({ success: true, data: video });
});

// Soft delete — Admin only
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const existing = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ success: false, message: 'Video not found' });
    return;
  }
  await prisma.video.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });
  res.json({ success: true, data: null });
});

router.patch('/:id/toggle-active', authenticate, requireAdminOrStaff, async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video || video.deletedAt) {
    res.status(404).json({ success: false, message: 'Video not found' });
    return;
  }
  const updated = await prisma.video.update({
    where: { id: req.params.id },
    data: { isActive: !video.isActive },
  });
  res.json({ success: true, data: updated });
});

export default router;
