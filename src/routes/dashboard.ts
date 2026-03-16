import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requireAdminOrStaff } from '../middleware/auth';

const router = Router();

router.get('/stats', authenticate, requireAdminOrStaff, async (_req, res) => {
  const [
    totalUsers,
    activeSubscriptions,
    totalVideos,
    totalCourses,
    allSubscriptions,
    recentUsers,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.subscription.count({ where: { status: 'Active' } }),
    prisma.video.count({ where: { isActive: true, deletedAt: null } }),
    prisma.course.count({ where: { isActive: true, deletedAt: null } }),
    prisma.subscription.findMany({
      where: { status: 'Active' },
      include: { plan: { select: { price: true, billingCycle: true } } },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, name: true, email: true, createdAt: true },
    }),
  ]);

  const now = new Date();

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthRevenue = allSubscriptions
    .filter((s) => s.startedAt >= monthStart)
    .reduce((sum, s) => sum + s.plan.price, 0);

  const totalRevenue = allSubscriptions.reduce((sum, s) => {
    const months = Math.ceil(
      (now.getTime() - s.startedAt.getTime()) / (1000 * 60 * 60 * 24 * 30)
    );
    return sum + s.plan.price * Math.max(1, months);
  }, 0);

  const revenueByMonth: { month: string; revenue: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const revenue = allSubscriptions
      .filter((s) => s.startedAt >= d && s.startedAt < monthEnd)
      .reduce((sum, s) => sum + s.plan.price, 0);
    revenueByMonth.push({ month: monthKey, revenue });
  }

  const recentSubActivity = allSubscriptions.slice(0, 10).map((s) => ({
    type: 'subscription' as const,
    description: `New subscription`,
    occurredAt: s.startedAt,
  }));

  const recentSignupActivity = recentUsers.map((u) => ({
    type: 'signup' as const,
    description: `${u.name} (${u.email}) registered`,
    occurredAt: u.createdAt,
  }));

  const recentActivity = [...recentSignupActivity, ...recentSubActivity]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, 20);

  res.json({
    success: true,
    data: {
      totalUsers,
      activeSubscriptions,
      totalVideos,
      totalCourses,
      monthlyRevenue: Math.round(monthRevenue * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      revenueByMonth,
      recentActivity,
    },
  });
});

export default router;
