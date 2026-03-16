import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { stripe } from '../lib/stripe';
import { authenticate } from '../middleware/auth';
import Stripe from 'stripe';

const router = Router();

// POST /stripe/create-checkout
router.post('/create-checkout', authenticate, async (req: Request, res: Response) => {
  const { planId } = req.body;
  if (!planId) {
    res.status(400).json({ success: false, message: 'planId is required' });
    return;
  }

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    res.status(404).json({ success: false, message: 'Plan not found' });
    return;
  }

  if (!plan.stripePriceId) {
    res.status(400).json({ success: false, message: 'Plan has no Stripe price configured' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  let stripeCustomerId = user.stripeCustomerId;

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user.id },
    });
    stripeCustomerId = customer.id;
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: [
      {
        price: plan.stripePriceId,
        quantity: 1,
      },
    ],
    success_url: process.env.STRIPE_SUCCESS_URL as string,
    cancel_url: process.env.STRIPE_CANCEL_URL as string,
    metadata: {
      userId: user.id,
      planId: plan.id,
    },
  });

  res.json({ success: true, data: { checkoutUrl: session.url } });
});

// POST /stripe/create-course-checkout
router.post('/create-course-checkout', authenticate, async (req: Request, res: Response) => {
  const { courseId } = req.body;
  if (!courseId) {
    res.status(400).json({ success: false, message: 'courseId is required' });
    return;
  }

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course || !course.isActive || course.deletedAt) {
    res.status(404).json({ success: false, message: 'Course not found' });
    return;
  }

  if (!course.stripePriceId) {
    res.status(400).json({ success: false, message: 'Course has no Stripe price configured' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  let stripeCustomerId = user.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user.id },
    });
    stripeCustomerId = customer.id;
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId } });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: stripeCustomerId,
    line_items: [{ price: course.stripePriceId, quantity: 1 }],
    success_url: process.env.STRIPE_SUCCESS_URL as string,
    cancel_url: process.env.STRIPE_CANCEL_URL as string,
    metadata: { userId: user.id, courseId: course.id, type: 'course' },
  });

  res.json({ success: true, data: { checkoutUrl: session.url } });
});

// GET /stripe/verify-course-session?session_id=...
router.get('/verify-course-session', async (req: Request, res: Response) => {
  const sessionId = req.query.session_id as string;
  if (!sessionId) {
    res.status(400).json({ success: false, message: 'session_id is required' });
    return;
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.payment_status !== 'paid') {
    res.status(402).json({ success: false, message: 'Payment not completed' });
    return;
  }

  const userId = session.metadata?.userId;
  const courseId = session.metadata?.courseId;
  const type = session.metadata?.type;

  if (!userId || !courseId || type !== 'course') {
    res.status(400).json({ success: false, message: 'Session metadata missing or invalid type' });
    return;
  }

  await prisma.courseEnrollment.upsert({
    where: { userId_courseId: { userId, courseId } },
    update: { source: 'Purchase', stripeSessionId: sessionId },
    create: { userId, courseId, source: 'Purchase', stripeSessionId: sessionId },
  });

  res.json({ success: true, data: { enrolled: true, courseId } });
});

// GET /stripe/verify-session?session_id=... — called by success page to ensure subscription exists
// No auth required: the session ID is an unforgeable Stripe token; user identity comes from its metadata
router.get('/verify-session', async (req: Request, res: Response) => {
  const sessionId = req.query.session_id as string;
  if (!sessionId) {
    res.status(400).json({ success: false, message: 'session_id is required' });
    return;
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.payment_status !== 'paid') {
    res.status(402).json({ success: false, message: 'Payment not completed' });
    return;
  }

  const userId = session.metadata?.userId;
  const planId = session.metadata?.planId;

  if (!userId || !planId) {
    res.status(400).json({ success: false, message: 'Session metadata missing' });
    return;
  }

  const existing = await prisma.subscription.findUnique({ where: { userId } });
  if (existing?.stripeSessionId === sessionId) {
    // Already processed (by webhook or a previous call)
    res.json({ success: true, data: existing });
    return;
  }

  const stripeSubscriptionId = session.subscription as string;
  const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const expiresAt = new Date((stripeSub as Stripe.Subscription).current_period_end * 1000);

  const subscription = await prisma.subscription.upsert({
    where: { userId },
    update: {
      planId,
      status: 'Active',
      expiresAt,
      stripeSubscriptionId,
      stripeSessionId: sessionId,
    },
    create: {
      userId,
      planId,
      status: 'Active',
      startedAt: new Date(),
      expiresAt,
      stripeSubscriptionId,
      stripeSessionId: sessionId,
    },
  });

  res.json({ success: true, data: subscription });
});

// POST /stripe/change-plan — upgrade charges proration immediately; downgrade applies at period end
router.post('/change-plan', authenticate, async (req: Request, res: Response) => {
  const { planId } = req.body;
  if (!planId) {
    res.status(400).json({ success: false, message: 'planId is required' });
    return;
  }

  const [currentSub, newPlan] = await Promise.all([
    prisma.subscription.findUnique({
      where: { userId: req.user.id },
      include: { plan: true },
    }),
    prisma.plan.findUnique({ where: { id: planId } }),
  ]);

  if (!newPlan || !newPlan.stripePriceId) {
    res.status(404).json({ success: false, message: 'Plan not found or has no Stripe price' });
    return;
  }

  if (!currentSub || !currentSub.stripeSubscriptionId || currentSub.status !== 'Active') {
    res.status(400).json({ success: false, message: 'No active Stripe subscription found' });
    return;
  }

  const stripeSub = await stripe.subscriptions.retrieve(currentSub.stripeSubscriptionId);
  const itemId = stripeSub.items.data[0]?.id;
  if (!itemId) {
    res.status(500).json({ success: false, message: 'Could not retrieve subscription item' });
    return;
  }

  const isUpgrade = newPlan.price > currentSub.plan.price;

  if (isUpgrade) {
    // Charge the prorated difference immediately
    await stripe.subscriptions.update(currentSub.stripeSubscriptionId, {
      items: [{ id: itemId, price: newPlan.stripePriceId }],
      proration_behavior: 'always_invoice',
    });
    // Update DB plan immediately
    await prisma.subscription.update({
      where: { id: currentSub.id },
      data: { planId },
    });
    res.json({
      success: true,
      data: { type: 'upgrade', message: 'Plan actualizado. Se cobrará la diferencia de forma prorrateada.' },
    });
  } else {
    // Downgrade: apply at the end of current billing period, no charge
    await stripe.subscriptions.update(currentSub.stripeSubscriptionId, {
      items: [{ id: itemId, price: newPlan.stripePriceId }],
      proration_behavior: 'none',
    });
    // DB planId will be updated automatically by the invoice.paid webhook at next renewal
    res.json({
      success: true,
      data: { type: 'downgrade', message: 'El cambio se aplicará al finalizar tu período actual de facturación.' },
    });
  }
});

// GET /stripe/consulting-packages — returns available consulting packages with Stripe price IDs
router.get('/consulting-packages', authenticate, async (_req, res) => {
  res.json({
    success: true,
    data: [
      {
        hours: 1,
        label: '1 hora de asesoría',
        priceId: process.env.CONSULTING_HOURLY_PRICE_ID ?? null,
        amount: parseInt(process.env.CONSULTING_HOURLY_AMOUNT ?? '0'),
      },
      {
        hours: 8,
        label: 'Pack 8 horas',
        priceId: process.env.CONSULTING_PACK8_PRICE_ID ?? null,
        amount: parseInt(process.env.CONSULTING_PACK8_AMOUNT ?? '0'),
      },
    ],
  });
});

// POST /stripe/create-consulting-checkout
router.post('/create-consulting-checkout', authenticate, async (req: Request, res: Response) => {
  const { hours, subject, topic, preferredDate, notes } = req.body;

  if (!hours || !subject || !topic || !preferredDate) {
    res.status(400).json({ success: false, message: 'hours, subject, topic, preferredDate are required' });
    return;
  }

  const priceId = hours === 8
    ? process.env.CONSULTING_PACK8_PRICE_ID
    : process.env.CONSULTING_HOURLY_PRICE_ID;

  if (!priceId) {
    res.status(400).json({ success: false, message: 'Consulting package not configured' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  let stripeCustomerId = user.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user.id },
    });
    stripeCustomerId = customer.id;
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId } });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: process.env.STRIPE_SUCCESS_URL as string,
    cancel_url: process.env.STRIPE_CANCEL_URL as string,
    metadata: {
      type: 'consulting',
      userId: user.id,
      hours: String(hours),
      subject,
      topic: topic.slice(0, 400),
      preferredDate,
      notes: (notes ?? '').slice(0, 400),
    },
  });

  res.json({ success: true, data: { checkoutUrl: session.url } });
});

// GET /stripe/verify-consulting-session?session_id=...
router.get('/verify-consulting-session', async (req: Request, res: Response) => {
  const sessionId = req.query.session_id as string;
  if (!sessionId) {
    res.status(400).json({ success: false, message: 'session_id is required' });
    return;
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.payment_status !== 'paid' || session.metadata?.type !== 'consulting') {
    res.status(400).json({ success: false, message: 'Not a paid consulting session' });
    return;
  }

  let request = await prisma.consultingRequest.findFirst({
    where: { stripeSessionId: sessionId },
  });

  // Webhook may not have fired yet — create the request here as fallback
  if (!request) {
    const userId = session.metadata?.userId;
    if (!userId) {
      res.status(400).json({ success: false, message: 'Missing userId in session metadata' });
      return;
    }

    const hours = parseInt(session.metadata?.hours ?? '1');
    const subject = session.metadata?.subject ?? '';
    const topic = session.metadata?.topic ?? '';
    const preferredDate = session.metadata?.preferredDate ? new Date(session.metadata.preferredDate) : new Date();
    const notes = session.metadata?.notes || null;

    request = await prisma.consultingRequest.create({
      data: { userId, subject, topic, preferredDate, hours, notes, stripeSessionId: sessionId, status: 'Pending' },
    });

    const packageType = hours === 8 ? 'Pack8' : ('Hourly' as const);
    const consulting = await prisma.consulting.upsert({
      where: { userId },
      update: { totalHours: { increment: hours } },
      create: { userId, totalHours: hours },
    });

    await prisma.consultingPurchase.create({
      data: { consultingId: consulting.id, packageType, hours, stripeSessionId: sessionId },
    });
  }

  res.json({ success: true, data: { processed: true } });
});

// POST /stripe/webhook — uses raw body (mounted specially in index.ts)
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook error';
    res.status(400).json({ success: false, message: `Webhook Error: ${message}` });
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const type = session.metadata?.type;

      if (!userId) break;

      if (type === 'course') {
        const courseId = session.metadata?.courseId;
        if (!courseId) break;
        await prisma.courseEnrollment.upsert({
          where: { userId_courseId: { userId, courseId } },
          update: { source: 'Purchase', stripeSessionId: session.id },
          create: { userId, courseId, source: 'Purchase', stripeSessionId: session.id },
        });
        break;
      }

      if (type === 'consulting') {
        // Skip if already created by verify-consulting-session fallback
        const existing = await prisma.consultingRequest.findFirst({ where: { stripeSessionId: session.id } });
        if (existing) break;

        const hours = parseInt(session.metadata?.hours ?? '1');
        const subject = session.metadata?.subject ?? '';
        const topic = session.metadata?.topic ?? '';
        const preferredDate = session.metadata?.preferredDate ? new Date(session.metadata.preferredDate) : new Date();
        const notes = session.metadata?.notes || null;

        await prisma.consultingRequest.create({
          data: {
            userId,
            subject,
            topic,
            preferredDate,
            hours,
            notes,
            stripeSessionId: session.id,
            status: 'Pending',
          },
        });

        const packageType = hours === 8 ? 'Pack8' : ('Hourly' as const);
        const consulting = await prisma.consulting.upsert({
          where: { userId },
          update: { totalHours: { increment: hours } },
          create: { userId, totalHours: hours },
        });

        await prisma.consultingPurchase.create({
          data: {
            consultingId: consulting.id,
            packageType,
            hours,
            stripeSessionId: session.id,
          },
        });

        break;
      }

      // Subscription flow
      const planId = session.metadata?.planId;
      if (!planId) break;

      const stripeSubscriptionId = session.subscription as string;
      const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
      const expiresAt = new Date((stripeSub as Stripe.Subscription).current_period_end * 1000);

      await prisma.subscription.upsert({
        where: { userId },
        update: {
          planId,
          status: 'Active',
          expiresAt,
          stripeSubscriptionId,
          stripeSessionId: session.id,
        },
        create: {
          userId,
          planId,
          status: 'Active',
          startedAt: new Date(),
          expiresAt,
          stripeSubscriptionId,
          stripeSessionId: session.id,
        },
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const stripeSub = event.data.object as Stripe.Subscription;
      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: stripeSub.id },
        data: { status: 'Cancelled' },
      });
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = (invoice as Stripe.Invoice & { subscription?: string }).subscription;
      if (!subId) break;

      const stripeSub = await stripe.subscriptions.retrieve(subId);
      const expiresAt = new Date((stripeSub as Stripe.Subscription).current_period_end * 1000);
      const currentPriceId = stripeSub.items.data[0]?.price.id;

      // Find plan matching the current Stripe price (handles downgrades applied at renewal)
      const matchedPlan = currentPriceId
        ? await prisma.plan.findFirst({ where: { stripePriceId: currentPriceId } })
        : null;

      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subId },
        data: {
          expiresAt,
          status: 'Active',
          ...(matchedPlan ? { planId: matchedPlan.id } : {}),
        },
      });
      break;
    }

    default:
      // Ignore other events
      break;
  }

  res.json({ received: true });
}

export default router;
