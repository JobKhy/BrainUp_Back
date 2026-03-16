import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requireAdmin, requireAdminOrStaff } from '../middleware/auth';
import { stripe } from '../lib/stripe';

const router = Router();

function formatSubscription(sub: {
  id: string;
  planId: string;
  startedAt: Date;
  expiresAt: Date;
  status: string;
  plan: {
    name: string;
    price: number;
    billingCycle: string;
    includesVideos: boolean;
    includesCourses: boolean;
  };
  stripeSubscriptionId?: string | null;
}) {
  return {
    id: sub.id,
    planId: sub.planId,
    planName: sub.plan.name,
    planPrice: sub.plan.price,
    status: sub.status,
    startedAt: sub.startedAt,
    expiresAt: sub.expiresAt,
    includesVideos: sub.plan.includesVideos,
    includesCourses: sub.plan.includesCourses,
    billingCycle: sub.plan.billingCycle,
    hasStripeSubscription: !!sub.stripeSubscriptionId,
  };
}

// GET /subscriptions/my
router.get('/my', authenticate, async (req, res) => {
  const sub = await prisma.subscription.findUnique({
    where: { userId: req.user.id },
    include: { plan: true },
  });

  if (!sub) {
    res.json({ success: true, data: null });
    return;
  }

  res.json({ success: true, data: formatSubscription(sub) });
});

// PUT /subscriptions/my/cancel — user cancels own subscription
router.put('/my/cancel', authenticate, async (req, res) => {
  const sub = await prisma.subscription.findUnique({
    where: { userId: req.user.id },
  });

  if (!sub) {
    res.status(404).json({ success: false, message: 'No active subscription found' });
    return;
  }

  if (sub.stripeSubscriptionId) {
    try {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
    } catch (err) {
      console.error('Failed to cancel Stripe subscription:', err);
    }
  }

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: 'Cancelled' },
    include: { plan: true },
  });

  res.json({ success: true, data: formatSubscription(updated) });
});

// GET /subscriptions — Admin or Staff: paginated list (read-only for Staff)
router.get('/', authenticate, requireAdminOrStaff, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, parseInt(req.query.pageSize as string) || 20);
  const status = (req.query.status as string) || '';

  const where = status ? { status: status as 'Active' | 'Expired' | 'Cancelled' } : {};

  const [totalCount, subs] = await Promise.all([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { startedAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        plan: { select: { name: true, price: true } },
      },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  const items = subs.map((s) => ({
    id: s.id,
    userName: s.user.name,
    userEmail: s.user.email,
    planName: s.plan.name,
    planPrice: s.plan.price,
    status: s.status,
    startedAt: s.startedAt,
    expiresAt: s.expiresAt,
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

// PUT /subscriptions/:id/cancel — Admin only: cancel any subscription
router.put('/:id/cancel', authenticate, requireAdmin, async (req, res) => {
  const sub = await prisma.subscription.findUnique({
    where: { id: req.params.id },
    include: { plan: true },
  });

  if (!sub) {
    res.status(404).json({ success: false, message: 'Subscription not found' });
    return;
  }

  if (sub.stripeSubscriptionId) {
    try {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
    } catch (err) {
      console.error('Failed to cancel Stripe subscription:', err);
    }
  }

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: 'Cancelled' },
    include: { plan: true },
  });

  res.json({ success: true, data: formatSubscription(updated) });
});

export default router;
