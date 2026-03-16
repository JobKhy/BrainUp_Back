import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, requireAdminOrStaff } from '../middleware/auth';

const router = Router();

const createSchema = z.object({
  subject: z.string().min(1),
  topic: z.string().min(1),
  preferredDate: z.string().datetime(),
  notes: z.string().optional(),
});

const statusSchema = z.object({
  status: z.enum(['Pending', 'Scheduled', 'Completed', 'Cancelled']),
});

const assignSchema = z.object({
  assignedToId: z.string().uuid(),
});

// POST /consulting-requests — create request (auth required)
router.post('/', authenticate, async (req, res) => {
  const data = createSchema.parse(req.body);
  const request = await prisma.consultingRequest.create({
    data: {
      userId: req.user.id,
      subject: data.subject,
      topic: data.topic,
      preferredDate: new Date(data.preferredDate),
      notes: data.notes,
      status: 'Pending',
    },
  });
  res.status(201).json({ success: true, data: request });
});

// GET /consulting-requests/my — user's own requests
router.get('/my', authenticate, async (req, res) => {
  const requests = await prisma.consultingRequest.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      assignedTo: { select: { name: true } },
    },
  });
  res.json({ success: true, data: requests });
});

// GET /consulting-requests — admin/staff paginated list
router.get('/', authenticate, requireAdminOrStaff, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, parseInt(req.query.pageSize as string) || 20);
  const statusFilter = req.query.status as string | undefined;

  const where: Record<string, unknown> = {};
  if (statusFilter && ['Pending', 'Scheduled', 'Completed', 'Cancelled'].includes(statusFilter)) {
    where['status'] = statusFilter;
  }

  const [totalCount, requests] = await Promise.all([
    prisma.consultingRequest.count({ where }),
    prisma.consultingRequest.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { name: true, email: true, phone: true } },
        assignedTo: { select: { name: true } },
      },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  res.json({
    success: true,
    data: {
      items: requests,
      page,
      pageSize,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  });
});

// PUT /consulting-requests/:id/status — update status (admin/staff)
router.put('/:id/status', authenticate, requireAdminOrStaff, async (req, res) => {
  const existing = await prisma.consultingRequest.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ success: false, message: 'Consulting request not found' });
    return;
  }
  const { status } = statusSchema.parse(req.body);
  const updated = await prisma.consultingRequest.update({
    where: { id: req.params.id },
    data: { status },
  });
  res.json({ success: true, data: updated });
});

// PUT /consulting-requests/:id/assign — assign to staff/admin
router.put('/:id/assign', authenticate, requireAdminOrStaff, async (req, res) => {
  const existing = await prisma.consultingRequest.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ success: false, message: 'Consulting request not found' });
    return;
  }
  const { assignedToId } = assignSchema.parse(req.body);
  const updated = await prisma.consultingRequest.update({
    where: { id: req.params.id },
    data: { assignedToId },
    include: { assignedTo: { select: { name: true } } },
  });
  res.json({ success: true, data: updated });
});

export default router;
