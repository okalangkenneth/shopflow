import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';

import { stripeWebhookRouter } from './webhooks/stripe';
import { shopifyWebhookRouter } from './webhooks/shopify';
import { apiRouter } from './routes/api';
import { shopifyAuthRouter } from './routes/shopify';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { webhookRateLimiter, apiRateLimiter } from './middleware/rateLimiter';
import { testDbConnection } from './db/client';
import { startWorkers } from './services/workers';
import { logger } from './utils/logger';

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security & Logging ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ─── Webhook Routes (raw body MUST come before express.json) ─────────────────
app.use(
  webhookRateLimiter,
  express.raw({ type: 'application/json' }),
  stripeWebhookRouter,
  shopifyWebhookRouter
);

// ─── JSON Parsing for all other routes ───────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── API & Auth Routes ────────────────────────────────────────────────────────
app.use('/api', apiRateLimiter, apiRouter);
app.use(shopifyAuthRouter);

// ─── 404 & Error Handling ─────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Startup ──────────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  try {
    await testDbConnection();
    startWorkers();
    app.listen(PORT, () => {
      logger.info(`ShopFlow API running`, {
        port: PORT,
        env: process.env.NODE_ENV || 'development',
      });
    });
  } catch (err: any) {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  }
}

bootstrap();
