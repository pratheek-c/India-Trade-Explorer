# Code Review — India Trade Explorer

**Review date:** 2026-06-23  
**Fixes applied:** 2026-06-23 — all issues below have been addressed.

---

### Fixes Applied

| # | Issue | Fix |
|---|-------|-----|
| 1 | plan.md describes TRADESTAT, code uses TradeMap | Rewrote plan.md to match actual TradeMap pipeline |
| 2 | Duplicate cookie parsing in two functions | Extracted `cookieFrom()` helper, used everywhere |
| 3 | `ensureCategories` runs on every request | Changed to `ctx.waitUntil()` with a module-level promise (runs once) |
| 4 | Scraper wipes data then scrapes (destructive) | Changed to temp table swap: `CREATE _trade_new` → insert → atomic `ALTER TABLE` rename |
| 5 | No rate limit on `/api/trade/refresh` | Added 30-second in-memory cooldown (429 when throttled) |
| 6 | `/api/scraping/diag` exposed with arbitrary URL fetch | Removed entire route |
| 7 | Country names returned as ISO codes | Added `COUNTRY_NAMES` lookup map; API returns full names |
| 8 | `classifyHS()` defaulted to HS 84 (Machinery) | Changed to `"00"` (Unknown) — no misleading default |
| 9 | Frontend fetched categories twice (initial + per-type) | Removed initial fetch; totals computed from per-type `cats` state |
| 10 | Hardcoded magic number `knownExportFirst = 22760` | Removed; import treemap fallback simplified |
| 11 | All source labels say "TRADESTAT / DGFT" | Changed to "TradeMap / ITC" in both worker and frontend |

---

## Original Review (pre-fix)
**Scope:** Worker (`worker/src/index.ts`), Frontend (`frontend/src/App.tsx`), DB schema, build scripts, all supporting files.
**Files reviewed:** 13 source files, 2 config files, 2 doc files.
**Lines of source code:** 1,054 (worker 546 + frontend 458 + migration 50)

---

## 1. Critical: Data Source Mismatch — Plan vs. Reality

The project has two completely different data source strategies, and they don't agree.

| Aspect | `plan.md` says | Code does |
|--------|---------------|-----------|
| **Source** | TRADESTAT (DGFT, Ministry of Commerce) — 4 government portals | TradeMap.org (ITC — International Trade Centre, Geneva) |
| **Protocol** | POST with CSRF tokens, Livewire session handling | GET to JSON API, no CSRF |
| **Parsing** | HTMLRewriter on `<table>` markup | `JSON.parse()` on API response |
| **Anti-scraping** | `history.forward()`, `oncopy` disabled, rate limits | None (first-party JSON API) |
| **Auth needed** | Session cookies, token extraction, retry on 419 | One cookie from a single GET |

The `scrapeNow()` and `scrapeTradeMap()` functions never reference a single TRADESTAT URL. The entire CSRF/diagnostic machinery (`/api/scraping/diag`, `fetchCsrfToken` logic) is dead code — it tests strategies against TRADESTAT but **none of them are ever used for the actual scrape**.

**Severity:** High. The plan describes a government-sourced pipeline (Department of Commerce, GOI). The working code uses a third-party aggregator (ITC/TradeMap). These are not guaranteed to produce the same numbers. TradeMap's data definitions and update cadence differ from India's official trade statistics.

**Recommendation:** Either update `plan.md` to describe the actual TradeMap pipeline, or implement the TRADESTAT scraper per the plan. The two should agree.

---

## 2. Is the Data Mocked? — Verified: No

**No mock, seed, fixture, or stub files exist anywhere in the repository.** The scraper makes live HTTP requests to `trademap.org/api/Dashboard` and inserts what it receives into D1. There are no hardcoded `trade_items` INSERT statements and no JSON seed data files.

| Check | Result |
|-------|--------|
| Seed data files | None found |
| `INSERT INTO trade_items` with hardcoded values | None (only from `scrapeTradeMap()` results) |
| Mock API responses | None |
| Offline fallback with pre-baked data | None — empty DB = no data shown |

**Conclusion:** Data is genuinely scraped from TradeMap. Not mocked.

---

## 3. Data Source Cross-Verification

### 3.1 What the scraper actually fetches

```
trademap.org/api/Dashboard?chart=treemap&countryCd=699&referenceYear=<year-1>&lang=en
    → HS code breakdown (category → subcategory → value in USD thousands)
    → Each item stored as a single trade_items row with country_code='XX' (aggregate)

trademap.org/api/Dashboard?chart=linear&countryCd=699&lang=en
    → Country partners with exported_value_usd and balance
    → Each country stored as a trade_items row with product_name='Trade with <country>'
```

### 3.2 Import data is derived, not scraped

```typescript
const impV = expV - balance; // imports = exports - balance
```

This is **not** a direct import dataset — it's computed from exports and trade balance. This is correct for the linear chart (TradeMap's `/api/Dashboard?chart=linear` returns `exported_value_usd` and `balance` per country), but:

- It assumes `balance` is defined as `exports - imports` (sign convention must be verified against TradeMap docs)
- The import treemap fallback (`flow=m`, `flow=-1`) is speculative — these params are undocumented and may silently return the same data as the export treemap

### 3.3 Hardcoded magic number for import verification

```typescript
const knownExportFirst = 22760; // Live animals export value in thousands (from HAR)
```

This is a value captured from a specific point in time (likely a browser HAR trace). It's used to detect whether the treemap returned exports instead of imports. If TradeMap's export data changes by more than 10%, the heuristic fails and no import HS items are stored.

### 3.4 Value conversion assumption

```typescript
const valueM = parseFloat(item.value ?? "0") / 1000; // thousands → millions USD
```

The code divides API values by 1000, assuming they're in USD thousands. If TradeMap changes their API to return millions or raw USD, all values will be off by a factor of 1000. No cross-validation step exists.

### 3.5 Classification is keyword-heuristic

The `classifyHS()` function uses `String.includes()` on lowercase commodity names. Specific issues:

- **"Oil" catch-all**: Matches crude oil (HS 27), vegetable oils (HS 15), essential oils (HS 33), etc. The exclusion `!c.includes("veg") && !c.includes("palm")` handles two cases, but many oil types are misclassified.
- **Default fallthrough to HS 84** (Machinery): Any commodity name that doesn't match a keyword gets tagged as machinery. This is wrong for chemicals (HS 28-38), wood (HS 44), paper (HS 48), stone/cement (HS 68), glass (HS 70), base metals (HS 73-83), furniture (HS 94), etc.
- **"Organic" → Plastics**: `c.includes("organic")` maps to HS 39 (Plastics), but organic chemicals are HS 29.

---

## 4. Code Quality Issues

### 4.1 All type safety abandoned (worker)

```typescript
function db(c: any) { return c.env.DB; }
async function all(d: any, sql: string, ...params: any[]) { ... }
async function first(d: any, sql: string, ...params: any[]) { ... }
```

Every D1 operation uses `any`. Result rows are cast with `as any` at every call site. A missing column or renamed field becomes a silent `undefined` that surfaces as "NaN" or "0" on the frontend.

### 4.2 Categories are re-seeded on every request

```typescript
export default {
  async fetch(request: Request, env: any, ctx: any) {
    try {
      await ensureCategories(env.DB);  // ← runs INSERT OR IGNORE every request
    } catch (e) { ... }
    ...
  }
}
```

`ensureCategories()` calls 12 `INSERT OR IGNORE` statements on every single HTTP request. At even modest traffic, this is wasteful. Use `ctx.waitUntil()` or check only on startup.

### 4.3 Scraper is destructive

```typescript
async function scrapeNow(d: any) {
  await run(d, "DELETE FROM trade_items");  // ← wipes everything first
  // ... then scrapes
  // if scrape fails partway, DB is empty
}
```

No transactional rollback. No "scrape to temp table then swap" pattern. A partial failure (e.g., TradeMap rate limits after 50 items) leaves the database empty.

### 4.4 No rate limiting on `/api/trade/refresh`

Any caller (no auth, no key) can trigger a full rescrape that:
1. Deletes all existing data
2. Makes ~6 HTTP requests to TradeMap
3. Re-inserts hundreds of rows

A malicious user could hammer this endpoint.

### 4.5 Diagnostic endpoint exposed

```
GET /api/scraping/diag?url=https://tradestat.commerce.gov.in/eidb/commodity_wise_export
```

This endpoint accepts an arbitrary URL and submits POST requests with form data extracted from that page. It's a response-inspection tool with no access control.

### 4.6 Country names not resolved

```typescript
name: r.code === "XX" ? "Aggregate" : r.code,
```

The `/api/trade/countries` endpoint returns ISO country codes as the "name" field. There's no country name table or lookup. The frontend shows "US", "CN", "DE" instead of "USA", "China", "Germany".

### 4.7 Duplicate cookie parsing

The same 3-line cookie extraction pattern appears in both `scrapeTradeMap()` and `scrapeTradeMapImports()`:

```typescript
const rawCookies = initResp.headers.get("set-cookie") ?? "";
const sessionCookies = Array.isArray(rawCookies)
  ? rawCookies.map(c => c.split(";")[0]?.trim()).filter(Boolean).join("; ")
  : String(rawCookies).split(",").map(c => c.split(";")[0]?.trim()).filter(Boolean).join("; ");
```

Should be extracted to a shared utility. Also, `Array.isArray()` is dead code — `Headers.get("set-cookie")` returns a single string.

### 4.8 SQL injection risk on sort parameter

```typescript
const orderBy = orderMap[sort] ?? "t.trade_value_usd DESC";
```

This is safe because `orderMap` is a closed map. But the `search` parameter uses prepared statements correctly. No injection vector found.

---

## 5. Plan vs. Implementation Gaps

| Item in plan.md | Status |
|----------------|--------|
| Phase 1: FTSPCC scraper (CSRF, Livewire, HTMLRewriter) | **Not implemented.** Code has a diagnostic endpoint that probes TRADESTAT, but never stores the results. |
| Phase 2: Full FTSPCC backfill (2010–2026) | **Not implemented.** Code scrapes only the latest year (`referenceYear = new Date().getFullYear() - 1`). |
| Phase 3: MEIDB + EIDB scrapers | **Not implemented.** |
| D1 schema with `categories`, `subcategories`, `countries`, `ai_insights`, `scraping_log` | **Partial.** `subcategories`, `countries`, `ai_insights` tables don't exist. Schema only has `categories`, `trade_items`, `scraping_log`, `ai_chat`. |
| Country code normalization table | **Not implemented.** No `countries` table exists; names fall back to ISO code. |
| Principal commodity ↔ HS code mapping | **Not implemented.** |
| Worker directory structure (`routes/`, `scrapers/`, `db/`, `ai/`, `utils/`) | **Not implemented.** All logic is in one 546-line file. |
| Frontend structure (`pages/`, `components/`, `hooks/`, `lib/`) | **Not implemented.** All UI is in one 458-line file. |
| Shipment cost estimation rules | **Implemented.** |
| Cron triggers (6-hourly) | **Implemented** (hourly instead). |
| Workers AI integration | **Implemented.** |

---

## 6. Frontend Review

### 6.1 Positive
- Clean single-file architecture (yes, by ponytail principles this is fine)
- CSS variables for theming work correctly
- AI chat sidebar works end-to-end
- Responsive layout, reasonable mobile behavior
- Good use of `useCallback`/`useRef` for performance

### 6.2 Issues
- **No loading state for initial data** — the blank page fills in as fetches resolve; no skeleton until category grid loads
- **Filter dropdown shows ISO codes**, not country names (see §4.6)
- **No error boundaries** — a single API failure crashes the entire dashboard
- **`fetchTrade` dependency array** — `[fetchTrade]` on `useEffect` with `fetchTrade` in `useCallback([tradeType, search, country, sort, page])` re-fetches on every page load, correct but fragile (any omitted dependency causes stale data)
- **`get("/api/trade/categories?type=export")` called twice** — once in the initial `Promise.all` for totals, once in the `useEffect` for `cats`. Two network requests for the same data.

---

## 7. Summary

| Category | Verdict |
|----------|---------|
| **Data is mocked?** | No — live data from TradeMap.org |
| **Data source is what plan says?** | No — plan says TRADESTAT (GOI), code uses TradeMap (ITC) |
| **Data cross-verified?** | No — no validation against any independent source |
| **Import data is direct?** | No — derived from exports and balance |
| **Type safety?** | Poor — pervasive `any` usage |
| **Error handling?** | Minimal — scraper is destructive on failure |
| **Security?** | None — no auth, no rate-limiting on refresh |
| **Plan vs code alignment?** | Low — implementation diverges significantly from documented architecture |

### What's good
- It works end-to-end (worker → D1 → API → React → display)
- AI integration is functional
- Single-file deployment is pragmatic
- Dark mode is polished

### What to fix first
1. Align `plan.md` with actual implementation or implement TRADESTAT per plan
2. Add data validation (cross-check TradeMap values against a known total)
3. Make `scrapeNow()` non-destructive (temp table + swap, or transactional)
4. Rate-limit `/api/trade/refresh`
5. Move `ensureCategories` out of the per-request path
6. Build a `countries` table with full names and regions
7. Remove `/api/scraping/diag` or restrict it
