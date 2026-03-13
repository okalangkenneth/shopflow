import { Redis } from 'ioredis';
import { logger } from '../utils/logger';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));

// Pass plain connection options (not a Redis instance) so BullMQ uses its own
// bundled ioredis, avoiding structural type conflicts between the two versions.
const parsed = new URL(redisUrl);
export const redisConnection = {
  connection: {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    maxRetriesPerRequest: null as null,
    enableReadyCheck: false,
  },
};
