import twilio from 'twilio';
import { logger } from '../utils/logger';
import { logApiError } from '../utils/errorLogger';

// ─── Twilio Client Init ───────────────────────────────────────────────────────

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const fromNumber = process.env.TWILIO_PHONE_NUMBER!;

if (!accountSid || !authToken || !fromNumber) {
  throw new Error('Missing Twilio environment variables (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)');
}

const client = twilio(accountSid, authToken);

// ─── Send SMS ─────────────────────────────────────────────────────────────────

/**
 * Sends an SMS via Twilio. Returns the message SID on success, null on failure.
 * Never throws — errors are logged so the worker stays alive.
 */
export async function sendSms(to: string, body: string): Promise<string | null> {
  try {
    const message = await client.messages.create({ from: fromNumber, to, body });
    logger.info('[sms] Message sent', { to, sid: message.sid, status: message.status });
    return message.sid;
  } catch (err: unknown) {
    logApiError('twilio', 'sendSms', err, { to });
    return null;
  }
}

// ─── Message Builders ─────────────────────────────────────────────────────────

export function buildOrderConfirmedMessage(customerName: string, orderId: string): string {
  return `Hi ${customerName}, your order #${orderId} has been confirmed! We'll notify you when it ships.`;
}

export function buildShippingUpdateMessage(customerName: string, trackingUrl: string): string {
  return `Hi ${customerName}, your order has shipped! Track it here: ${trackingUrl}`;
}

export function buildPaymentFailedMessage(customerName: string): string {
  return `Hi ${customerName}, there was an issue processing your payment. Please contact support or retry.`;
}
