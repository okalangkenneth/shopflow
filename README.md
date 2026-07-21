# ShopFlow

**E-commerce operations automation backend**-connects Stripe, Shopify, and Twilio into a single reliable event-driven hub.

When a customer pays on Shopify, ShopFlow catches the Stripe webhook, fans out three parallel background jobs (SMS confirmation, inventory sync, fulfillment trigger), retries any failures with exponential backoff, and surfaces real-time status through a REST API.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Customer Checkout                       │
│                     (Shopify Storefront)                     │
└──────────────────────────┬──────────────────────────────────┘
                           │ Payment captured
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Stripe Webhook (POST)                      │
│              HMAC signature verified ✓                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 ShopFlow  (Express + BullMQ)                  │
│                                                              │
│  Order saved to Supabase                                     │
│  3 jobs dispatched in parallel:                              │
│                                                              │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │  SMS Worker  │  │ Inventory Worker  │  │ Fulfillment   │  │
│  │  (Twilio)    │  │ (Supabase)        │  │ Worker        │  │
│  │              │  │                   │  │ (Shopify API) │  │
│  │ "Order #1234 │  │ Decrement stock   │  │ Create        │  │
│  │  confirmed"  │  │ for each SKU      │  │ fulfillment   │  │
│  └──────┬───────┘  └────────┬──────────┘  └──────┬────────┘  │
│         └───────────────────┴─────────────────────┘          │
│                             │                                 │
│            Job outcomes written to job_logs table             │
│            Failed jobs → exponential backoff (up to 5×)      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                        REST API                              │
│   GET /api/orders   GET /api/inventory   GET /api/jobs       │
└─────────────────────────────────────────────────────────────┘
```

---

## Features

| Feature | Details |
|---|---|
| **Stripe webhook processing** | HMAC signature verification; handles `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded` |
| **Shopify OAuth** | Full install flow — `/auth/shopify` → callback → access token persisted in Supabase |
| **Shopify webhooks** | HMAC verified handler for `orders/paid` and `orders/cancelled` |
| **Shopify fulfillment** | Fetches fulfillment orders, creates fulfillment via REST Admin API v2024-01 |
| **Twilio SMS** | Order confirmed, shipping update, and payment failed message builders |
| **BullMQ job queue** | Three named queues (sms, inventory, fulfillment) with 5-attempt exponential backoff |
| **Inventory sync** | Decrement/increment stock per SKU in Supabase on order events |
| **Job log persistence** | Every job outcome (completed/failed) written to `job_logs` table |
| **Rate limiting** | 100 req/15 min on webhook endpoints; 200 req/15 min on REST API |
| **Structured logging** | Winston — JSON in production, coloured in dev |
| **Docker Compose** | Single-command local dev with Redis |
| **Railway deployment** | `railway.json` config + `/api/health` check endpoint |
| **GitHub Actions CI** | Typecheck + build on every push to `master` |

---

## Live Demo

**Base URL:** `https://shopflow-production-08a9.up.railway.app`

| Endpoint | Link |
|---|---|
| Health + queue status | https://shopflow-production-08a9.up.railway.app/api/health |
| Orders | https://shopflow-production-08a9.up.railway.app/api/orders |
| Inventory | https://shopflow-production-08a9.up.railway.app/api/inventory |
| Job logs | https://shopflow-production-08a9.up.railway.app/api/jobs |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript (strict) |
| Framework | Express.js |
| Queue | BullMQ + Redis (IORedis) |
| Database | Supabase (PostgreSQL) |
| Payments | Stripe Webhooks |
| SMS | Twilio |
| E-commerce | Shopify REST Admin API + OAuth |
| Rate limiting | express-rate-limit |
| Logging | Winston |
| Deployment | Railway |
| CI/CD | GitHub Actions |

---

## Live Demo

> Deployed on Railway: **https://shopflow-production.up.railway.app**

---

## Local Development

### Prerequisites

- Node.js 20+
- Docker Desktop (for Redis)
- Stripe account (test mode) + [Stripe CLI](https://stripe.com/docs/stripe-cli)
- Supabase project
- Twilio account (trial is fine)
- Shopify Partner account + development store

### 1. Clone and install

```bash
git clone https://github.com/okalangkenneth/shopflow.git
cd shopflow
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in every value:

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page — use the **service_role** key |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Generated by `stripe listen` (step 5 below) |
| `TWILIO_ACCOUNT_SID` | Twilio Console → Account Info |
| `TWILIO_AUTH_TOKEN` | Same page |
| `TWILIO_PHONE_NUMBER` | Twilio Console → Phone Numbers |
| `SHOPIFY_API_KEY` | Shopify Partners → Apps → your app → API credentials |
| `SHOPIFY_API_SECRET` | Same page |
| `APP_URL` | `http://localhost:3000` for local dev |
| `REDIS_URL` | `redis://localhost:6379` (Docker provides this) |

### 3. Set up the database

In your **Supabase SQL editor**, run the entire contents of `supabase/schema.sql`.

This creates `orders`, `inventory`, `job_logs`, and `shopify_sessions` tables.

### 4. Start the server

```bash
docker-compose up
```

The API is available at `http://localhost:3000`.

Verify it's running:

```bash
curl http://localhost:3000/api/health
```

Expected:

```json
{
  "status": "ok",
  "timestamp": "2026-03-13T12:00:00.000Z",
  "version": "1.0.0",
  "queues": { "sms": "ready", "inventory": "ready", "fulfillment": "ready" }
}
```

---

## Testing Webhooks

### Stripe

```bash
# Terminal 1 — forward Stripe events to your local server
stripe listen --forward-to localhost:3000/webhooks/stripe
# Copy the printed webhook secret into STRIPE_WEBHOOK_SECRET in .env.local

# Terminal 2 — trigger test events
stripe trigger payment_intent.succeeded
stripe trigger payment_intent.payment_failed
stripe trigger charge.refunded
```

Watch the logs — you should see the webhook received, signature verified, order saved, and three jobs queued.

### Shopify

Use [ngrok](https://ngrok.com) to expose your local server, then configure the tunnel URL as `APP_URL` and register it in your Shopify Partner app:

```bash
ngrok http 3000
# Copy the https URL, set APP_URL=https://xxxx.ngrok.io in .env.local, restart
```

---

## API Reference

Base URL: `http://localhost:3000` (local) or your Railway URL in production.

Rate limit: **200 requests per 15 minutes** per IP.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health + queue status |
| `GET` | `/api/orders` | List orders — supports `?status=`, `?limit=`, `?offset=` |
| `GET` | `/api/orders/:id` | Get single order by UUID |
| `GET` | `/api/inventory` | List all inventory items |
| `GET` | `/api/jobs` | Job logs — supports `?order_id=`, `?status=` |
| `POST` | `/webhooks/stripe` | Stripe event receiver (rate limit: 100 req/15 min) |
| `POST` | `/webhooks/shopify` | Shopify event receiver (rate limit: 100 req/15 min) |
| `GET` | `/auth/shopify` | Shopify OAuth install redirect |
| `GET` | `/auth/shopify/callback` | Shopify OAuth callback |

Import `postman/shopflow.postman_collection.json` into Postman for ready-to-run requests with example responses.

---

## Project Structure

```
src/
├── index.ts                 # Express bootstrap + middleware stack
├── types/index.ts           # Shared TypeScript interfaces
├── db/
│   ├── client.ts            # Supabase client
│   └── redis.ts             # Redis / BullMQ connection
├── queues/
│   └── index.ts             # Queue definitions + job dispatcher
├── webhooks/
│   ├── stripe.ts            # Stripe webhook handler
│   └── shopify.ts           # Shopify webhook handler
├── routes/
│   ├── api.ts               # REST API endpoints
│   └── shopify.ts           # Shopify OAuth install flow
├── services/
│   ├── workers.ts           # BullMQ worker processors
│   ├── sms.ts               # Twilio SMS service
│   └── shopify.ts           # Shopify REST Admin API client
├── middleware/
│   ├── errorHandler.ts      # Global error + 404 handlers
│   └── rateLimiter.ts       # Webhook + API rate limiters
└── utils/
    ├── logger.ts             # Winston logger
    └── errorLogger.ts        # Structured external-API error helper
supabase/
└── schema.sql               # Full database schema
postman/
└── shopflow.postman_collection.json
```

---

## Deployment (Railway)

1. Create a new Railway project and connect this GitHub repo.
2. Add a **Redis** service from the Railway dashboard — `REDIS_URL` is injected automatically.
3. Add all other environment variables under the Railway **Variables** tab.
4. Railway runs `npm run build && npm start` on every deploy (configured in `railway.json`).

---

## Build Phases

- [x] Phase 1 — Foundation (Express + TypeScript + Supabase + Redis + BullMQ)
- [x] Phase 2 — Stripe webhook processing
- [x] Phase 3 — BullMQ worker processors
- [x] Phase 4 — Twilio SMS notifications
- [x] Phase 5 — Shopify OAuth + webhooks + fulfillment sync
- [x] Phase 6 — Rate limiting, structured error logging, README, Postman collection

---

## License

MIT
