# nit-platform

Cloudflare-native platform for:
- managed LLM proxy access (virtual keys, budgets, rate limits)
- usage ingestion/rollups
- project/report/drift/bug APIs
- React dashboard

## Stack

- Worker API: Hono + Cloudflare Workers
- DB: D1 (SQLite) + Drizzle schema/migrations
- KV: rate limits + runtime knobs
- R2: report payload storage
- Queue: usage event ingestion
- Auth: Better Auth (+ optional GitHub OAuth)
- Frontend: React + Vite + Tailwind

## Prerequisites

- Node.js 20+
- npm
- Cloudflare account
- Wrangler authenticated: `npx wrangler login`

## Local Setup

### 1) Install and validate

```bash
cd ~/platform
npm install
npm run lint
npm run typecheck
```

### 2) Provision Cloudflare resources (one-time)

```bash
# D1
npx wrangler d1 create nit-platform-db

# KV
npx wrangler kv namespace create KV

# R2
npx wrangler r2 bucket create nit-platform-reports

# Queue
npx wrangler queues create nit-usage-events
```

### 3) Apply DB migration

```bash
cd ~/platform

# local D1
npx wrangler d1 execute nit-platform-db --local --file=./drizzle/0000_initial.sql

# remote D1
npx wrangler d1 execute nit-platform-db --remote --file=./drizzle/0000_initial.sql
```

### 4) Configure Worker secrets

Required:

```bash
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put AI_GATEWAY_TOKEN
npx wrangler secret put USAGE_INGEST_TOKEN
```

Optional (if you want GitHub OAuth/webhooks):

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GITHUB_WEBHOOK_SECRET
```

### 5) Configure non-secret vars in `wrangler.jsonc`

Required:
- `AI_GATEWAY_BASE_URL` (Cloudflare AI Gateway URL with account/gateway IDs)
- `BETTER_AUTH_URL` (`http://localhost:8787` for local; production URL when deployed)

Common optional vars:
- `AI_GATEWAY_BYOK_ALIAS_MAP`
- `AI_GATEWAY_MAX_ATTEMPTS`
- `AI_GATEWAY_RETRY_DELAY_MS`
- `AI_GATEWAY_RETRY_BACKOFF`
- `AI_GATEWAY_REQUEST_TIMEOUT_MS`
- `DEFAULT_MARGIN_MULTIPLIER`
- `USAGE_EVENTS_RETENTION_DAYS`
- `USAGE_DAILY_RETENTION_DAYS`
- `DRIFT_RETENTION_DAYS`

### 6) Run locally

```bash
cd ~/platform
npm run build
npm run dev
```

This serves Worker API + dashboard assets (default local URL: `http://localhost:8787`).

## Deploy to Cloud

```bash
cd ~/platform
npm run build
npm run deploy
```

## CI/CD Status

This repo now includes two workflows:

- `/.github/workflows/ci.yml`
  - Runs on push/PR to `main`
  - Executes: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build`
- `/.github/workflows/deploy.yml`
  - Manual trigger (`workflow_dispatch`) from GitHub Actions UI
  - Optional input: `ref` (defaults to `main`)
  - Executes validation (`lint`, `typecheck`, `build`) and then `npm run deploy`

### Required GitHub secrets for deploy workflow

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### Required Secrets/Variables for Sentry Integration

- wrangler secret put `SENTRY_DSN` — set the backend DSN
- Set `VITE_SENTRY_DSN` at build time for the frontend
- Optionally set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` in CI for sourcemap uploads