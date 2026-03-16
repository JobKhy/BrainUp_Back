import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, requireAdmin, requireAdminOrStaff } from '../middleware/auth';

const router = Router();

// Public: active plans ordered by displayOrder
router.get('/', async (_req, res) => {
  const plans = await prisma.plan.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { displayOrder: 'asc' },
  });
  res.json({ success: true, data: plans });
});

// Admin / Staff: all plans (including inactive, excluding soft-deleted)
router.get('/all', authenticate, requireAdminOrStaff, async (_req, res) => {
  const plans = await prisma.plan.findMany({
    where: { deletedAt: null },
    orderBy: { displayOrder: 'asc' },
  });
  res.json({ success: true, data: plans });
});

// Admin / Staff: single plan
router.get('/:id', authenticate, requireAdminOrStaff, async (req, res) => {
  const plan = await prisma.plan.findUnique({ where: { id: req.params.id } });
  if (!plan || plan.deletedAt) {
    res.status(404).json({ success: false, message: 'Plan not found' });
    return;
  }
  res.json({ success: true, data: plan });
});

const planSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().min(1),
  price: z.number().positive(),
  billingCycle: z.enum(['Monthly', 'Annual']).optional(),
  includesVideos: z.boolean().optional(),
  includesCourses: z.boolean().optional(),
  isActive: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  displayOrder: z.number().int().optional(),
  stripePriceId: z.string().optional().nullable(),
});

// Create / update / delete — Admin only
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const data = planSchema.parse(req.body);
  const plan = await prisma.plan.create({
    data: {
      name: data.name,
      slug: data.slug,
      description: data.description,
      price: data.price,
      billingCycle: data.billingCycle ?? 'Monthly',
      includesVideos: data.includesVideos ?? false,
      includesCourses: data.includesCourses ?? false,
      isActive: data.isActive ?? true,
      features: data.features ?? [],
      displayOrder: data.displayOrder ?? 0,
      stripePriceId: data.stripePriceId ?? null,
    },
  });
  res.status(201).json({ success: true, data: plan });
});

router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const existing = await prisma.plan.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ success: false, message: 'Plan not found' });
    return;
  }
  const data = planSchema.partial().parse(req.body);
  const plan = await prisma.plan.update({ where: { id: req.params.id }, data });
  res.json({ success: true, data: plan });
});

// Soft delete — Admin only
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const existing = await prisma.plan.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ success: false, message: 'Plan not found' });
    return;
  }
  await prisma.plan.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });
  res.json({ success: true, data: null });
});

router.patch('/:id/toggle-active', authenticate, requireAdmin, async (req, res) => {
  const plan = await prisma.plan.findUnique({ where: { id: req.params.id } });
  if (!plan || plan.deletedAt) {
    res.status(404).json({ success: false, message: 'Plan not found' });
    return;
  }
  const updated = await prisma.plan.update({
    where: { id: req.params.id },
    data: { isActive: !plan.isActive },
  });
  res.json({ success: true, data: updated });
});

export default router;
