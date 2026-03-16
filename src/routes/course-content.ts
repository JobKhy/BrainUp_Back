import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, requireAdmin, requireAdminOrStaff } from '../middleware/auth';

const router = Router({ mergeParams: true });

// ── Assistants ───────────────────────────────────────────────────────────────

router.get('/:courseId/assistants', authenticate, requireAdminOrStaff, async (req, res) => {
  const { courseId } = req.params;

  const enrollments = await prisma.courseEnrollment.findMany({
    where: { courseId },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, phone: true } },
    },
    orderBy: { enrolledAt: 'desc' },
  });

  const data = enrollments.map((e) => ({
    userId: e.user.id,
    name: e.user.name,
    email: e.user.email,
    phone: e.user.phone,
    role: e.user.role,
    enrolledAt: e.enrolledAt,
    source: e.source,
  }));

  res.json({ success: true, data });
});

// ── Topics ───────────────────────────────────────────────────────────────────

router.get('/:courseId/topics', authenticate, async (req, res) => {
  const { courseId } = req.params;

  const topics = await prisma.courseTopic.findMany({
    where: { courseId },
    orderBy: { order: 'asc' },
  });

  res.json({ success: true, data: topics });
});

const topicSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  order: z.number().int().min(0).optional(),
});

router.post('/:courseId/topics', authenticate, requireAdminOrStaff, async (req, res) => {
  const { courseId } = req.params;
  const data = topicSchema.parse(req.body);

  const topic = await prisma.courseTopic.create({
    data: {
      courseId,
      title: data.title,
      description: data.description,
      order: data.order ?? 0,
    },
  });

  res.status(201).json({ success: true, data: topic });
});

router.put('/:courseId/topics/:topicId', authenticate, requireAdminOrStaff, async (req, res) => {
  const { topicId } = req.params;
  const data = topicSchema.partial().parse(req.body);

  const topic = await prisma.courseTopic.update({
    where: { id: topicId },
    data,
  });

  res.json({ success: true, data: topic });
});

router.delete('/:courseId/topics/:topicId', authenticate, requireAdmin, async (req, res) => {
  const { topicId } = req.params;

  await prisma.courseTopic.delete({ where: { id: topicId } });

  res.json({ success: true, data: null });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

router.get('/:courseId/tests', authenticate, async (req, res) => {
  const { courseId } = req.params;
  const isAdminOrStaff = req.user.role === 'Admin' || req.user.role === 'Staff';

  const tests = await prisma.courseTest.findMany({
    where: { courseId, ...(!isAdminOrStaff ? { isActive: true } : {}) },
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { questions: true } },
    },
  });

  const data = tests.map(({ _count, ...t }) => ({
    ...t,
    questionCount: _count.questions,
  }));

  res.json({ success: true, data });
});

router.get('/:courseId/tests/:testId', authenticate, async (req, res) => {
  const { testId } = req.params;
  const isAdminOrStaff = req.user.role === 'Admin' || req.user.role === 'Staff';

  const test = await prisma.courseTest.findUnique({
    where: { id: testId },
    include: {
      questions: {
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!test) {
    res.status(404).json({ success: false, message: 'Examen no encontrado' });
    return;
  }

  const questions = test.questions.map((q) => ({
    id: q.id,
    testId: q.testId,
    question: q.question,
    options: q.options,
    order: q.order,
    ...(isAdminOrStaff ? { correctIndex: q.correctIndex } : {}),
  }));

  res.json({ success: true, data: { ...test, questions } });
});

const testSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});

router.post('/:courseId/tests', authenticate, requireAdminOrStaff, async (req, res) => {
  const { courseId } = req.params;
  const data = testSchema.parse(req.body);

  const test = await prisma.courseTest.create({
    data: {
      courseId,
      title: data.title,
      description: data.description ?? '',
    },
  });

  res.status(201).json({ success: true, data: test });
});

router.put('/:courseId/tests/:testId', authenticate, requireAdminOrStaff, async (req, res) => {
  const { testId } = req.params;
  const data = testSchema.partial().parse(req.body);

  const test = await prisma.courseTest.update({
    where: { id: testId },
    data,
  });

  res.json({ success: true, data: test });
});

router.patch('/:courseId/tests/:testId/toggle-active', authenticate, requireAdminOrStaff, async (req, res) => {
  const { testId } = req.params;

  const test = await prisma.courseTest.findUnique({ where: { id: testId } });
  if (!test) {
    res.status(404).json({ success: false, message: 'Examen no encontrado' });
    return;
  }

  const updated = await prisma.courseTest.update({
    where: { id: testId },
    data: { isActive: !test.isActive },
  });

  res.json({ success: true, data: updated });
});

router.delete('/:courseId/tests/:testId', authenticate, requireAdmin, async (req, res) => {
  const { testId } = req.params;

  await prisma.$transaction([
    prisma.courseQuestion.deleteMany({ where: { testId } }),
    prisma.courseTestAttempt.deleteMany({ where: { testId } }),
    prisma.courseTest.delete({ where: { id: testId } }),
  ]);

  res.json({ success: true, data: null });
});

// ── Questions ─────────────────────────────────────────────────────────────────

const questionBaseSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string()).min(2),
  correctIndex: z.number().int().min(0),
  order: z.number().int().min(0).optional(),
});

const questionSchema = questionBaseSchema.refine((d) => d.correctIndex < d.options.length, {
  message: 'correctIndex must be a valid option index',
});

router.post('/:courseId/tests/:testId/questions', authenticate, requireAdminOrStaff, async (req, res) => {
  const { testId } = req.params;
  const data = questionSchema.parse(req.body);

  const question = await prisma.courseQuestion.create({
    data: {
      testId,
      question: data.question,
      options: data.options,
      correctIndex: data.correctIndex,
      order: data.order ?? 0,
    },
  });

  res.status(201).json({ success: true, data: question });
});

router.put('/:courseId/tests/:testId/questions/:questionId', authenticate, requireAdminOrStaff, async (req, res) => {
  const { questionId } = req.params;
  const data = questionBaseSchema.partial().parse(req.body);

  const question = await prisma.courseQuestion.update({
    where: { id: questionId },
    data,
  });

  res.json({ success: true, data: question });
});

router.delete('/:courseId/tests/:testId/questions/:questionId', authenticate, requireAdmin, async (req, res) => {
  const { questionId } = req.params;

  await prisma.courseQuestion.delete({ where: { id: questionId } });

  res.json({ success: true, data: null });
});

// ── Test Attempts ─────────────────────────────────────────────────────────────

const attemptSchema = z.object({
  answers: z.array(z.number().int().min(0)),
});

router.post('/:courseId/tests/:testId/attempt', authenticate, async (req, res) => {
  const { testId } = req.params;
  const { answers } = attemptSchema.parse(req.body);

  const questions = await prisma.courseQuestion.findMany({
    where: { testId },
    orderBy: { order: 'asc' },
  });

  const totalQuestions = questions.length;
  let correctCount = 0;

  questions.forEach((q, i) => {
    if (answers[i] !== undefined && answers[i] === q.correctIndex) {
      correctCount++;
    }
  });

  const score = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;

  const attempt = await prisma.courseTestAttempt.upsert({
    where: { userId_testId: { userId: req.user.id, testId } },
    create: {
      userId: req.user.id,
      testId,
      score,
      totalQuestions,
      answers,
    },
    update: {
      score,
      totalQuestions,
      answers,
      completedAt: new Date(),
    },
  });

  res.json({ success: true, data: { score, totalQuestions, correctCount, attempt } });
});

router.get('/:courseId/tests/:testId/my-attempt', authenticate, async (req, res) => {
  const { testId } = req.params;

  const attempt = await prisma.courseTestAttempt.findUnique({
    where: { userId_testId: { userId: req.user.id, testId } },
  });

  res.json({ success: true, data: attempt ?? null });
});

router.get('/:courseId/tests/:testId/attempts', authenticate, requireAdminOrStaff, async (req, res) => {
  const { testId } = req.params;

  const attempts = await prisma.courseTestAttempt.findMany({
    where: { testId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { completedAt: 'desc' },
  });

  const data = attempts.map(({ user, ...a }) => ({
    ...a,
    userName: user.name,
    userEmail: user.email,
  }));

  res.json({ success: true, data });
});

// ── Course Videos ─────────────────────────────────────────────────────────────

router.get('/:courseId/videos', authenticate, async (req, res) => {
  const { courseId } = req.params;

  const courseVideos = await prisma.courseVideo.findMany({
    where: { courseId },
    orderBy: { order: 'asc' },
    include: {
      video: true,
    },
  });

  res.json({ success: true, data: courseVideos });
});

router.post('/:courseId/videos', authenticate, requireAdminOrStaff, async (req, res) => {
  const { courseId } = req.params;
  const { videoId, order } = req.body;

  if (!videoId) {
    res.status(400).json({ success: false, message: 'videoId is required' });
    return;
  }

  const existing = await prisma.courseVideo.findUnique({
    where: { courseId_videoId: { courseId, videoId } },
  });

  if (existing) {
    res.status(409).json({ success: false, message: 'Video already linked to this course' });
    return;
  }

  const courseVideo = await prisma.courseVideo.create({
    data: { courseId, videoId, order: order ?? 0 },
    include: { video: true },
  });

  res.status(201).json({ success: true, data: courseVideo });
});

router.delete('/:courseId/videos/:videoId', authenticate, requireAdmin, async (req, res) => {
  const { courseId, videoId } = req.params;

  await prisma.courseVideo.delete({
    where: { courseId_videoId: { courseId, videoId } },
  });

  res.json({ success: true, data: null });
});

export default router;
