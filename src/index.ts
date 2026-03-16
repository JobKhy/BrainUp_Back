import 'express-async-errors';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRouter from './routes/auth';
import usersRouter from './routes/users';
import videosRouter from './routes/videos';
import coursesRouter from './routes/courses';
import plansRouter from './routes/plans';
import subscriptionsRouter from './routes/subscriptions';
import dashboardRouter from './routes/dashboard';
import stripeRouter, { stripeWebhookHandler } from './routes/stripe';
import consultingRouter from './routes/consulting';
import consultingRequestsRouter from './routes/consulting-requests';
import courseContentRouter from './routes/course-content';
import { errorHandler } from './middleware/errors';

const app = express();

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

// IMPORTANT: Stripe webhook must be mounted BEFORE express.json()
// so it receives the raw body
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler
);

// JSON body parser for all other routes
app.use(express.json());

// Routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/videos', videosRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/plans', plansRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/stripe', stripeRouter);
app.use('/api/consulting', consultingRouter);
app.use('/api/consulting-requests', consultingRequestsRouter);
app.use('/api/course-content', courseContentRouter);

// Global error handler (must be last)
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || '5167', 10);
app.listen(PORT, () => {
  console.log(`BrainUp backend running on http://localhost:${PORT}`);
});

export default app;
