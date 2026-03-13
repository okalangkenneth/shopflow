// Order status flow
export type OrderStatus =
  | 'pending'
  | 'payment_confirmed'
  | 'processing'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded';

// Job types for BullMQ queue
export type JobType =
  | 'send_sms'
  | 'sync_inventory'
  | 'process_fulfillment'
  | 'notify_shipping';

export interface Order {
  id: string;
  shopify_order_id: string;
  stripe_payment_intent_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  total_amount: number;
  currency: string;
  status: OrderStatus;
  line_items: LineItem[];
  created_at: string;
  updated_at: string;
}

export interface LineItem {
  product_id: string;
  variant_id: string;
  title: string;
  quantity: number;
  price: number;
  sku: string;
}

export interface InventoryItem {
  id: string;
  shopify_variant_id: string;
  sku: string;
  title: string;
  quantity: number;
  reserved: number;
  updated_at: string;
}

export interface JobLog {
  id: string;
  job_id: string;
  job_type: JobType;
  order_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  attempts: number;
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface SmsJobData {
  to: string;
  customerName: string;
  orderId: string;
  messageType: 'order_confirmed' | 'shipping_update' | 'payment_failed';
  trackingUrl?: string;
}

export interface InventorySyncJobData {
  orderId: string;
  lineItems: LineItem[];
  action: 'decrement' | 'restore';
}

export interface FulfillmentJobData {
  orderId: string;
  shopifyOrderId: string;
  lineItems: LineItem[];
  shop?: string; // Present when triggered from a Shopify webhook
}

export interface ShopifySession {
  id: string;
  shop: string;
  access_token: string;
  scope: string;
  created_at: string;
  updated_at: string;
}
