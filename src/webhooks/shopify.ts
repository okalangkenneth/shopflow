import { createHmac, timingSafeEqual } from 'crypto';
import { Router, Request, Response } from 'express';
import { supabase } from '../db/client';
import { dispatchOrderJobs } from '../queues';
import { logger } from '../utils/logger';
import type { LineItem } from '../types';

export const shopifyWebhookRouter = Router();

// ─── HMAC Verification ────────────────────────────────────────────────────────

function verifyShopifyHmac(rawBody: Buffer, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_API_SECRET!;
  const digest = createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    const a = Buffer.from(digest);
    const b = Buffer.from(hmacHeader);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Webhook Route ────────────────────────────────────────────────────────────

shopifyWebhookRouter.post(
  '/webhooks/shopify',
  async (req: Request, res: Response): Promise<void> => {
    const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string | undefined;
    const topic = req.headers['x-shopify-topic'] as string | undefined;
    const shop = req.headers['x-shopify-shop-domain'] as string | undefined;

    if (!hmacHeader || !shop || !topic) {
      res.status(400).json({ error: 'Missing required Shopify headers' });
      return;
    }

    if (!verifyShopifyHmac(req.body as Buffer, hmacHeader)) {
      logger.warn('[shopifyWebhook] HMAC verification failed', { shop, topic });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse((req.body as Buffer).toString('utf8')) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    logger.info('[shopifyWebhook] Received', { topic, shop });

    // Respond 200 immediately — Shopify requires acknowledgement within 5 seconds
    res.json({ received: true });

    // Process asynchronously after responding
    setImmediate(async () => {
      try {
        switch (topic) {
          case 'orders/paid':
            await handleOrderPaid(payload, shop);
            break;
          case 'orders/cancelled':
            await handleOrderCancelled(payload);
            break;
          default:
            logger.debug('[shopifyWebhook] Unhandled topic', { topic });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[shopifyWebhook] Error handling event', { topic, shop, error: message });
      }
    });
  }
);

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleOrderPaid(
  payload: Record<string, unknown>,
  shop: string
): Promise<void> {
  const shopifyOrderId = String(payload.id);
  const customer = (payload.customer as Record<string, unknown>) ?? {};
  const billingAddress = (payload.billing_address as Record<string, unknown>) ?? {};
  const rawLineItems = (payload.line_items as unknown[]) ?? [];

  const lineItems: LineItem[] = rawLineItems.map((item) => {
    const li = item as Record<string, unknown>;
    return {
      product_id: String(li.product_id ?? ''),
      variant_id: String(li.variant_id ?? ''),
      title: String(li.title ?? ''),
      quantity: Number(li.quantity ?? 0),
      price: Number(li.price ?? 0),
      sku: String(li.sku ?? ''),
    };
  });

  const customerName =
    `${String(customer.first_name ?? '')} ${String(customer.last_name ?? '')}`.trim();
  const customerEmail = String(customer.email ?? '');
  const customerPhone = String(
    (customer.phone as string | undefined) ??
      (billingAddress.phone as string | undefined) ??
      ''
  );

  const { data: order, error } = await supabase
    .from('orders')
    .upsert(
      {
        shopify_order_id: shopifyOrderId,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        total_amount: Number(payload.total_price ?? 0),
        currency: String(payload.currency ?? 'USD'),
        status: 'payment_confirmed',
        line_items: lineItems,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shopify_order_id' }
    )
    .select()
    .single();

  if (error) {
    logger.error('[shopifyWebhook] Failed to upsert order', {
      error: error.message,
      shopifyOrderId,
    });
    return;
  }

  logger.info('[shopifyWebhook] Order saved', { orderId: order.id, shopifyOrderId });

  await dispatchOrderJobs(
    order.id,
    {
      to: customerPhone,
      customerName,
      orderId: order.id,
      messageType: 'order_confirmed',
    },
    {
      orderId: order.id,
      lineItems,
      action: 'decrement',
    },
    {
      orderId: order.id,
      shopifyOrderId,
      lineItems,
      shop,
    }
  );
}

async function handleOrderCancelled(payload: Record<string, unknown>): Promise<void> {
  const shopifyOrderId = String(payload.id);

  const { error } = await supabase
    .from('orders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('shopify_order_id', shopifyOrderId);

  if (error) {
    logger.error('[shopifyWebhook] Failed to cancel order', {
      error: error.message,
      shopifyOrderId,
    });
    return;
  }

  logger.info('[shopifyWebhook] Order cancelled', { shopifyOrderId });
}
