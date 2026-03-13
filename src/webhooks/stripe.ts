import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { supabase } from '../db/client';
import { dispatchOrderJobs, smsQueue } from '../queues';
import { logger } from '../utils/logger';
import type { Order, LineItem } from '../types';

export const stripeWebhookRouter = Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

// Raw body is required for Stripe signature verification
// Make sure this route is registered BEFORE express.json() middleware
stripeWebhookRouter.post(
  '/webhooks/stripe',
  async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      logger.error('Stripe webhook signature verification failed', { error: err.message });
      res.status(400).json({ error: `Webhook Error: ${err.message}` });
      return;
    }

    logger.info('Stripe webhook received', { type: event.type, id: event.id });

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await handlePaymentSuccess(event.data.object as Stripe.PaymentIntent);
          break;

        case 'payment_intent.payment_failed':
          await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
          break;

        case 'charge.refunded':
          await handleRefund(event.data.object as Stripe.Charge);
          break;

        default:
          logger.debug('Unhandled Stripe event type', { type: event.type });
      }

      res.json({ received: true });
    } catch (err: any) {
      logger.error('Error processing Stripe webhook', { error: err.message, eventType: event.type });
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const { metadata } = paymentIntent;
  const shopifyOrderId = metadata?.shopify_order_id;

  if (!shopifyOrderId) {
    logger.warn('Payment intent missing shopify_order_id metadata', { id: paymentIntent.id });
    return;
  }

  // Upsert order in Supabase
  const { data: order, error } = await supabase
    .from('orders')
    .upsert({
      shopify_order_id: shopifyOrderId,
      stripe_payment_intent_id: paymentIntent.id,
      customer_name: metadata.customer_name || '',
      customer_email: metadata.customer_email || '',
      customer_phone: metadata.customer_phone || '',
      total_amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency.toUpperCase(),
      status: 'payment_confirmed',
      line_items: JSON.parse(metadata.line_items || '[]'),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to upsert order', { error: error.message, shopifyOrderId });
    throw error;
  }

  logger.info('Order saved to database', { orderId: order.id, shopifyOrderId });

  // Dispatch all three parallel jobs
  const lineItems: LineItem[] = JSON.parse(metadata.line_items || '[]');

  await dispatchOrderJobs(
    order.id,
    {
      to: metadata.customer_phone,
      customerName: metadata.customer_name,
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
    }
  );
}

async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const { metadata } = paymentIntent;

  await supabase
    .from('orders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  if (metadata?.customer_phone) {
    await smsQueue.add('send_sms', {
      to: metadata.customer_phone,
      customerName: metadata.customer_name || 'Customer',
      orderId: paymentIntent.id,
      messageType: 'payment_failed',
    });
  }

  logger.info('Payment failed handled', { paymentIntentId: paymentIntent.id });
}

async function handleRefund(charge: Stripe.Charge): Promise<void> {
  await supabase
    .from('orders')
    .update({ status: 'refunded', updated_at: new Date().toISOString() })
    .eq('stripe_payment_intent_id', charge.payment_intent as string);

  logger.info('Refund processed', { chargeId: charge.id });
}
