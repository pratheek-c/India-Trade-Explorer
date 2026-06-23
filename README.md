# India Trade Explorer

Real-time India trade data dashboard powered by **TradeMap.org / ITC** data, deployed entirely on Cloudflare's edge platform with **Workers AI** for intelligent analysis.

**Live URL**: `https://india-trade-explorer.pratheekchriz.workers.dev`

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  Cloudflare Worker (single deployment)        │
│                                               │
│  GET  /              → Dashboard SPA          │
│  GET  /api/trade/*   → Trade data API         │
│  POST /api/ai/chat   → Workers AI (LLaMA 3.2) │
│  POST /api/trade/refresh → Trigger scraper    │
│                                               │
│  ┌─────────────┐  ┌──────────┐  ┌──────────┐ │
│  │  D1 Database │  │ Workers  │  │  Static  │ │
│  │  (SQLite)    │  │ AI (LLM) │  │  Assets  │ │
│  └─────────────┘  └──────────┘  └──────────┘ │
│                                               │
│  ┌─────────────────────────────────────┐      │
│  │  Scraper (cron: hourly)              │      │
│  │  → trademap.org/api/Dashboard        │      │
│  │  → HS code tree + country partners  │      │
│  └─────────────────────────────────────┘      │
└──────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Cloudflare Workers |
| **Framework** | Hono (fast routing + middleware) |
| **Database** | Cloudflare D1 (edge SQLite) |
| **AI** | Workers AI — `@cf/meta/llama-3.2-3b-instruct` |
| **Scraping** | `fetch()` — TradeMap.org JSON API |
| **Scheduling** | Workers Cron Triggers (`0 * * * *`) |
| **Frontend** | React 19 + Tailwind CSS 4 (single-file SPA) |
| **Hosting** | Cloudflare Workers static assets |
| **CLI** | Wrangler v4 |

---

## Prerequisites

- **Node.js** ≥ 18 or **Bun** ≥ 1.3 (for local frontend dev)
- **Cloudflare account** (free tier works — 100k req/day, 5GB D1, 10k AI req/day)
- **Wrangler CLI** installed and authenticated:

```bash
npm install -g wrangler
wrangler login
```

Verify:

```bash
wrangler --version   # ≥ 4.x
```

---

## Quick Start — Deploy to Cloudflare

### 1. Clone & install

```bash
git clone https://github.com/pratheek-c/India-Trade-Explorer.git
cd India-Trade-Explorer/worker
npm install   # or: bun install
```

### 2. Create the D1 database

```bash
wrangler d1 create india-trade-db --location=apac
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "india-trade-db"
database_id = "your-database-id-here"   # ← paste here
```

### 3. Apply schema migration

```bash
# Local dev database
wrangler d1 execute india-trade-db --file=./migrations/001_init.sql

# Remote production database
wrangler d1 execute india-trade-db --file=./migrations/001_init.sql --remote
```

### 4. Deploy

```bash
wrangler deploy
```

**Done!** The Worker is live with:
- API endpoints at `https://your-worker.workers.dev/api/*`
- Dashboard at `https://your-worker.workers.dev/`
- Hourly scraper via cron
- Workers AI enabled (auto-detected)

### 5. Trigger initial data scrape

```bash
curl -X POST https://your-worker.workers.dev/api/trade/refresh
```

Wait ~15 seconds, then verify:

```bash
curl https://your-worker.workers.dev/api/trade/exports?limit=3
curl https://your-worker.workers.dev/api/ai/summary
```

---

## Local Development

### Worker (API + Scraper)

The worker CAN run locally with Bun for quick iteration (uses in-memory SQLite):

```bash
cd worker
bun install
bun run dev
# → http://localhost:3001 (Wrangler dev)
```

But for full D1 + AI integration, use Wrangler:

```bash
cd worker
wrangler dev
# → http://localhost:8787 (local D1 + AI bindings)
```

### Frontend (React)

Local dev server with hot reload pointing to the deployed worker:

```bash
cd frontend
bun install
bun run dev
# → http://localhost:5173
```

To point to a different API, edit `frontend/src/App.tsx` line 17:

```ts
const API = "https://your-worker.workers.dev";
```

Build and copy to worker for deployment:

```bash
cd frontend
bun run build.ts
cp dist/* ../worker/public/
cd ../worker
wrangler deploy
```

---

## API Reference

### Trade Data

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/trade/exports` | Export items (paginated) |
| `GET` | `/api/trade/imports` | Import items (paginated) |
| `GET` | `/api/trade/categories` | HS category summary |
| `GET` | `/api/trade/countries` | Country partner data |
| `GET` | `/api/trade/sources` | Data source + last updated |
| `POST` | `/api/trade/refresh` | Trigger manual scrape |

**Query parameters** (for exports/imports):

| Param | Example | Description |
|-------|---------|-------------|
| `search` | `oil` | Search product name or country |
| `country` | `US` | Filter by country code |
| `sort` | `value_desc` | Sort: value_desc/asc, product_asc/desc, country_asc/desc, demand_desc |
| `limit` | `25` | Items per page (max 200) |
| `offset` | `0` | Pagination offset |

### AI Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/ai/summary` | Auto-generated trade summary |
| `POST` | `/api/ai/chat` | Conversational AI analyst |

**Chat request body:**

```json
{
  "message": "Analyze India's top export categories and their growth"
}
```

### Diagnostic

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/ping` | Health check (DB connection) |
| `GET` | `/api/scraping/log` | Recent scrape runs (last 20) |

---

## Project Structure

```
India-Trade-Explorer/
├── worker/
│   ├── src/
│   │   └── index.ts           # Hono app + all routes + scraper
│   ├── migrations/
│   │   └── 001_init.sql       # D1 schema + category seeds
│   ├── public/                # Built frontend (static assets)
│   │   ├── index.html
│   │   ├── chunk-*.js
│   │   └── chunk-*.css
│   ├── wrangler.toml          # Cloudflare config
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Single-file React dashboard
│   │   ├── index.tsx          # React entry point
│   │   ├── index.ts           # Dev server (localhost:5173)
│   │   ├── index.html         # HTML shell
│   │   └── index.css          # Tailwind + CSS variables
│   ├── build.ts               # Bun build script
│   └── package.json
├── plan.md                    # Architecture plan
├── requirements.md            # Detailed requirements
└── README.md
```

---

## Data Pipeline

```
TradeMap.org API
    │
    ├── GET /api/Dashboard?chart=treemap&countryCd=699
    │   └── HS code tree → classify into 12 categories → D1
    │
    └── GET /api/Dashboard?chart=linear&countryCd=699
        └── Country partners → exports/imports/balance → D1

    Cron: every hour (crons = ["0 * * * *"])
    Manual: POST /api/trade/refresh
```

### Data Classification

TradeMap HS codes are auto-classified into 12 standard categories:

| HS | Category |
|----|----------|
| 10 | Agricultural Products |
| 15 | Vegetable Oils |
| 27 | Mineral Fuels & Oils |
| 30 | Pharmaceuticals |
| 39 | Plastics & Chemicals |
| 61 | Textiles & Apparel |
| 71 | Gems & Jewelry |
| 72 | Iron & Steel |
| 84 | Machinery & Equipment |
| 85 | Electronics & Telecom |
| 87 | Transport Equipment |
| 95 | Toys & Sports |

---

## Workers AI

The chat endpoint uses **LLaMA 3.2 3B Instruct** via Cloudflare Workers AI.

**Context provided to the LLM:**
- Export/import totals
- Top 15 trade items with values
- Top 10 category breakdown
- Top 10 country partner breakdown

The AI operates on real data from D1 — every query pulls fresh totals and item lists before generating the prompt.

**Fallback:** If Workers AI is unavailable (local dev without Wrangler), falls back to rule-based SQL analysis.

---

## Shipment Cost Estimation

Estimated shipment costs are computed per country based on region:

| Region | Rate | Countries |
|--------|------|-----------|
| Neighbor | 6% | Bangladesh, Nepal, Sri Lanka, Pakistan |
| Asia | 9% | China, UAE, Saudi Arabia, Singapore, Japan |
| Europe/Africa | 13% | Germany, UK, France, South Africa |
| Americas | 16% | USA, Brazil |

---

## Environment Variables

Defined in `wrangler.toml`:

| Variable | Value | Purpose |
|----------|-------|---------|
| `TRADESTAT_BASE` | `https://tradestat.commerce.gov.in` | Legacy source reference |

---

## Troubleshooting

### `wrangler deploy` fails with bun:sqlite error

The `bun:sqlite` import is used only for local Bun development. Wrangler automatically resolves it via the `[alias]` in wrangler.toml. If this fails, ensure Wrangler ≥ v4.

### No data after deployment

Run a manual scrape:

```bash
curl -X POST https://your-worker.workers.dev/api/trade/refresh
```

Check the scraping log:

```bash
curl https://your-worker.workers.dev/api/scraping/log
```

### Workers AI not responding

Verify the AI binding is in `wrangler.toml`:

```toml
[ai]
binding = "AI"
```

Check that Workers AI is enabled in your Cloudflare dashboard: **Workers & Pages → your worker → Settings → AI**.

### Frontend shows blank page

Check browser console for errors. Ensure the API URL in `App.tsx` points to the deployed worker (empty string `""` for same-origin deployment, or full URL for separate deployments).

---

## Free Tier Limits

| Resource | Free Limit | Typical Usage |
|----------|-----------|---------------|
| Workers requests | 100,000/day | ~5,000 |
| Workers AI | 10,000 neurons/day | ~500 |
| D1 storage | 5 GB | ~1 MB |
| D1 reads | 5M rows/day | ~50,000 |
| Cron triggers | 5 | 1 |
