# India Trade Explorer — Application Requirements & Architecture

## 1. Overview

**Product Name:** India Trade Explorer
**Purpose:** A web-based dashboard for exploring India's import/export trade data sourced from TRADESTAT (DGFT / Ministry of Commerce, Government of India), with AI-powered insights.
**Version:** 0.1.0

---

## 2. Functional Requirements

### 2.1 Core Features

| Feature | Description |
|---------|-------------|
| **Trade Data View** | Display India's exports and imports with product, country, value, volume, demand level, and shipment cost information |
| **Category Drill-down** | Browse trade data by HS category codes (e.g., 27 = Mineral Fuels, 71 = Gems & Jewelry) |
| **Subcategory Breakdown** | View subcategories within each HS category with 4-digit HS subcodes |
| **Search & Filter** | Filter trade items by product name, country, or category code with real-time filtering |
| **Sortable Data Tables** | Sort trade records by rank, product name, country, trade value, demand level, or shipment cost |
| **Dark/Light Mode** | Toggle between light and dark themes with system preference detection |
| **Data Refresh** | Manually refresh trade data from TRADESTAT source |
| **Export/Import Toggle** | Switch between viewing export and import data |
| **Breadcrumb Navigation** | Navigate back from subcategory → category → home |
| **AI Insights** | AI-generated trade analysis, trends, and recommendations via Workers AI |
| **Live Data Scraping** | Scheduled scraping from TRADESTAT eidb portal for near-real-time data |

### 2.2 Data Fields per Trade Item

- `productName` — Name of the traded product
- `category` — ISO HS2 category name (e.g., "Mineral Fuels & Oils")
- `categoryCode` — HS2 code (e.g., "27")
- `type` — "Export" or "Import"
- `country` — Trade partner country
- `demandLevel` — "Very High", "High", "Medium", "Low" (derived from trade value)
- `tradeValueUsd` — Trade value in USD millions
- `volume` — Volume in units (approximated where not available)
- `rank` — Rank by trade value
- `estExportPriceUsd` — Estimated price per unit (USD)
- `estShipmentCostUsd` — Estimated shipment cost in USD millions (region-based multiplier)
- `shipmentCostEstimated` — Boolean flag indicating if shipment cost is estimated
- `source` — Data source (TRADESTAT / DGFT)
- `sourceUrl` — URL to data source
- `lastUpdated` — Last data refresh date

### 2.3 Supported HS Categories

| HS Code | Category Name |
|---------|--------------|
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

### 2.4 Shipment Cost Estimation Rules

- **Neighboring countries** (Bangladesh, Nepal, Pakistan, Sri Lanka, Bhutan, Myanmar): 6% of trade value
- **Asia region** (China, UAE, Saudi Arabia, Iran, etc.): 9% of trade value
- **Europe / Africa** (UK, Germany, France, South Africa, etc.): 13% of trade value
- **All others** (USA, etc.): 16% of trade value

---

## 3. Cloudflare Workers Deployment (Target Architecture)

The application targets deployment entirely on Cloudflare's edge platform:

```
┌─────────────┐     ┌───────────────────────────────────┐
│  User       │────▶│  Cloudflare Workers (API layer)    │
│  Browser    │     │  - Hono framework                  │
└─────────────┘     │  - API endpoints + SSR pages       │
                    │  - Workers AI integrations          │
                    │  - HTMLRewriter for scraping        │
                    └──────┬──────────────────────┬───────┘
                           │                     │
                           ▼                     ▼
                 ┌─────────────────┐   ┌──────────────────┐
                 │  D1 Database    │   │  Workers AI      │
                 │  (SQLite edge)  │   │  (LLM analysis)  │
                 │                 │   │                  │
                 │ - trade_items   │   │ - @cf/meta/llama │
                 │ - categories    │   │ - @cf/mistral    │
                 │ - countries     │   │ - text-embedding │
                 │ - scraping_log  │   └──────────────────┘
                 └─────────────────┘
                           │
                           ▼
                 ┌──────────────────────┐
                 │  TRADESTAT (DGFT)    │
                 │  Source websites     │
                 │  - eidb portal       │
                 │  - ftspcc portal     │
                 └──────────────────────┘
```

### 3.1 Why Cloudflare Workers

| Requirement | Cloudflare Solution |
|-------------|-------------------|
| **Global low-latency** | Workers run at 330+ edge locations |
| **No server management** | Serverless with automatic scaling |
| **Data at edge** | D1 (SQLite on edge) with zero cold starts |
| **AI on edge** | Workers AI — no separate GPU infrastructure |
| **Scheduled scraping** | Cron Triggers for periodic data refresh |
| **Static assets** | Workers + Pages for SPA delivery |
| **Free tier** | 100k requests/day for Workers, 5GB D1, 10k AI requests/day |

### 3.2 Tech Stack (Cloudflare Target)

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Cloudflare Workers (JavaScript/TypeScript) | Edge serverless functions |
| **Framework** | Hono | Fast, lightweight routing with middleware |
| **Database** | Cloudflare D1 | Edge SQLite database |
| **ORM / Query** | D1 SDK + Drizzle | Type-safe queries |
| **AI** | Workers AI (Cloudflare AI Gateway) | Trade insights, trends, summarization |
| **Scheduling** | Workers Cron Triggers | Periodic scraping of TRADESTAT |
| **Scraping** | `HTMLRewriter` API + `fetch()` | Lightweight DOM parsing at edge |
| **Frontend** | React SPA (served via Pages) | Interactive dashboard |
| **Embeddings** | Workers AI text-embedding | Semantic search across trade items |

---

## 4. D1 Database Schema

### 4.1 Table: `categories`

```sql
CREATE TABLE categories (
  hs_code      TEXT PRIMARY KEY,          -- e.g. "27"
  name         TEXT NOT NULL,             -- e.g. "Mineral Fuels & Oils"
  description  TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);
```

### 4.2 Table: `subcategories`

```sql
CREATE TABLE subcategories (
  hs4_code     TEXT PRIMARY KEY,          -- e.g. "2710"
  name         TEXT NOT NULL,             -- e.g. "Petroleum Products - Refined"
  parent_hs    TEXT NOT NULL REFERENCES categories(hs_code),
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_subcat_parent ON subcategories(parent_hs);
```

### 4.3 Table: `countries`

```sql
CREATE TABLE countries (
  code         TEXT PRIMARY KEY,          -- ISO 2-letter code
  name         TEXT NOT NULL,
  region       TEXT NOT NULL,             -- "neighbor", "asia", "europe_africa", "americas_other"
  created_at   TEXT DEFAULT (datetime('now'))
);
```

### 4.4 Table: `trade_items`

```sql
CREATE TABLE trade_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  product_name      TEXT NOT NULL,
  category_code     TEXT NOT NULL REFERENCES categories(hs_code),
  subcategory_code  TEXT REFERENCES subcategories(hs4_code),
  trade_type        TEXT NOT NULL CHECK(trade_type IN ('export', 'import')),
  country_code      TEXT NOT NULL REFERENCES countries(code),
  trade_value_usd   REAL NOT NULL,
  volume            REAL,
  unit              TEXT DEFAULT 'units',
  est_price_per_unit REAL,
  demand_level      TEXT CHECK(demand_level IN ('Very High','High','Medium','Low')),
  source_url        TEXT,
  scraped_at        TEXT DEFAULT (datetime('now')),
  data_year         TEXT,                  -- e.g. "2025-2026"
  data_month        TEXT                   -- e.g. "April"
);

CREATE INDEX idx_trade_type ON trade_items(trade_type);
CREATE INDEX idx_trade_category ON trade_items(category_code);
CREATE INDEX idx_trade_country ON trade_items(country_code);
CREATE INDEX idx_trade_year ON trade_items(data_year);
```

### 4.5 Table: `scraping_log`

```sql
CREATE TABLE scraping_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url  TEXT NOT NULL,
  status      TEXT CHECK(status IN ('success','partial','failed')),
  items_count INTEGER DEFAULT 0,
  error_msg   TEXT,
  started_at  TEXT,
  finished_at TEXT DEFAULT (datetime('now'))
);
```

### 4.6 Table: `ai_insights`

```sql
CREATE TABLE ai_insights (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  insight_type    TEXT NOT NULL,          -- "trend", "summary", "recommendation", "anomaly"
  scope_type      TEXT NOT NULL,          -- "category", "country", "overall"
  scope_value     TEXT NOT NULL,          -- e.g. "27", "USA", "overall"
  trade_type      TEXT,                   -- "export", "import", or NULL for both
  insight_text    TEXT NOT NULL,
  confidence      REAL DEFAULT 0.0,
  generated_at    TEXT DEFAULT (datetime('now')),
  prompt_tokens   INTEGER,
  completion_tokens INTEGER
);

CREATE INDEX idx_insight_scope ON ai_insights(scope_type, scope_value);
CREATE INDEX idx_insight_type ON ai_insights(insight_type);
```

---

## 5. Workers AI Integration

### 5.1 Capabilities

| AI Feature | Model | Trigger | Output |
|-----------|-------|---------|--------|
| **Trade Trend Analysis** | `@cf/meta/llama-3.2-3b-instruct` | After data refresh | Natural language summary of trade volume changes |
| **Category Deep-Dive** | `@cf/meta/llama-3.2-3b-instruct` | User visits category page | Key observations, top country shifts, demand assessment |
| **Export/Import Recommendations** | `@cf/meta/llama-3.2-3b-instruct` | User requests suggestions | Which products to promote, which to diversify |
| **Anomaly Detection** | `@cf/mistral/mistral-7b-instruct-v0.1` | Scheduled cron | Unusual trade patterns flagged in plain language |
| **Semantic Search** | `@cf/baai/bge-base-en-v1.5` | User searches via natural language | Embedding-based product/country matching |
| **Automated Report Generation** | `@cf/meta/llama-3.2-3b-instruct` | Weekly cron | Executive summary of trade landscape |

### 5.2 Prompt Template Example (Category Deep-Dive)

```
You are an India trade data analyst. Given the following trade data for
category "{category_name}" (HS code {hs_code}):

- Total export value: ${exports_value}M
- Total import value: ${imports_value}M
- Top 5 export destinations: {export_countries}
- Top 5 import sources: {import_countries}
- Top products: {products}

Provide a brief analysis (3-4 sentences):
1. The overall health of this category
2. Notable trends or dependencies
3. One actionable recommendation for Indian traders
```

### 5.3 Workers AI Usage (Hono)

```typescript
import { Hono } from 'hono'
import { ai } from '@cloudflare/workers-ai-provider'

const app = new Hono()

app.get('/api/ai/insights/:category', async (c) => {
  const { category } = c.req.param()
  const tradeData = await c.env.DB
    .prepare('SELECT ... FROM trade_items WHERE category_code = ?')
    .bind(category)
    .all()

  const prompt = buildCategoryPrompt(category, tradeData.results)
  const response = await c.env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
    prompt,
    max_tokens: 300,
  })

  // Cache insight in D1
  await c.env.DB
    .prepare('INSERT INTO ai_insights (...) VALUES (...)')
    .bind(...)
    .run()

  return c.json({ insight: response.response })
})
```

---

## 6. Real-Time Data Scraping from TRADESTAT

### 6.1 Primary Target

**URL:** `https://tradestat.commerce.gov.in/eidb/commodity_wise_import`

The EIDB portal provides commodity-wise import data in tabular HTML format. The scraping approach uses Cloudflare's `HTMLRewriter` API (edge-native, no jsdom/cheerio dependency).

### 6.2 Scraping Architecture

```
Cron Trigger (6-hourly)
       │
       ▼
┌─────────────────────────────┐
│  Workers fetch + parse      │
│  Using HTMLRewriter         │
│  ┌───────────────────────┐  │
│  │ Source URLs:           │  │
│  │ - eidb commodity_wise  │  │
│  │ - ftspcc import/export │  │
│  └───────────────────────┘  │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Transform + Validate       │
│  - Parse table rows         │
│  - Normalize country names  │
│  - Calculate demand level   │
│  - Estimate shipment costs  │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Batch insert into D1        │
│  UPSERT on (product,country,│
│  year, month, trade_type)   │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Trigger Workers AI         │
│  Generate fresh insights    │
│  Log scraping result        │
└─────────────────────────────┘
```

### 6.3 HTMLRewriter Scraping Selectors

```typescript
// Example scrape handler
async function scrapeEidbImport(c.env): Promise<ScrapeResult> {
  const url = 'https://tradestat.commerce.gov.in/eidb/commodity_wise_import'
  const response = await fetch(url, {
    headers: { 'User-Agent': 'IndiaTradeExplorer/1.0' },
  })

  const rows: RawRow[] = []

  const rewriter = new HTMLRewriter()
    .on('table.wp-block-table tbody tr', {
      element(el) {
        const cells = el.querySelectorAll('td')
        if (cells.length >= 4) {
          rows.push({
            commodity: cells[0].textContent.trim(),
            country: cells[1].textContent.trim(),
            value: parseFloat(cells[2].textContent.replace(/[^0-9.]/g, '')),
            year: cells[3].textContent.trim(),
          })
        }
      },
    })

  await rewriter.transform(response).text()
  return rows
}
```

### 6.4 Scheduled Scraping (Cron Triggers)

```toml
# wrangler.toml
[triggers]
crons = ["0 */6 * * *"]   # Every 6 hours for US/EU trade data updates
```

```typescript
// src/cron/scrape.ts
export default {
  async scheduled(event, env, ctx) {
    const log = { source_url: '', status: 'started', started_at: new Date().toISOString() }

    try {
      // Scrape imports from EIDB portal
      const importResult = await scrapeEidbPortal(env)

      // Scrape exports from FTSPCC portal
      const exportResult = await scrapeFtspccPortal(env)

      // Bulk upsert into D1
      const db = env.DB
      await db.batch([
        ...buildUpsertStatements(importResult.items, 'import'),
        ...buildUpsertStatements(exportResult.items, 'export'),
      ])

      // Trigger AI insight generation
      await generateInsights(env, importResult, exportResult)

      log.status = 'success'
      log.items_count = importResult.count + exportResult.count
    } catch (err) {
      log.status = 'failed'
      log.error_msg = err.message
    }

    // Log scraping result
    await env.DB.prepare(
      'INSERT INTO scraping_log (source_url, status, items_count, error_msg, started_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('eidb+ftspcc', log.status, log.items_count, log.error_msg, log.started_at).run()
  },
}
```

### 6.5 Graceful Degradation

| Scenario | Behavior |
|----------|----------|
| TRADESTAT site down | Serve last known data from D1, log failure |
| Partial scrape (some rows fail) | Store successfully parsed rows, flag partial in log |
| First deploy (no data) | Seed D1 from built-in JSON seed data via migration |
| Rate-limited by TRADESTAT | Exponential backoff, skip cycle, log warning |

---

## 7. API Specification (Worker Endpoints)

### 7.1 Trade Data Endpoints

| Method | Endpoint | Description | Query Params |
|--------|----------|-------------|-------------|
| GET | `/api/trade/exports` | List exports | `country`, `product`, `category`, `limit`, `offset` |
| GET | `/api/trade/imports` | List imports | `country`, `product`, `category`, `limit`, `offset` |
| GET | `/api/trade/categories` | List categories | `type` (export/import), `limit` |
| GET | `/api/trade/categories/:hsCode` | Category detail | `type` |
| GET | `/api/trade/subcategories/:hs4Code` | Subcategory detail | `type` |
| GET | `/api/trade/countries` | List trade partner countries | — |
| GET | `/api/trade/categories/list` | Category code/name map | — |
| GET | `/api/trade/sources` | Source + last refresh info | — |
| POST | `/api/trade/refresh` | Trigger scrape + AI analysis | — |

### 7.2 AI Endpoints

| Method | Endpoint | Description | Query Params |
|--------|----------|-------------|-------------|
| GET | `/api/ai/insights/:scopeType/:scopeValue` | Get cached AI insight | `tradeType` |
| POST | `/api/ai/insights/:scopeType/:scopeValue/generate` | Generate fresh insight | — |
| GET | `/api/ai/summary` | Overall trade summary | — |
| GET | `/api/ai/trends` | Trend analysis (last 30 days) | — |
| POST | `/api/ai/search` | Semantic search | `query` (body) |

### 7.3 Response Models

```typescript
// Shared types
interface TradeItem {
  id: number
  productName: string
  category: string
  categoryCode: string
  type: 'export' | 'import'
  country: string
  countryCode: string
  demandLevel: 'Very High' | 'High' | 'Medium' | 'Low'
  tradeValueUsd: number
  volume: number | null
  rank: number
  estExportPriceUsd: number
  estShipmentCostUsd: number
  shipmentCostEstimated: boolean
  source: string
  sourceUrl: string
  lastUpdated: string
}

interface AIInsight {
  id: number
  insightType: 'trend' | 'summary' | 'recommendation' | 'anomaly'
  insightText: string
  confidence: number
  scopeType: string
  scopeValue: string
  generatedAt: string
}

interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}
```

---

## 8. Frontend Architecture (Cloudflare Pages)

### 8.1 Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | React 19 | UI components |
| **Build** | Vite | Fast bundler with HMR |
| **Styling** | Tailwind CSS 4 | Utility-first styling |
| **Routing** | React Router v7 | Client-side routing with loaders |
| **Data Fetching** | TanStack Query (React Query) | Caching, retries, optimistic updates |
| **Charts** | Recharts | Trade trend visualizations |
| **Deployment** | Cloudflare Pages | Static asset hosting + SSR |

### 8.2 Project Structure (Cloudflare)

```
/
├── frontend/
│   ├── src/
│   │   ├── main.tsx              — Vite entry point
│   │   ├── router.tsx            — React Router routes
│   │   ├── App.tsx               — Root layout
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx     — Home / overview
│   │   │   ├── CategoryPage.tsx  — Category detail
│   │   │   ├── SubcategoryPage.tsx — Subcategory detail
│   │   │   ├── InsightsPage.tsx  — AI insights hub
│   │   │   └── TrendsPage.tsx    — Trend visualization
│   │   ├── components/
│   │   │   ├── TradeTable.tsx    — Sortable virtual table
│   │   │   ├── SummaryCards.tsx  — KPI cards
│   │   │   ├── SearchBar.tsx     — Filter controls
│   │   │   ├── TrendChart.tsx    — Recharts line/bar charts
│   │   │   ├── InsightCard.tsx   — AI insight display
│   │   │   ├── Breadcrumb.tsx    — Nav breadcrumbs
│   │   │   └── Layout.tsx        — Header, nav, footer
│   │   ├── hooks/
│   │   │   ├── useTradeData.ts   — TanStack Query hooks
│   │   │   ├── useAIInsights.ts  — AI insight hooks
│   │   │   └── useDarkMode.ts    — Theme hook
│   │   ├── lib/
│   │   │   ├── api.ts            — API client (fetch)
│   │   │   └── utils.ts          — Helpers
│   │   └── types/
│   │       └── trade.ts          — TypeScript interfaces
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── package.json
├── worker/
│   ├── src/
│   │   ├── index.ts              — Hono app entry
│   │   ├── routes/
│   │   │   ├── trade.ts          — Trade data endpoints
│   │   │   ├── ai.ts             — AI insight endpoints
│   │   │   └── admin.ts          — Admin/refresh endpoints
│   │   ├── scrapers/
│   │   │   ├── eidb.ts           — EIDB portal scraper
│   │   │   ├── ftspcc.ts         — FTSPCC portal scraper
│   │   │   └── parser.ts         — HTMLRewriter selectors
│   │   ├── db/
│   │   │   ├── schema.ts         — D1 table schema
│   │   │   ├── trade.ts          — Trade item queries
│   │   │   └── insights.ts       — AI insight queries
│   │   ├── ai/
│   │   │   ├── prompts.ts        — Prompt templates
│   │   │   └── analysis.ts       — AI analysis logic
│   │   └── utils/
│   │       ├── demand.ts         — Demand level calculation
│   │       ├── shipment.ts       — Shipment cost estimation
│   │       └── validate.ts       — Data validation
│   ├── migrations/
│   │   └── 001_initial.sql       — D1 schema migration
│   ├── cron/
│   │   └── scrape.ts             — Scheduled scraping handler
│   ├── wrangler.toml
│   └── package.json
├── seed-data/
│   └── initial.json              — Fallback seed data for first deploy
├── vitest.config.ts
└── package.json
```

### 8.3 New Frontend Features

| Feature | Details |
|---------|---------|
| **AI Insights Panel** | Sidebar or card showing generated trade analysis per category/page |
| **Trend Charts** | Line charts showing trade value over months for selected categories |
| **Country Comparison** | Bar chart comparing export vs import values by country |
| **Natural Language Search** | "Which countries import the most pharmaceuticals?" → AI-powered semantic search |
| **Download Reports** | Export data as CSV or PDF summary |
| **Anomaly Alerts** | Visual flags on items with unusual trade patterns |
| **Executive Summary** | AI-generated dashboard overview with key numbers and trends |

---

## 9. Cloudflare Config (wrangler.toml)

```toml
name = "india-trade-explorer"
main = "src/index.ts"
compatibility_date = "2025-12-01"

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "india-trade-db"
database_id = "your-database-id"

# Workers AI
[ai]
binding = "AI"

# Environment variables
[vars]
TRADESTAT_BASE = "https://tradestat.commerce.gov.in"
SCRAPE_INTERVAL_HOURS = "6"
CACHE_TTL_SECONDS = "3600"

# Cron triggers
[triggers]
crons = ["0 */6 * * *"]  # Every 6 hours

# Pages integration
[env.production]
routes = [
  { pattern = "api.tradeexplorer.in/*", zone_id = "your-zone-id" }
]

# Assets (built React app)
[site]
bucket = "./frontend/dist"
```

---

## 10. Deployment Workflow

### 10.1 Initial Setup

```bash
# Login to Cloudflare
npx wrangler login

# Create D1 database
npx wrangler d1 create india-trade-db

# Apply initial schema
npx wrangler d1 execute india-trade-db --file=./worker/migrations/001_initial.sql

# Seed initial data
npx wrangler d1 execute india-trade-db --file=./seed-data/initial.sql

# Deploy worker
cd worker && npx wrangler deploy

# Deploy frontend to Pages
cd frontend && npx wrangler pages deploy dist/
```

### 10.2 CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy to Cloudflare
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci

      # Build frontend
      - run: cd frontend && npm run build

      # Deploy worker
      - name: Deploy Worker
        run: cd worker && npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}

      # Deploy frontend to Pages
      - name: Deploy Pages
        run: npx wrangler pages deploy frontend/dist --project-name=india-trade-explorer
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}

      # Apply DB migrations
      - name: Apply D1 Migrations
        run: npx wrangler d1 execute india-trade-db --file=./worker/migrations/$(ls -t worker/migrations/ | head -1)
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
```

---

## 11. Implementation Plan (Phased)

### Phase 1 — Foundation (Week 1-2)
- [ ] Set up Cloudflare Workers project with Hono
- [ ] Define D1 schema and apply migrations
- [ ] Implement scraper for TRADESTAT EIDB + FTSPCC using HTMLRewriter
- [ ] Scheduled cron scraping every 6 hours
- [ ] Serve trade data from D1 via Workers endpoints (GET /api/trade/*)
- [ ] Deploy React frontend to Cloudflare Pages

### Phase 2 — AI Layer (Week 3-4)
- [ ] Integrate Workers AI with LLaMA 3.2 model
- [ ] Implement category deep-dive insights
- [ ] Add trade trend analysis endpoint
- [ ] Build AI Insights UI panel with caching
- [ ] Add semantic search via text embeddings

### Phase 3 — Polish (Week 5-6)
- [ ] Trend charts (Recharts) on dashboard
- [ ] Anomaly detection via Mistral 7B
- [ ] CSV/PDF export
- [ ] Dark mode persistence
- [ ] Error boundaries and loading skeletons

### Phase 4 — Scale (Week 7-8)
- [ ] Rate limiting on Worker endpoints
- [ ] AI insight result caching (D1 + stale-while-revalidate)
- [ ] Historical data versioning
- [ ] PWA support (service worker)
- [ ] Monitoring with Cloudflare Analytics

---

## 12. Real-Time Data Scraping Details

### 12.1 Primary EIDB Scrape Target

**URL:** `https://tradestat.commerce.gov.in/eidb/commodity_wise_import`

The EIDB portal provides:
- Commodity-wise import data in HTML tables
- Filters for year, commodity group, country
- Data presented in tabular format with HSCode, Commodity, Country, Value

### 12.2 Secondary FTSPCC Scrape Targets

- **Exports:** `https://tradestat.commerce.gov.in/ftspcc/export_commodity_xcountry_wise_monthly`
- **Imports:** `https://tradestat.commerce.gov.in/ftspcc/import_commodity_xcountry_wise_monthly`

### 12.3 Scraping Strategy

| Consideration | Approach |
|--------------|----------|
| **Rate Limiting** | 1 request per 3 seconds across commodities; 6-hour interval |
| **IP Blocking** | Cloudflare Workers egress IPs change frequently; acceptable for low-frequency |
| **HTML Changes** | If table structure changes, scraper falls back to regex-based fallback parser |
| **Data Freshness** | TRADESTAT data is typically 1-2 months behind; scrape label tracks `data_year` + `data_month` |
| **Error Recovery** | On parse failure, serve last known D1 data and alert via logging |
| **First Deploy** | Seed D1 from embedded JSON seed data (same as current `seed_data.py`) |

### 12.4 HTMLRewriter Selector Strategy

```typescript
// Multi-strategy parser in case site structure changes
const STRATEGIES = [
  // Strategy 1: Standard wp-block-table
  (el: Element) => el.matches('table.wp-block-table'),
  // Strategy 2: Generic table with commodity columns
  (el: Element) => el.querySelector('th')?.textContent.includes('Commodity'),
  // Strategy 3: Fallback to any table with enough rows
  (el: Element) => el.querySelectorAll('tr').length > 5,
]

// Try strategies in order until one works
for (const strategy of STRATEGIES) {
  const rows = await tryScrape(url, strategy)
  if (rows.length > 0) return rows
}
```

---

## 13. Seed Data Migration

For the initial D1 seed, the current backend `seed_data.py` is converted to SQL:

```sql
-- Seed categories
INSERT OR IGNORE INTO categories (hs_code, name) VALUES
  ('10', 'Agricultural Products'),
  ('27', 'Mineral Fuels & Oils'),
  ('30', 'Pharmaceuticals'),
  ('71', 'Gems & Jewelry'),
  ('84', 'Machinery & Equipment'),
  ('85', 'Electronics & Telecom');

-- Seed countries
INSERT OR IGNORE INTO countries (code, name, region) VALUES
  ('US', 'USA', 'americas_other'),
  ('CN', 'China', 'asia'),
  ('AE', 'UAE', 'asia'),
  ('BD', 'Bangladesh', 'neighbor'),
  ('DE', 'Germany', 'europe_africa');

-- Seed initial trade items (transformed from seed_data.py)
INSERT INTO trade_items (product_name, category_code, trade_type, country_code, trade_value_usd, volume, demand_level)
VALUES
  ('Petroleum Products - Refined Diesel', '27', 'export', 'NL', 4200.0, 84000, 'Very High'),
  ('Cut & Polished Diamonds', '71', 'export', 'US', 6200.0, 310, 'Very High'),
  ('Drug Formulations - Antibiotics', '30', 'export', 'US', 3200.0, 6400, 'High');
```

---

## 14. AI Prompt Templates

### 14.1 Category Overview Prompt

```
You are a trade analyst for the Government of India.
Analyze the {trade_type} data for HS code {hs_code} ({category_name}):

Total trade value: ${total_value}M
Top partner countries: {top_countries}
Trend direction: {trend} (up/down/stable compared to previous period)
Top product variants: {products}

Provide a concise 3-sentence analysis covering:
1. The significance of this category in India's trade portfolio
2. Key geographic dependencies or diversifications
3. One actionable insight for policymakers or traders
```

### 14.2 Executive Summary Prompt

```
Summarize India's latest trade data across all categories:

Exports total: ${exports_total}M across {export_count} items
Imports total: ${imports_total}M across {import_count} items
Trade balance: ${trade_balance}M (surplus/deficit)

Top 5 export categories: {top_export_categories}
Top 5 import categories: {top_import_categories}
Largest trade partners: {top_partners}

Provide a brief executive summary (4-5 sentences) highlighting:
1. Overall trade health
2. Most notable changes
3. Sector-specific observations
4. Risk factors or opportunities
```

### 14.3 Anomaly Detection Prompt

```
Review this batch of India trade data points for anomalies:

{data_points}

Flag any unusual patterns such as:
- Sudden spikes or drops in trade value with a specific country
- Unusual product-country combinations that don't fit historical patterns
- Categories with unexpected high or low demand levels

For each anomaly, explain in one sentence why it might be significant.
```

---

## 15. Performance & Cost Estimates (Cloudflare Free Tier)

| Resource | Free Tier Limit | Expected Usage | Notes |
|----------|----------------|----------------|-------|
| **Workers** | 100k requests/day | ~5k/day (100 users × 50 API calls) | Well within free tier |
| **Workers AI** | 10k neurons/day | ~500/day | Caching reduces calls by 80% |
| **D1** | 5GB storage, 5M read rows/day | ~50MB storage, ~100k reads/day | Easily within limits |
| **Cron Triggers** | 5 schedules | 1 schedule (6-hourly) | Free |
| **Pages** | Unlimited static assets | ~2MB build | Free |
| **KV (optional)** | 1GB storage, 1M reads/day | For session/token cache | Not needed initially |

**Estimated monthly cost at scale (1000 users):** $5-15/month (mostly Workers AI usage)

---

## 16. Security Considerations

- **CORS:** Restrict to known origins (Cloudflare Pages domain)
- **D1 Access:** Only accessible from Workers, never exposed directly
- **AI Content:** All user-facing AI output includes confidence score and disclaimer
- **Rate Limiting:** Workers add `Rate-Limit` headers; 100 req/min per IP on AI endpoints
- **Data Source Attribution:** All displayed data links back to TRADESTAT
- **Scraping:** Respect `robots.txt`; `User-Agent` identifies the application

---

## 17. Non-Functional Requirements

- **Performance:** Most API responses < 50ms (D1 edge reads); AI responses < 2s
- **Availability:** Cloudflare SLA (99.99% Workers uptime)
- **Caching:** TanStack Query + D1 for database-level caching; KV for AI insight cache
- **Error Handling:** Graceful degrade to seed data if TRADESTAT fetch fails
- **Responsive:** Mobile-first design with virtual tables for large datasets
- **Accessibility:** Dark mode, keyboard navigation, ARIA labels, focus management

---

## 18. Comparison: Current (Python FastAPI) vs Target (Cloudflare Workers)

| Aspect | Current | Target |
|--------|---------|--------|
| **Runtime** | Python + Uvicorn | Cloudflare Workers (V8 Isolates) |
| **Database** | JSON file cache | D1 (SQLite on edge) |
| **AI** | None | Workers AI (LLaMA, Mistral) |
| **Scraping** | httpx + BeautifulSoup | HTMLRewriter (Worker-native) |
| **Scheduling** | Manual via API | Cron Triggers (automated) |
| **Deployment** | Manual server setup | `wrangler deploy` (one command) |
| **Scaling** | Single server | Auto-scaling across 330+ locations |
| **Cost** | VPS ($5-20/mo) | Mostly free tier (100k req/day) |
| **Latency** | 100-300ms (server location dependent) | <50ms global |
| **Frontend Server** | Bun serve (Node) | Cloudflare Pages (CDN) |
