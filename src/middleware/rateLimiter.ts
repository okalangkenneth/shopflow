import rateLimit from 'express-rate-limit';

const jsonTooManyRequests = {
  handler: (_req: any, res: any) => {
    res.status(429).json({
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: 15 * 60,
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
};

/**
 * Strict limiter for webhook endpoints — 100 requests per 15 minutes.
 * Prevents replay attacks and webhook flooding.
 */
export const webhookRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  ...jsonTooManyRequests,
});

/**
 * Standard limiter for REST API endpoints — 200 requests per 15 minutes.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  ...jsonTooManyRequests,
});
