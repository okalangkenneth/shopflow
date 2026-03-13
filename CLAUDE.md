# ShopFlow — Project Rules

## Memory Architecture (3-Layer System)

This project uses a unified memory approach combining:

| Layer | Location | Purpose | Auto-Loaded |
|-------|----------|---------|-------------|
| **CLAUDE.md** | Project root | Rules, workflow, conventions | ✅ Always |
| **MEMORY.md** | `~/.claude/projects/<project>/memory/` | Session learnings, patterns Claude discovers | ✅ First 200 lines |
| **claude-mem** | `~/.claude-mem/` | Deep searchable history, AI-compressed | ✅ Via MCP injection |

### Memory Commands

| Command | Purpose |
|---------|---------|
| `/memory` | View/toggle auto-memory, edit CLAUDE.md |
| `/remember` | Suggest patterns to save permanently |
| `/compact` | Instant (uses pre-written Session Memory) |

---

## Build Progress (KEEP UPDATED)

**Claude Code: Update this section at the end of every session.**

### ✅ COMPLETED
- Project scaffold: Express + TypeScript + Supabase + Redis + BullMQ
- `src/index.ts` — Express bootstrap with correct middleware order
- `src/types/index.ts` — Shared TypeScript interfaces
- `src/db/client.ts` — Supabase client + connection test
- `src/db/redis.ts` — Redis/BullMQ connection
- `src/queues/index.ts` — Queue definitions, job dispatcher, health check
- `src/webhooks/stripe.ts` — Stripe webhook handler (payment success, failure, refund)
- `src/routes/api.ts` — REST API (health, orders, inventory, job logs)
- `src/middleware/errorHandler.ts` — Global error + 404 handlers
- `src/utils/logger.ts` — Winston logger
- `supabase/schema.sql` — Full DB schema (orders, inventory, job_logs)
- `Dockerfile` + `docker-compose.yml` + `railway.json` + GitHub Actions CI
- `src/services/workers.ts` — BullMQ worker processors (smsWorker, inventoryWorker, fulfillmentWorker) wired into bootstrap
- `src/services/sms.ts` — Twilio SMS service (sendSms, typed message builders); wired into smsWorker
- `src/services/shopify.ts` — Shopify REST Admin API client (getOrder, updateInventory, triggerFulfillment)
- `src/webhooks/shopify.ts` — Shopify webhook handler (HMAC verification, orders/paid, orders/cancelled)
- `src/routes/shopify.ts` — Shopify OAuth install flow (/auth/shopify, /auth/shopify/callback)
- `supabase/schema.sql` — shopify_sessions table added

- `src/middleware/rateLimiter.ts` — express-rate-limit (100 req/15min webhooks, 200 req/15min API, JSON 429 responses)
- `src/utils/errorLogger.ts` — logApiError() helper; replaced raw logger.error calls in sms.ts and shopify.ts
- `README.md` — portfolio-quality: ASCII architecture diagram, live demo, copy-paste local setup, webhook testing guide, full feature table
- `postman/shopflow.postman_collection.json` — all 6 endpoints with example responses

### 🔨 IN PROGRESS
<!-- none -->

### ❌ REMAINING
<!-- All phases complete -->

---

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
| Package Manager | `npm` (not bun) |

## Architecture

```
Customer pays on Shopify
        ↓
Stripe webhook → ShopFlow verifies signature
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

## Project Structure

```
src/
├── index.ts              # Express bootstrap
├── types/index.ts        # Shared TypeScript interfaces
├── db/
│   ├── client.ts         # Supabase client
│   └── redis.ts          # Redis/BullMQ connection
├── queues/
│   └── index.ts          # Queue definitions + job dispatcher
├── webhooks/
│   ├── stripe.ts         # Stripe webhook handler
│   └── shopify.ts        # Shopify webhook handler (Phase 5)
├── routes/
│   └── api.ts            # REST API
├── services/
│   ├── workers.ts        # BullMQ worker processors (Phase 3)
│   ├── sms.ts            # Twilio SMS service (Phase 4)
│   └── shopify.ts        # Shopify API client (Phase 5)
├── middleware/
│   └── errorHandler.ts   # Global error + 404 handlers
└── utils/
    └── logger.ts         # Winston logger
```

---

## Workflow

```
1. Make changes
2. Typecheck: npm run typecheck
3. Build: npm run build
4. Test locally: docker-compose up
5. Commit: conventional commits (feat:, fix:, chore:)
6. Push → GitHub Actions runs typecheck + build
```

## Git Conventions
- **Branch**: `master` = production. Feature: `git checkout -b feat/name`
- **Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- **Before commit**: `npm run typecheck`
- **Never commit**: `.env`, API keys, secrets

## GitHub Repository

**Repo**: https://github.com/okalangkenneth/shopflow

### First-time setup (if repo doesn't exist yet)
```bash
git init
git add .
git commit -m "feat: initial project scaffold — Phase 1"
git remote add origin https://github.com/okalangkenneth/shopflow.git
git branch -M master
git push -u origin master
```

### After every phase is completed
```bash
git add .
git commit -m "feat: Phase X — <short description>"
git push
```

### Rules
- Commit and push at the end of **every phase**, not just at the end of the project
- Keep commit messages descriptive — they show up on the portfolio
- Never push `.env` — it is in `.gitignore`

---

## Critical Rules

### Stripe Webhooks (NON-NEGOTIABLE)
- Raw body middleware MUST come BEFORE `express.json()`
- Always verify webhook signature with `stripe.webhooks.constructEvent()`
- Never trust webhook data without signature verification

### BullMQ / Redis
- Redis connection MUST set `maxRetriesPerRequest: null` — BullMQ requires this
- Always set `attempts` + `backoff` on queue `defaultJobOptions`
- Log job failures to `job_logs` table in Supabase

### Code Quality
- NO placeholders (`YOUR_API_KEY`, `TODO`, `FIXME`) in committed code
- Environment variables for ALL secrets — see `.env.example`
- Add `logger.error()` for every external API call failure
- TypeScript strict mode — no `any` without justification

### Before Every Change
- Only modify what was explicitly requested
- Ask if <90% confident on approach
- Offer 2-3 options for significant architectural decisions

---

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (not anon key) |
| `STRIPE_SECRET_KEY` | Stripe secret (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | From `stripe listen` or dashboard |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Your Twilio number |
| `SHOPIFY_API_KEY` | Shopify app API key |
| `SHOPIFY_API_SECRET` | Shopify app secret |
| `REDIS_URL` | Redis connection (Railway auto-injects) |

---

## Running Locally

```bash
# Start Redis + API together
docker-compose up

# API only (requires Redis on localhost:6379)
npm run dev

# Test Stripe webhooks locally
stripe listen --forward-to localhost:3000/webhooks/stripe

# Typecheck only
npm run typecheck
```

## Database

Run `supabase/schema.sql` in your Supabase SQL editor before first run.

Tables: `orders`, `inventory`, `job_logs`

---

## Corrections Log

| Date | Mistake | Rule |
|------|---------|------|
| | | |

---

## Session Management

### Starting
1. CLAUDE.md auto-loads — check Build Progress for current state
2. Run `npm install` if `node_modules/` is missing — always do this before typechecking
3. Don't re-explore completed files — trust the progress log

### Ending
```
Update the Build Progress section in CLAUDE.md with completed work, then stop.
```
