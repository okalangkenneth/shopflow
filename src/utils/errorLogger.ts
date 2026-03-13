import { logger } from './logger';

/**
 * Structured error logger for external API failures.
 * Use this instead of raw logger.error calls in service files so every
 * outbound-API failure has a consistent shape for log aggregation / alerting.
 *
 * @param service   - The external service (e.g. 'stripe', 'twilio', 'shopify')
 * @param operation - The specific operation that failed (e.g. 'getOrder', 'sendSms')
 * @param error     - The caught error
 * @param context   - Optional key/value pairs to attach (e.g. orderId, shop)
 */
export function logApiError(
  service: string,
  operation: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error(`[${service}] ${operation} failed`, {
    service,
    operation,
    error: message,
    ...(stack ? { stack } : {}),
    ...context,
  });
}
