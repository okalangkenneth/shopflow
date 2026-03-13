import { logger } from '../utils/logger';

const API_VERSION = '2024-01';

function apiUrl(shop: string, path: string): string {
  return `https://${shop}/admin/api/${API_VERSION}/${path}`;
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken,
  };
}

// ─── Get Order ────────────────────────────────────────────────────────────────

/**
 * Fetches a single order from the Shopify REST Admin API.
 * Returns the order object or null on failure.
 */
export async function getOrder(
  shop: string,
  accessToken: string,
  shopifyOrderId: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(apiUrl(shop, `orders/${shopifyOrderId}.json`), {
      headers: authHeaders(accessToken),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { order: Record<string, unknown> };
    logger.info('[shopify] getOrder success', { shop, shopifyOrderId });
    return data.order;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[shopify] getOrder failed', { shop, shopifyOrderId, error: message });
    return null;
  }
}

// ─── Update Inventory ─────────────────────────────────────────────────────────

/**
 * Sets the available inventory level for an item at a given location.
 * Returns the updated inventory_level object or null on failure.
 */
export async function updateInventory(
  shop: string,
  accessToken: string,
  inventoryItemId: string,
  locationId: string,
  available: number
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(apiUrl(shop, 'inventory_levels/set.json'), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        location_id: locationId,
        inventory_item_id: inventoryItemId,
        available,
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { inventory_level: Record<string, unknown> };
    logger.info('[shopify] updateInventory success', {
      shop,
      inventoryItemId,
      locationId,
      available,
    });
    return data.inventory_level;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[shopify] updateInventory failed', {
      shop,
      inventoryItemId,
      locationId,
      error: message,
    });
    return null;
  }
}

// ─── Trigger Fulfillment ──────────────────────────────────────────────────────

/**
 * Creates a fulfillment for all open fulfillment orders on a Shopify order.
 * Uses the modern fulfillment orders API (2022-07+).
 * Returns the fulfillment ID on success, null on failure.
 */
export async function triggerFulfillment(
  shop: string,
  accessToken: string,
  shopifyOrderId: string
): Promise<string | null> {
  try {
    // Step 1: Fetch fulfillment orders for this order
    const foRes = await fetch(
      apiUrl(shop, `orders/${shopifyOrderId}/fulfillment_orders.json`),
      { headers: authHeaders(accessToken) }
    );
    if (!foRes.ok) {
      throw new Error(`fulfillment_orders HTTP ${foRes.status}: ${await foRes.text()}`);
    }
    const foData = (await foRes.json()) as {
      fulfillment_orders: Array<{ id: string | number; status: string }>;
    };

    const openOrders = foData.fulfillment_orders.filter((fo) => fo.status === 'open');
    if (openOrders.length === 0) {
      logger.warn('[shopify] No open fulfillment orders found', { shop, shopifyOrderId });
      return null;
    }

    // Step 2: Create a fulfillment for all open fulfillment orders
    const fulfillRes = await fetch(apiUrl(shop, 'fulfillments.json'), {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        fulfillment: {
          message: 'Order fulfilled by ShopFlow',
          notify_customer: true,
          line_items_by_fulfillment_order: openOrders.map((fo) => ({
            fulfillment_order_id: fo.id,
          })),
        },
      }),
    });
    if (!fulfillRes.ok) {
      throw new Error(`fulfillments HTTP ${fulfillRes.status}: ${await fulfillRes.text()}`);
    }
    const fulfillData = (await fulfillRes.json()) as { fulfillment: { id: string | number } };
    const fulfillmentId = String(fulfillData.fulfillment.id);

    logger.info('[shopify] triggerFulfillment success', {
      shop,
      shopifyOrderId,
      fulfillmentId,
    });
    return fulfillmentId;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[shopify] triggerFulfillment failed', { shop, shopifyOrderId, error: message });
    return null;
  }
}
