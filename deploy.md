# Deployment Procedure — India Trade Explorer

**Target:** Cloudflare Workers (edge runtime)  
**Worker URL:** `https://india-trade-explorer.pratheekchriz.workers.dev`  
**Cron:** Hourly data scrape from TradeMap.org  
**D1 Database:** `india-trade-db` (APAC region)

---

## Prerequisites

- **Wrangler CLI** ≥ 4.x (`npm install -g wrangler`)
- **Bun** ≥ 1.3 (for building the frontend)
- **Cloudflare account** with Workers, D1, and Workers AI enabled
- **Authenticated wrangler**: `npx wrangler login`

### Verify

```bash
npx wrangler --version       # ≥ 4.x
npx wrangler whoami           # shows your Cloudflare account
bun --version                 # ≥ 1.3
```

---

## 1. Quick Deploy (one shot)

If everything is already set up (D1 created, schema applied, first deploy done):

```bash
# 1. Build frontend
cd frontend
bun install
bun run build.ts

# 2. Copy to worker static assets
cp dist/* ../worker/public/

# 3. Clean old assets (if any)
rm -f ../worker/public/chunk-*.js ../worker/public/chunk-*.js.map  # keep only current

# 4. Deploy worker
cd ../worker
npx wrangler deploy
```

Then trigger the initial data scrape:

```bash
curl -X POST https://india-trade-explorer.pratheekchriz.workers.dev/api/trade/refresh
```

Verify:

```bash
curl https://india-trade-explorer.pratheekchriz.workers.dev/api/ping
curl "https://india-trade-explorer.pratheekchriz.workers.dev/api/trade/exports?limit=3"
curl https://india-trade-explorer.pratheekchriz.workers.dev/api/ai/summary
```

---

## 2. Full Setup (first time)

### 2.1 Create the D1 database

```bash
npx wrangler d1 create india-trade-db --location=apac
```

Copy the `database_id` from the output. Paste it into `worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "india-trade-db"
database_id = "your-database-id-here"   # ← paste here
```

### 2.2 Apply the schema migration

```bash
cd worker
npx wrangler d1 execute india-trade-db --file=./migrations/001_init.sql --remote
```

This creates 4 tables: `categories`, `trade_items`, `scraping_log`, `ai_chat`.

### 2.3 Build the frontend

```bash
cd frontend
bun install
bun run build.ts
```

Output goes to `frontend/dist/`:
- `index.html`
- `chunk-*.js` (React app bundle)
- `chunk-*.css` (Tailwind CSS)
- `chunk-*.js.map` (source map)

### 2.4 Copy assets to worker

```bash
cp frontend/dist/* worker/public/
```

The worker serves these as static assets via the `[assets]` config in `wrangler.toml`.

### 2.5 Deploy the worker

```bash
cd worker
npx wrangler deploy
```

This deploys:
- The Hono worker (`src/index.ts`) — all API routes, scraper, AI
- Static assets from `public/` — the React SPA
- Cron trigger (hourly: `0 * * * *`)
- D1 database binding
- Workers AI binding

### 2.6 Seed data (first scrape)

```bash
curl -X POST https://india-trade-explorer.pratheekchriz.workers.dev/api/trade/refresh
```

Wait ~15 seconds. Verify:

```bash
curl "https://india-trade-explorer.pratheekchriz.workers.dev/api/trade/exports?limit=5"
# Should return items from TradeMap
```

---

## 3. Update Process

### 3.1 Worker code change only

```bash
cd worker
npx wrangler deploy
```

### 3.2 Frontend change

```bash
cd frontend
bun run build.ts
cp dist/* ../worker/public/
cd ../worker
npx wrangler deploy
```

### 3.3 Database schema change

Add a new migration file (e.g., `worker/migrations/002_add_countries.sql`):

```bash
cd worker
npx wrangler d1 execute india-trade-db --file=./migrations/002_add_countries.sql --remote
```

---

## 4. Architecture Overview

```
User Browser
     │
     ▼
https://india-trade-explorer.pratheekchriz.workers.dev
     │
     ├── / (SPA)         ← served from worker/public/
     ├── /api/trade/*     ← Hono routes → D1 queries
     ├── /api/ai/*        ← Workers AI (LLaMA 3.2)
     └── /api/trade/refresh  ← triggers scrapeNow()
                                    │
                                    ▼
                              TradeMap.org API
                              (treemap + linear chart)
```

### Data Flow

```
TradeMap API → scrapeNow() → temp table _trade_new
                            → atomic ALTER TABLE swap → trade_items
                                                      → D1 API → JSON → React SPA
```

### Cron Schedule

```toml
[triggers]
crons = ["0 * * * *"]   # Every hour
```

The cron runs `scrapeNow(env.DB)` which:
1. Creates a temp table `_trade_new` with the same schema
2. Fetches treemap (HS code breakdown) and linear chart (country partners) from TradeMap
3. Inserts all data into `_trade_new`
4. Atomically swaps: `trade_items → _trade_old`, `_trade_new → trade_items`, `DROP _trade_old`
5. If the scrape fails, `_trade_new` is dropped and old data survives

---

## 5. Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | React dashboard SPA |
| `/api/ping` | GET | Health check |
| `/api/trade/exports` | GET | Paginated export items |
| `/api/trade/imports` | GET | Paginated import items |
| `/api/trade/categories` | GET | HS category summaries |
| `/api/trade/countries` | GET | Country partner breakdown |
| `/api/trade/sources` | GET | Data source metadata |
| `/api/trade/refresh` | POST | Trigger scrape (30s throttle) |
| `/api/ai/summary` | GET | Auto-generated trade summary |
| `/api/ai/chat` | POST | Conversational AI analyst |
| `/api/scraping/log` | GET | Last 20 scrape runs |

---

## 6. Troubleshooting

### Empty data after deploy

Run a manual refresh (may take 10-30 seconds):

```bash
curl -X POST https://india-trade-explorer.pratheekchriz.workers.dev/api/trade/refresh
```

Check the scraping log:

```bash
curl https://india-trade-explorer.pratheekchriz.workers.dev/api/scraping/log
```

### Workers AI not responding

Verify the AI binding is in `wrangler.toml`:

```toml
[ai]
binding = "AI"
```

Enable Workers AI in the Cloudflare Dashboard: **Workers & Pages → your worker → Settings → AI**.

### Local development

```bash
cd worker
npx wrangler dev
# → http://localhost:8787 (local D1 + AI)
```

For frontend-only dev:

```bash
cd frontend
bun run dev   # or: bun run build.ts && bun run src/index.ts
# → http://localhost:5173
```

---

## 7. Environment Variables

Defined in `worker/wrangler.toml`:

| Variable | Value | Purpose |
|----------|-------|---------|
| `TRADESTAT_BASE` | `https://tradestat.commerce.gov.in` | Legacy reference (not currently used) |

---

## 8. Free Tier Limits

| Resource | Free Limit | Typical Usage |
|----------|-----------|---------------|
| Workers requests | 100,000/day | ~5,000 |
| Workers AI | 10,000 neurons/day | ~500 |
| D1 storage | 5 GB | ~1 MB |
| D1 reads | 5M rows/day | ~50,000 |
| Cron triggers | 5 | 1 |
