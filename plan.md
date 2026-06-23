# Trade Data Extraction Plan — TradeMap.org API

## Overview

This document describes the data extraction pipeline for the India Trade Explorer dashboard. Trade data is sourced from **TradeMap.org** (International Trade Centre / ITC, Geneva) via their public JSON API. TradeMap aggregates global trade statistics from national customs authorities including DGFT / Ministry of Commerce, Government of India.

**Status: Implemented** — the scraper is live in `worker/src/index.ts` as a single-file Cloudflare Workers cron job.

---

## 1. Data Source

### TradeMap.org API

| Detail | Value |
|--------|-------|
| **Source** | TradeMap (ITC) — `https://www.trademap.org` |
| **Data coverage** | India's trade with all partner countries, latest calendar year |
| **Protocol** | JSON API (`/api/Dashboard?chart=...`) — no CSRF, no HTML parsing |
| **Update cadence** | ITC updates monthly (customs data lag ~2-3 months) |
| **Auth needed** | Session cookie from a single GET to the embedded dashboard |
| **Rate limits** | None observed; scraper runs hourly via Cron Triggers |

### Why TradeMap over TRADESTAT

| Factor | TradeMap | TRADESTAT (DGFT) |
|--------|----------|-----------------|
| **API format** | Clean JSON | HTML forms + CSRF + Livewire |
| **Data granularity** | HS code tree + country partners | HS-code, principal commodity, country × month |
| **Historical depth** | Latest year | 2010–2026 monthly |
| **Scraping complexity** | Low (2 GET requests) | High (POST with tokens, session mgmt, HTML parsing) |
| **Deployment** | Workers `fetch()` + `JSON.parse()` | Would need HTMLRewriter + retry logic |

**Trade-off:** TradeMap is simpler and sufficient for current scope. If historical monthly data or HS-code-level granularity is needed, TRADESTAT scraping should be added (see §10).

---

## 2. API Endpoints Used

### 2.1 Treemap — HS Code Breakdown

```
GET /api/Dashboard?chart=treemap&countryCd=699&referenceYear={year}&lang=en
```

Returns a nested JSON tree:
```json
{
  "children": [
    {
      "name": "Mineral fuels, oils",
      "code": "27",
      "children": [
        { "name": "Petroleum oils, crude", "code": "2709", "value": "152340" },
        ...
      ]
    }
  ]
}
```

- `countryCd=699` — India's ITC country code
- `value` — trade value in **USD thousands** (divided by 1000 → USD millions)
- Each leaf item is stored as a row in `trade_items` with `country_code='XX'` (aggregate)

### 2.2 Linear — Country Partners

```
GET /api/Dashboard?chart=linear&countryCd=699&lang=en
```

Returns:
```json
{
  "countries": [
    {
      "code": "US",
      "name": "United States of America",
      "exported_value_usd": "76543210",
      "balance": "12345678"
    }
  ]
}
```

- `exported_value_usd` — exports in USD
- `balance` — trade balance (exports − imports)
- **Imports are derived:** `imports = exports − balance`
- Each country is stored as a row with `product_name = 'Trade with {name}'` or `'Imports from {name}'`

---

## 3. Extraction Pipeline

```
┌───────────────────────────────────────────────────┐
│  TradeMap.org JSON API                              │
│                                                     │
│  GET /api/Dashboard?chart=treemap   ─── HS tree    │
│  GET /api/Dashboard?chart=linear    ─── Countries  │
└───────────────────────┬───────────────────────────┘
                        ▼
┌───────────────────────────────────────────────────┐
│  Worker Scraper (scrapeNow)                        │
│                                                     │
│  1. GET session cookie from Dashboard.aspx         │
│  2. Fetch treemap → parse HS items                 │
│  3. Fetch linear → parse country partners          │
│  4. Derive imports (exports − balance)            │
└──────────────┬────────────────────────────────────┘
               ▼
┌───────────────────────────────────────────────────┐
│  Temp table swap (non-destructive)                 │
│                                                     │
│  CREATE _trade_new → INSERT INTO _trade_new        │
│  → ALTER TABLE trade_items RENAME TO _trade_old    │
│  → ALTER TABLE _trade_new RENAME TO trade_items    │
│  → DROP _trade_old                                  │
│  (If scrape fails, _trade_new is dropped, old data │
│   survives)                                        │
└──────────────┬────────────────────────────────────┘
               ▼
┌───────────────────────────────────────────────────┐
│  D1 Database                                       │
│  trade_items table → API → Frontend               │
└───────────────────────────────────────────────────┘
```

### Scraper Flow

```typescript
async function scrapeNow(d) {
  // 1. Create temp table with same schema
  CREATE TABLE _trade_new (...)

  // 2. Scrape into temp table
  scrapeTradeMap(d, "_trade_new", "export")       // HS items + country exports
  scrapeTradeMapImports(d, "_trade_new")           // country imports + HS imports

  // 3. If anything was scraped, atomically swap tables
  if (total > 0) {
    DROP _trade_old
    ALTER TABLE trade_items RENAME TO _trade_old
    ALTER TABLE _trade_new RENAME TO trade_items
    DROP _trade_old
  }
}
```

---

## 4. Data Classification (HS Code → Category)

TradeMap HS codes are classified into 12 standard categories via keyword matching on the commodity name:

| HS | Category | Keywords |
|----|----------|----------|
| 10 | Agricultural Products | rice, wheat, spice, cereal, grain, fruit, vegetable, meat, sugar, tea, coffee |
| 15 | Vegetable Oils | veg, palm, sunflower, soy, castor |
| 27 | Mineral Fuels & Oils | petrol, fuel, crude, oil (excl. veg/palm), lng, lpg |
| 30 | Pharmaceuticals | drug, pharma, medic, vaccin, surg |
| 39 | Plastics & Chemicals | plastic, polymer, chemical, organic, dye |
| 61 | Textiles & Apparel | textile, cotton, apparel, garment, knit, cloth |
| 71 | Gems & Jewelry | diamond, gold, jewel, gem, prec, silver |
| 72 | Iron & Steel | steel, iron, metal, ore |
| 84 | Machinery & Equipment | machin, boiler, engine, equipment, pump, turbine |
| 85 | Electronics & Telecom | electron, telecom, phone, circuit, solar, semicon |
| 87 | Transport Equipment | auto, vehicle, car, motor, tractor |
| 95 | Toys & Sports | toy, sport, game, cricket |
| 00 | Unknown | (no keyword match — safe fallback, not misleading) |

**Limitation:** Keyword-based classification is heuristic. Items that don't match any keyword fall to code `00` (Unknown) instead of being silently miscategorized.

---

## 5. Database Schema

### 5.1 Table: `categories`

```sql
CREATE TABLE categories (
  hs_code      TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT
);
```

12 categories seeded via `INSERT OR IGNORE` on first worker startup (fire-and-forget via `ctx.waitUntil`, not per-request).

### 5.2 Table: `trade_items`

```sql
CREATE TABLE trade_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  product_name      TEXT NOT NULL,
  category_code     TEXT NOT NULL,
  trade_type        TEXT NOT NULL CHECK(trade_type IN ('export','import')),
  country_code      TEXT NOT NULL,
  trade_value_usd   REAL NOT NULL,
  volume            REAL,
  unit              TEXT DEFAULT 'units',
  demand_level      TEXT,
  source            TEXT DEFAULT 'TradeMap',
  source_url        TEXT,
  scraped_at        TEXT DEFAULT (datetime('now'))
);
```

**Note:** `subcategories`, `countries`, and `ai_insights` tables (from requirements.md) are not yet created. Country names are resolved in-memory via a `COUNTRY_NAMES` lookup map in the worker.

### 5.3 Table: `scraping_log`

```sql
CREATE TABLE scraping_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT,
  status      TEXT CHECK(status IN ('success','partial','failed')),
  items_count INTEGER,
  error_msg   TEXT,
  started_at  TEXT,
  finished_at TEXT DEFAULT (datetime('now'))
);
```

### 5.4 Table: `ai_chat`

```sql
CREATE TABLE ai_chat (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT,
  content    TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## 6. Scraping Schedule

```toml
[triggers]
crons = ["0 * * * *"]   # Every hour
```

| Trigger | Action | What it does |
|---------|--------|-------------|
| **Cron (hourly)** | Run `scrapeNow(env.DB)` | Fetch latest TradeMap data, swap into production table |
| **POST /api/trade/refresh** | Manual trigger | Same as cron, but throttled (30s cooldown) to prevent abuse |

The hourly cron ensures data is fresh within 1 hour of TradeMap updates. No historical backfill needed — we always show the latest year's data.

### Error Recovery

- **Temp table swap:** If the scrape fails partway, `_trade_new` is dropped and old `trade_items` is untouched
- **Rate limiting:** `/api/trade/refresh` has a simple in-memory 30-second cooldown (resets on cold start)
- **Logging:** Every scrape attempt is logged to `scraping_log` with status, item count, and error message

---

## 7. Country Name Resolution

Country names come from two sources:

1. **TradeMap API** — the linear chart returns `c.name` (e.g., "United States of America")
2. **Hardcoded map** — `COUNTRY_NAMES` in `worker/src/index.ts` maps ISO codes (e.g., `US` → `"USA"`) for display in API responses and the frontend filter dropdown

The `/api/trade/countries` endpoint returns the resolved name. The frontend filter dropdown shows proper names (not ISO codes).

---

## 8. Data Derivation

### Imports

Since TradeMap's treemap endpoint only returns exports by default (the `flow` parameter is undocumented and unreliable), imports are derived:

```
imports = exports − balance
```

Where `balance` is the trade balance from the linear chart (`exported_value_usd - imported_value_usd`). This gives country-level import values.

### Demand Level

Computed client-side from trade value (USD millions):

| Value | Demand Level |
|-------|-------------|
| > $10,000M | Very High |
| > $3,000M | High |
| > $500M | Medium |
| ≤ $500M | Low |

### Shipment Cost

Estimated per region as a percentage of trade value:

| Region | Rate | Countries |
|--------|------|-----------|
| Neighbor | 6% | BD, NP, LK, PK, BT, MM |
| Asia | 9% | CN, AE, SA, SG, JP, KR, ... |
| Europe/Africa | 13% | DE, GB, FR, NL, ZA, RU, ... |
| Americas | 16% | US, BR, CA, MX |

---

## 9. Project Structure

```
worker/
├── src/
│   └── index.ts              — Hono app + all routes + scraper + classification (single file)
├── migrations/
│   └── 001_init.sql          — D1 schema + category seeds
├── public/                   — Built frontend (static assets)
├── wrangler.toml             — Cloudflare config (cron, D1, AI bindings)
└── package.json

frontend/
├── src/
│   ├── App.tsx               — Single-file React dashboard
│   ├── index.tsx             — React entry point
│   ├── index.css             — Tailwind + CSS variables
│   └── index.html            — HTML shell
├── build.ts                  — Bun build script
└── package.json
```

All worker logic (routes, scraper, classification, country names) is in one 546-line file. This is intentional — the project is small enough that premature modularization adds overhead without benefit.

---

## 10. Future Work (Not Implemented)

| Feature | Why deferred |
|---------|-------------|
| **TRADESTAT portal scraping** (FTSPCC, MEIDB, EIDB, FTPA) | TradeMap covers current needs; TRADESTAT adds historical monthly data and HS-code × country granularity. Add when TradeMap is insufficient. |
| **`subcategories` table** | Not needed until we display HS4 drill-down |
| **`countries` table** | 50-country `COUNTRY_NAMES` map suffices for now |
| **`ai_insights` table with caching** | Insights are computed on-the-fly from SQL queries; cache if AI usage grows |
| **Principal commodity ↔ HS code mapping** | Only needed for TRADESTAT FTSPCC data |
| **Data validation (cross-portal)** | Only applicable when >1 data source exists |
| **Frontend modularization** (pages/, components/, hooks/) | Single file is fine at current size (458 lines) |

---

## 11. Key URLs Reference

### API Endpoints (Worker)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trade/exports` | Export items (paginated, filterable) |
| GET | `/api/trade/imports` | Import items (paginated, filterable) |
| GET | `/api/trade/categories` | HS category summary by trade type |
| GET | `/api/trade/countries` | Country partner breakdown |
| GET | `/api/trade/sources` | Data source + last updated |
| POST | `/api/trade/refresh` | Trigger scrape (30s throttle) |
| GET | `/api/ai/summary` | Auto-generated trade summary |
| POST | `/api/ai/chat` | Conversational AI analyst |
| GET | `/api/ping` | Health check |
| GET | `/api/scraping/log` | Recent scrape runs (last 20) |

### External Data Source

| Endpoint | Purpose |
|----------|---------|
| `https://www.trademap.org/embedded_india-tradeconnect/Dashboard.aspx` | Session init (sets cookie) |
| `https://www.trademap.org/api/Dashboard?chart=treemap&countryCd=699&referenceYear=...` | HS code breakdown |
| `https://www.trademap.org/api/Dashboard?chart=linear&countryCd=699` | Country partner exports + balance |
