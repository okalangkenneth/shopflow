-- ============================================================
-- ShopFlow Database Schema
-- Run this in your Supabase SQL editor
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ─── Orders ──────────────────────────────────────────────────
create table if not exists orders (
  id uuid primary key default uuid_generate_v4(),
  shopify_order_id text unique not null,
  stripe_payment_intent_id text unique,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  total_amount numeric(10,2) not null,
  currency text not null default 'USD',
  status text not null default 'pending'
    check (status in ('pending','payment_confirmed','processing','fulfilled','cancelled','refunded')),
  line_items jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_status_idx on orders(status);
create index if not exists orders_shopify_id_idx on orders(shopify_order_id);
create index if not exists orders_created_at_idx on orders(created_at desc);

-- ─── Inventory ───────────────────────────────────────────────
create table if not exists inventory (
  id uuid primary key default uuid_generate_v4(),
  shopify_variant_id text unique not null,
  sku text not null,
  title text not null,
  quantity integer not null default 0 check (quantity >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_sku_idx on inventory(sku);
create index if not exists inventory_variant_idx on inventory(shopify_variant_id);

-- ─── Job Logs ─────────────────────────────────────────────────
create table if not exists job_logs (
  id uuid primary key default uuid_generate_v4(),
  job_id text not null,
  job_type text not null
    check (job_type in ('send_sms','sync_inventory','process_fulfillment','notify_shipping')),
  order_id uuid references orders(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','failed')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_logs_order_idx on job_logs(order_id);
create index if not exists job_logs_status_idx on job_logs(status);

-- ─── Auto-update timestamps ───────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger orders_updated_at
  before update on orders
  for each row execute function update_updated_at();

create trigger inventory_updated_at
  before update on inventory
  for each row execute function update_updated_at();

create trigger job_logs_updated_at
  before update on job_logs
  for each row execute function update_updated_at();

-- ─── Seed sample inventory ────────────────────────────────────
insert into inventory (shopify_variant_id, sku, title, quantity) values
  ('var_001', 'TSHIRT-BLK-M', 'Black T-Shirt (Medium)', 50),
  ('var_002', 'TSHIRT-WHT-L', 'White T-Shirt (Large)', 30),
  ('var_003', 'HOODIE-GRY-XL', 'Grey Hoodie (XL)', 20)
on conflict (shopify_variant_id) do nothing;
