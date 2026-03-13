import { Worker, Job } from 'bullmq';
import { redisConnection } from '../db/redis';
import { supabase } from '../db/client';
import { logger } from '../utils/logger';
import type { SmsJobData, InventorySyncJobData, FulfillmentJobData, JobType } from '../types';

// ─── Job Log Helper ───────────────────────────────────────────────────────────

async function writeJobLog(
  jobId: string,
  jobType: JobType,
  orderId: string,
  status: 'completed' | 'failed',
  attempts: number,
  error?: string
): Promise<void> {
  const { error: dbError } = await supabase.from('job_logs').upsert(
    {
      job_id: jobId,
      job_type: jobType,
      order_id: orderId,
      status,
      attempts,
      error: error ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'job_id' }
  );

  if (dbError) {
    logger.error('[Workers] Failed to write job log', { jobId, error: dbError.message });
  }
}

// ─── SMS Worker ───────────────────────────────────────────────────────────────

function buildSmsMessage(
  customerName: string,
  messageType: SmsJobData['messageType'],
  trackingUrl?: string
): string {
  switch (messageType) {
    case 'order_confirmed':
      return `Hi ${customerName}, your order has been confirmed! We'll notify you when it ships.`;
    case 'shipping_update':
      return `Hi ${customerName}, your order has shipped! Track it here: ${trackingUrl ?? 'link unavailable'}`;
    case 'payment_failed':
      return `Hi ${customerName}, there was an issue with your payment. Please contact support.`;
  }
}

export const smsWorker = new Worker<SmsJobData>(
  'sms',
  async (job: Job<SmsJobData>) => {
    const { to, customerName, orderId, messageType, trackingUrl } = job.data;

    logger.info('[smsWorker] Processing SMS job', {
      jobId: job.id,
      orderId,
      to,
      messageType,
    });

    // Stub: Twilio call will be wired in Phase 4 via src/services/sms.ts
    logger.info('[smsWorker] [STUB] Twilio sendMessage', {
      to,
      body: buildSmsMessage(customerName, messageType, trackingUrl),
    });

    await writeJobLog(job.id!, 'send_sms', orderId, 'completed', job.attemptsMade + 1);
    logger.info('[smsWorker] SMS job completed', { jobId: job.id, orderId });
  },
  redisConnection
);

smsWorker.on('failed', async (job, err) => {
  if (job) {
    logger.error('[smsWorker] Job failed', {
      jobId: job.id,
      orderId: job.data.orderId,
      error: err.message,
      attempts: job.attemptsMade,
    });
    await writeJobLog(job.id!, 'send_sms', job.data.orderId, 'failed', job.attemptsMade, err.message);
  }
});

// ─── Inventory Worker ─────────────────────────────────────────────────────────

export const inventoryWorker = new Worker<InventorySyncJobData>(
  'inventory',
  async (job: Job<InventorySyncJobData>) => {
    const { orderId, lineItems, action } = job.data;

    logger.info('[inventoryWorker] Processing inventory job', {
      jobId: job.id,
      orderId,
      action,
      itemCount: lineItems.length,
    });

    for (const item of lineItems) {
      const { data: inv, error: fetchErr } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('sku', item.sku)
        .single();

      if (fetchErr) {
        throw new Error(`Inventory fetch failed for SKU ${item.sku}: ${fetchErr.message}`);
      }

      const currentQty = inv.quantity as number;
      const newQty =
        action === 'decrement'
          ? Math.max(0, currentQty - item.quantity)
          : currentQty + item.quantity;

      const { error: updateErr } = await supabase
        .from('inventory')
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq('sku', item.sku);

      if (updateErr) {
        throw new Error(`Inventory update failed for SKU ${item.sku}: ${updateErr.message}`);
      }

      logger.info('[inventoryWorker] Inventory adjusted', {
        sku: item.sku,
        action,
        previous: currentQty,
        updated: newQty,
      });
    }

    await writeJobLog(job.id!, 'sync_inventory', orderId, 'completed', job.attemptsMade + 1);
    logger.info('[inventoryWorker] Inventory sync completed', { jobId: job.id, orderId });
  },
  redisConnection
);

inventoryWorker.on('failed', async (job, err) => {
  if (job) {
    logger.error('[inventoryWorker] Job failed', {
      jobId: job.id,
      orderId: job.data.orderId,
      error: err.message,
      attempts: job.attemptsMade,
    });
    await writeJobLog(
      job.id!,
      'sync_inventory',
      job.data.orderId,
      'failed',
      job.attemptsMade,
      err.message
    );
  }
});

// ─── Fulfillment Worker ───────────────────────────────────────────────────────

export const fulfillmentWorker = new Worker<FulfillmentJobData>(
  'fulfillment',
  async (job: Job<FulfillmentJobData>) => {
    const { orderId, shopifyOrderId, lineItems } = job.data;

    logger.info('[fulfillmentWorker] Processing fulfillment job', {
      jobId: job.id,
      orderId,
      shopifyOrderId,
      itemCount: lineItems.length,
    });

    const { error } = await supabase
      .from('orders')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', orderId);

    if (error) {
      throw new Error(`Failed to update order status to processing: ${error.message}`);
    }

    // Note: Shopify fulfillment API call will be triggered in Phase 5 (src/services/shopify.ts)
    logger.info('[fulfillmentWorker] Fulfillment intent logged', {
      orderId,
      shopifyOrderId,
      status: 'processing',
      note: 'Shopify fulfillment API will be triggered in Phase 5',
    });

    await writeJobLog(job.id!, 'process_fulfillment', orderId, 'completed', job.attemptsMade + 1);
    logger.info('[fulfillmentWorker] Fulfillment job completed', { jobId: job.id, orderId });
  },
  redisConnection
);

fulfillmentWorker.on('failed', async (job, err) => {
  if (job) {
    logger.error('[fulfillmentWorker] Job failed', {
      jobId: job.id,
      orderId: job.data.orderId,
      error: err.message,
      attempts: job.attemptsMade,
    });
    await writeJobLog(
      job.id!,
      'process_fulfillment',
      job.data.orderId,
      'failed',
      job.attemptsMade,
      err.message
    );
  }
});

// ─── Start All Workers ────────────────────────────────────────────────────────

export function startWorkers(): void {
  // Workers begin polling Redis as soon as they are instantiated above.
  // This function makes startup explicit and logs confirmation.
  logger.info('[Workers] BullMQ workers started', {
    workers: ['smsWorker', 'inventoryWorker', 'fulfillmentWorker'],
  });
}
