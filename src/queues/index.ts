import { Queue, Worker, QueueEvents } from 'bullmq';
import { redisConnection } from '../db/redis';
import { logger } from '../utils/logger';
import type { SmsJobData, InventorySyncJobData, FulfillmentJobData, JobType } from '../types';

// ─── Queue Definitions ────────────────────────────────────────────────────────

export const smsQueue = new Queue<SmsJobData>('sms', {
  ...redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const inventoryQueue = new Queue<InventorySyncJobData>('inventory', {
  ...redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const fulfillmentQueue = new Queue<FulfillmentJobData>('fulfillment', {
  ...redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

// ─── Queue Event Logging ──────────────────────────────────────────────────────

function attachQueueEvents(queueName: string): void {
  const events = new QueueEvents(queueName, redisConnection);

  events.on('completed', ({ jobId }) =>
    logger.info(`Job completed`, { queue: queueName, jobId })
  );

  events.on('failed', ({ jobId, failedReason }) =>
    logger.error(`Job failed`, { queue: queueName, jobId, reason: failedReason })
  );

  events.on('stalled', ({ jobId }) =>
    logger.warn(`Job stalled`, { queue: queueName, jobId })
  );
}

attachQueueEvents('sms');
attachQueueEvents('inventory');
attachQueueEvents('fulfillment');

// ─── Job Dispatcher ───────────────────────────────────────────────────────────

export async function dispatchOrderJobs(
  orderId: string,
  smsData: SmsJobData,
  inventoryData: InventorySyncJobData,
  fulfillmentData: FulfillmentJobData
): Promise<void> {
  await Promise.all([
    smsQueue.add('send_sms', smsData, { jobId: `sms-${orderId}` }),
    inventoryQueue.add('sync_inventory', inventoryData, { jobId: `inv-${orderId}` }),
    fulfillmentQueue.add('process_fulfillment', fulfillmentData, { jobId: `ful-${orderId}` }),
  ]);

  logger.info('Order jobs dispatched', { orderId, jobs: ['sms', 'inventory', 'fulfillment'] });
}

// ─── Queue Health ─────────────────────────────────────────────────────────────

export async function getQueueHealth() {
  const [smsCounts, inventoryCounts, fulfillmentCounts] = await Promise.all([
    smsQueue.getJobCounts(),
    inventoryQueue.getJobCounts(),
    fulfillmentQueue.getJobCounts(),
  ]);

  return {
    sms: smsCounts,
    inventory: inventoryCounts,
    fulfillment: fulfillmentCounts,
  };
}
