# ShopFlow — E-commerce Operations Automation Backend

A production-ready Node.js + TypeScript backend that automates e-commerce operations by connecting **Stripe**, **Shopify**, and **Twilio** into a single integration hub. When a customer places an order, ShopFlow handles payment confirmation, SMS notifications, inventory sync, and fulfillment queuing — automatically and in parallel.

## Architecture

```
Customer pays on Shopify
        ↓
Stripe webhook → ShopFlow receives & verifies
        ↓
BullMQ dispatches 3 parallel background jobs:
   ├── SMS via Twilio       → "Order confirmed ✅"
   ├── Inventory sync       → Decrement stock in Supabase
   └── Fulfillment queue    → Trigger Shopify fulfillment
        ↓
REST API reflects real-time order + job status
        ↓
Any failure → exponential backoff retry (up to 5x)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Framework | Express.js |
| Queue | BullMQ + Redis |
| Database | Supabase (PostgreSQL) |
| Payments | Stripe Webhooks |
| SMS | Twilio |
| E-commerce | Shopify REST Admin API + OAuth |
| Deployment | Railway |
| CI/CD | GitHub Actions |

## Features

- **Stripe webhook processing** with signature verification and idempotency
- **BullMQ queue system** with exponential backoff retry logic and dead letter handling
- **Twilio SMS** for order confirmation, shipping updates, and payment failure alerts
- **Shopify OAuth** installation flow + order sync + inventory updates
- **REST API** for orders, inventory, and job status — dashboard-ready
- **Structured logging** via Winston (JSON in production, colorized in dev)
- **Docker + Railway** deployment ready out of the box

## Project Structure

```
src/
├── index.ts              # Express app bootstrap
├── types/index.ts        # Shared TypeScript interfaces
├── db/
│   ├── client.ts         # Supabase client
│   └── redis.ts          # Redis/BullMQ connection
├── queues/
│   └── index.ts          # Queue definitions + job dispatcher
├── webhooks/
│   ├── stripe.ts         # Stripe webhook handler
│   └── shopify.ts        # Shopify webhook handler
├── routes/
│   └── api.ts            # REST API (health, orders, inventory, jobs)
├── services/
│   ├── sms.ts            # Twilio SMS service
│   ├── shopify.ts        # Shopify API client
│   └── workers.ts        # BullMQ worker processors
├── middleware/
│   └── errorHandler.ts   # Global error + 404 handlers
└── utils/
    └── logger.ts         # Winston logger
```

## Getting Started

### Prerequisites
- Node.js 20+
- Docker Desktop (for Redis)
- Supabase project
- Stripe account (test mode)
- Twilio account
- Shopify Partner account (for OAuth app)

### 1. Clone & install

```bash
git clone https://github.com/okalangkenneth/shopflow.git
cd shopflow
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in your API keys
```

### 3. Set up database

Run `supabase/schema.sql` in your Supabase SQL editor.

### 4. Start development

```bash
# Start Redis + API together
docker-compose up

# Or API only (requires Redis running separately)
npm run dev
```

### 5. Test Stripe webhooks locally

```bash
# Install Stripe CLI, then:
stripe listen --forward-to localhost:3000/webhooks/stripe
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Server + queue health check |
| GET | `/api/orders` | List orders (filterable by status) |
| GET | `/api/orders/:id` | Single order details |
| GET | `/api/inventory` | Current inventory levels |
| GET | `/api/jobs` | Background job logs |
| POST | `/webhooks/stripe` | Stripe event receiver |
| GET | `/auth/shopify` | Shopify OAuth install |
| GET | `/auth/shopify/callback` | Shopify OAuth callback |

## Deployment

This project is configured for one-click Railway deployment:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Deploy
railway login
railway init
railway up
```

Add Redis as a Railway plugin — `REDIS_URL` is injected automatically.

## Build Phases

- [x] Phase 1 — Foundation (Express + TypeScript + Supabase + Redis + Queues)
- [x] Phase 2 — Stripe webhook processing
- [ ] Phase 3 — BullMQ worker processors
- [ ] Phase 4 — Twilio SMS notifications
- [ ] Phase 5 — Shopify OAuth + sync
- [ ] Phase 6 — Rate limiting, Postman collection, architecture diagram

## License

MIT
