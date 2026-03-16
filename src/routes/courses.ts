import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, requireAdmin, requireAdminOrStaff } from '../middleware/auth';

const router = Router();

async function checkCourseSubscription(userId: string, role: string): Promise<boolean> {
  if (role === 'Admin' || role === 'Staff') return true;
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    include: { plan: true },
  });
  return !!(sub && sub.status === 'Active' && sub.plan.includesCourses);
}

// ─── Public Routes ────────────────────────────────────────────────────────────

router.get('/public', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, parseInt(req.query.pageSize as string) || 12);
  const search = (req.query.search as string) || '';

  const where: Record<string, unknown> = { isActive: true, deletedAt: null };
  if (search) {
    where['OR'] = [
      { title: { contains: search, mode: 'insensitive' } },
      { instructor: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [totalCount, courses] = await Promise.all([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { scheduleDate: 'asc' },
      include: { _count: { select: { enrollments: true } } },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  const items = courses.map(({ _count, ...c }) => ({
    ...c,
    enrolledCount: _count.enrollments,
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

router.get('/public/:id', async (req, res) => {
  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { enrollments: true } } },
  });

  if (!course || !course.isActive || course.deletedAt) {
    res.status(404).json({ success: false, message: 'Course not found' });
    return;
  }

  const { _count, ...c } = course;
  res.json({
    success: true,
    data: {
      ...c,
      enrolledCount: _count.enrollments,
    },
  });
});

// ─── Subscriber Routes ────────────────────────────────────────────────────────

// Must be before /:id to avoid being captured as a param
router.get('/categories', authenticate, async (_req, res) => {
  const results = await prisma.course.findMany({
    where: { isActive: true, deletedAt: null },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  res.json({ success: true, data: results.map(r => r.category).filter(Boolean) });
});

router.get('/', authenticate, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, parseInt(req.query.pageSize as string) || 20);
  const search = (req.query.search as string) || '';
  const category = (req.query.category as string) || '';
  const enrolledOnly = req.query.enrolled === 'true';

  const where: Record<string, unknown> = { isActive: true, deletedAt: null };
  if (search) {
    where['OR'] = [
      { title: { contains: search, mode: 'insensitive' } },
      { instructor: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (category) {
    where['category'] = { equals: category, mode: 'insensitive' };
  }
  if (enrolledOnly) {
    where['enrollments'] = { some: { userId: req.user.id } };
  }

  // Fetch all matching courses (no DB pagination) so we can filter ended ones in memory
  const courses = await prisma.course.findMany({
    where,
    orderBy: { scheduleDate: 'asc' },
    include: {
      _count: { select: { enrollments: true } },
      enrollments: {
        where: { userId: req.user.id },
        select: { id: true },
      },
    },
  });

  // Filter out courses that have already ended (scheduleDate + durationWeeks * 7 days < now)
  const now = Date.now();
  const activeCourses = courses.filter(c => {
    const endMs = new Date(c.scheduleDate).getTime() + c.durationWeeks * 7 * 24 * 60 * 60 * 1000;
    return endMs >= now;
  });

  const totalCount = activeCourses.length;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const paginated = activeCourses.slice((page - 1) * pageSize, page * pageSize);

  const items = paginated.map(({ _count, enrollments, ...c }) => ({
    ...c,
    enrolledCount: _count.enrollments,
    availableSeats: c.maxSeats - _count.enrollments,
    isEnrolled: enrollments.length > 0,
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

router.get('/:id', authenticate, async (req, res) => {
  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    include: {
      _count: { select: { enrollments: true } },
      enrollments: {
        where: { userId: req.user.id },
        select: { id: true },
      },
    },
  });

  if (!course || !course.isActive || course.deletedAt) {
    res.status(404).json({ success: false, message: 'Course not found' });
    return;
  }

  const { _count, enrollments, ...c } = course;
  res.json({
    success: true,
    data: {
      ...c,
      enrolledCount: _count.enrollments,
      availableSeats: c.maxSeats - _count.enrollments,
      isEnrolled: enrollments.length > 0,
    },
  });
});

router.post('/:id/enroll', authenticate, async (req, res) => {
  const hasAccess = await checkCourseSubscription(req.user.id, req.user.role);
  if (!hasAccess) {
    res.status(403).json({ success: false, message: 'Course subscription required' });
    return;
  }

  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { enrollments: true } } },
  });
  if (!course || !course.isActive || course.deletedAt) {
    res.status(404).json({ success: false, message: 'Course not found' });
    return;
  }

  const alreadyEnrolled = await prisma.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: req.user.id, courseId: course.id } },
  });
  if (alreadyEnrolled) {
    res.status(409).json({ success: false, message: 'Already enrolled in this course' });
    return;
  }

  if (course._count.enrollments >= course.maxSeats) {
    res.status(400).json({ success: false, message: 'No seats available' });
    return;
  }

  const enrollment = await prisma.courseEnrollment.create({
    data: { userId: req.user.id, courseId: course.id },
  });
  res.status(201).json({ success: true, data: enrollment });
});

router.delete('/:id/enroll', authenticate, async (req, res) => {
  const enrollment = await prisma.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: req.user.id, courseId: req.params.id } },
  });
  if (!enrollment) {
    res.status(404).json({ success: false, message: 'Enrollment not found' });
    return;
  }
  await prisma.courseEnrollment.delete({
    where: { userId_courseId: { userId: req.user.id, courseId: req.params.id } },
  });
  res.json({ success: true, data: null });
});

// ─── Admin / Staff Routes ─────────────────────────────────────────────────────

router.get('/admin/list', authenticate, requireAdminOrStaff, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, parseInt(req.query.pageSize as string) || 20);
  const search = (req.query.search as string) || '';

  const where: Record<string, unknown> = { deletedAt: null };
  if (search) {
    where['OR'] = [
      { title: { contains: search, mode: 'insensitive' as const } },
      { instructor: { contains: search, mode: 'insensitive' as const } },
    ];
  }

  const [totalCount, courses] = await Promise.all([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { enrollments: true } } },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  const items = courses.map(({ _count, ...c }) => ({
    ...c,
    enrolledCount: _count.enrollments,
    availableSeats: c.maxSeats - _count.enrollments,
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

router.get('/admin/:id', authenticate, requireAdminOrStaff, async (req, res) => {
  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { enrollments: true } } },
  });
  if (!course || course.deletedAt) {
    res.status(404).json({ success: false, message: 'Course not found' });
    return;
  }
  const { _count, ...c } = course;
  res.json({
    success: true,
    data: {
      ...c,
      enrolledCount: _count.enrollments,
      availableSeats: c.maxSeats - _count.enrollments,
    },
  });
});

const courseSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  instructor: z.string().min(1),
  category: z.string().optional(),
  scheduleDate: z.string().datetime(),
  durationMinutes: z.number().int().positive(),
  durationWeeks: z.number().int().min(1).optional(),
  price: z.number().min(0).optional(),
  stripePriceId: z.string().optional().nullable(),
  maxSeats: z.number().int().positive(),
  isActive: z.boolean().optional(),
});

router.post('/', authenticate, requireAdminOrStaff, async (req, res) => {
  const data = courseSchema.parse(req.body);
  const course = await prisma.course.create({
    data: {
      ...data,
      scheduleDate: new Date(data.scheduleDate),
      durationWeeks: data.durationWeeks ?? 1,
      price: data.price ?? 0,
      isActive: data.isActive ?? true,
    },
  });
  res.status(201).json({ success: true, data: course });
});

router.put('/:id', authenticate, requireAdminOrStaff, async (req, res) => {
  const existing = await prisma.course.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ success: false, message: 'Course not found' });
    return;
  }
  const data = courseSchema.partial().parse(req.body);
  const updateData: Record<string, unknown> = { ...data };
  if (data.scheduleDate) updateData['scheduleDate'] = new Date(data.scheduleDate);
  const course = await prisma.course.update({ where: { id: req.params.id }, data: updateData });
  res.json({ success: true, data: course });
});

// Soft delete — Admin only
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const existing = await prisma.course.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ success: false, message: 'Course not found' });
    return;
  }
  await prisma.course.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });
  res.json({ success: true, data: null });
});

router.patch('/:id/toggle-active', authenticate, requireAdminOrStaff, async (req, res) => {
  const course = await prisma.course.findUnique({ where: { id: req.params.id } });
  if (!course || course.deletedAt) {
    res.status(404).json({ success: false, message: 'Course not found' });
    return;
  }
  const updated = await prisma.course.update({
    where: { id: req.params.id },
    data: { isActive: !course.isActive },
  });
  res.json({ success: true, data: updated });
});

export default router;
