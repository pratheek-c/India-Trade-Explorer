# Trade Data Extraction Plan — TRADESTAT Portals

## Overview

This document analyses 4 TRADESTAT portals and defines the extraction strategy to build a comprehensive India trade database. All portals are operated by the **Department of Commerce, Ministry of Commerce and Industry, Government of India**.

---

## 1. Portal Inventory

| # | Portal | URL | Data Span | Update Freq | Tech |
|---|--------|-----|-----------|-------------|------|
| 1 | **EIDB** (Export Import Data Bank) | `/eidb/commodity_wise_export` | 2017-2018 to 2025-2026 (yearly) | Monthly | Laravel + jQuery |
| 2 | **MEIDB** (Monthly EIDB) | `/meidb/commoditywise_export` | Jan 2018 – Apr 2026 (monthly) | Monthly | Laravel + jQuery |
| 3 | **FTPA** (Foreign Trade Performance Analysis) | `/ftpa/export_commodity_group_new` | Jan 2010 – Apr 2026 | Monthly | Laravel + Livewire |
| 4 | **FTSPCC** (Foreign Trade Statistics — Principal Commodities & Countries) | `/ftspcc/export_commodity_wise` | Jan 2010 – Apr 2026 | Monthly | Laravel + Livewire |

### 1.1 Why 4 Portals?

Each portal serves a different data granularity:

| Portal | Granularity | Use Case |
|--------|------------|----------|
| **EIDB** | HS-code level, yearly aggregate | Long-term trend analysis by HS code |
| **MEIDB** | HS-code level, monthly | Month-over-month and short-term trends |
| **FTPA** | Commodity group level, monthly | High-level trade performance analysis |
| **FTSPCC** | Principal commodity × country, monthly | Country-level trade flow analysis |

→ Strategy: Scrape **FTSPCC** for the richest dataset (commodity × country × month), and cross-reference with **MEIDB** for HS-code granularity.

---

## 2. Portal Deep-Dive

### 2.1 EIDB — Export Import Data Bank

**URL:** `https://tradestat.commerce.gov.in/eidb/commodity_wise_export`
**Imports:** `https://tradestat.commerce.gov.in/eidb/commodity_wise_import`

**Metadata:**
- Data available: 2017-2018 to 2025-2026 (Indian fiscal years — April to March)
- Last updated: **19/05/2026**
- Anti-scraping: `history.forward()` traps, `ondrag`, `oncopy` disabled — but no CAPTCHA

**Form Parameters (POST to same URL):**

| Field | Type | Values |
|-------|------|--------|
| `_token` | hidden | CSRF token (extract from HTML) |
| `comType` | radio | `all` / `specific` |
| `commodityType` | radio | `specific` (when comType=specific) |
| `EidbComLevelCwe` | select | Commodity level |
| `EidbYearCwe` | select | Year range (e.g., 2025-2026) |
| `Eidb_ReportCwe` | select | Report type (see below) |
| `Eidb_hscodeCwe` | text | HS code search |
| `hscode_value` | text | Specific HS code |
| `description_value` | text | Commodity description |

**Available Reports (dropdown):**
1. Commodity-wise *(default)*
2. Chapter-wise all commodities
3. Commodity-wise all Countries
4. Commodity x Country-wise
5. Country-wise
6. Country-wise all Commodities
7. Region-wise
8. Region-wise all Countries
9. Region-wise all Commodities
10. Predefined Group of Countries
11. Customised Group of Countries

**Output Format:** HTML `<table class="table table-bordered">` with columns: HSCode, Commodity, Country (varies by report), Value (USD Million), Volume, Unit.

**Critical Note:** EIDB data is **yearly aggregate** (Indian fiscal year Apr–Mar). The year dropdown selects a range like `2025-2026`. This is the simplest portal but least granular.

---

### 2.2 MEIDB — Monthly Export Import Data Bank

**URL:** `https://tradestat.commerce.gov.in/meidb/commoditywise_export`
**Imports:** `https://tradestat.commerce.gov.in/meidb/commoditywise_import`

**Metadata:**
- Data available: **Jan 2018 to Apr 2026** (monthly)
- Status flags: `(R)` = Revised Final (up to Mar 2025), `(F)` = Final (up to Apr 2026)
- Last updated: **16/06/2026**
- Anti-scraping: Same as EIDB — `noBack()`, `oncopy="return false"`, `oncontextmenu="return false"`

**Form Parameters (POST to same URL):**

| Field | Type | Values |
|-------|------|--------|
| `_token` | hidden | CSRF token |
| `comlev` | radio | `all` / `specific` |
| `comval` | text | HS code value (when specific) |
| `ddCommodityLevel` | select | Commodity level (1-digit, 2-digit, 4-digit, 6-digit, 8-digit) |
| `ddMonth` | select | Month (1–12) |
| `ddYear` | select | Year (2018–2026) |
| `ddReportVal` | select | Report type |
| `ddReportYear` | select | Additional year for comparison |
| `hscode_value` | text | HS code lookup |
| `description_value` | text | Description lookup |

**Available Reports:**
1. Commodity-wise *(default)*
2. Principal commodity wise all HSCode
3. Commodity-wise all Countries
4. Country-wise
5. Country-wise all Commodities
6. Country-wise Principal commodity wise all HSCode
7. Region-wise
8. Region-wise all Countries
9. Region-wise all Commodities
10. Predefined Group of Countries
11. Customised Group of Countries

**Output Format:** HTML table with HSCode, Unit, Description, Value (USD), Volume.

**Key Advantage over EIDB:** Monthly granularity. You can build time-series data by iterating over months 2018-01 to 2026-04.

---

### 2.3 FTPA — Foreign Trade Performance Analysis

**URL:** `https://tradestat.commerce.gov.in/ftpa/export_commodity_group_new`
**Imports:** `https://tradestat.commerce.gov.in/ftpa/import_commodity_group_new`

**Metadata:**
- Data available: **January 2010 to April 2026**
- Uses **Livewire** (Laravel reactive component)
- Anti-scraping: Same as others

**Form Parameters (POST to same URL):**

| Field | Type | Values |
|-------|------|--------|
| `_token` | hidden | CSRF token |
| `Report` | select | Report type |
| `ReportType` | select | `commodity_group` / other |
| `Year` | select | 2010–2026 |
| `Month` | select | 1–12 |

**Available Reports:**
1. Commodity Group-wise *(default)*
2. Region-wise
3. Region x Country-wise
4. Top n Commodities
5. Top n Countries
6. Top n x n Countries x Commodities Matrix

**Output Format:** HTML table — columns vary by report type. Commodity group names, values in USD.

**Key Limitation:** Uses commodity **groups** (not HS codes), so less granular. Best used for high-level trend analysis.

---

### 2.4 FTSPCC — Foreign Trade Statistics (Principal Commodities & Countries)

**URL:** `https://tradestat.commerce.gov.in/ftspcc/export_commodity_wise`
**Imports:** `https://tradestat.commerce.gov.in/ftspcc/import_commodity_wise`
**Monthly (commodity × country):** `https://tradestat.commerce.gov.in/ftspcc/export_commodity_xcountry_wise_monthly`

**Metadata:**
- Data available: **January 2010 to April 2026**
- Last updated: (dynamic — shown on page)
- Uses **Livewire** (Laravel reactive)
- **Richest dataset** — principal commodity codes with country-level breaks

**Form Parameters (POST to same URL):**

| Field | Type | Values |
|-------|------|--------|
| `_token` | hidden | CSRF token |
| `ddMonthEx` | select | 1–12 |
| `ddYearEx` | select | 2010–2026 |
| `PCommodityEx` | select | `all` or commodity code (e.g., `M3`, `A2`) |
| `ddReportValEx` | select | Report type |

**Principal Commodity Codes (sample):**

| Code | Commodity |
|------|-----------|
| `all` | — All — |
| `M3` | AUTO COMPONENTS/PARTS |
| `H5` | BULK DRUGS, DRUG INTERMEDIATES |
| `F1` | COAL, COKE AND BRIQUITTES ETC |
| `A2` | COFFEE |
| `O9` | COMPUTER HARDWARE, PERIPHERALS |
| `P1` | CONSUMER ELECTRONICS |
| `D7` | BUFFALO MEAT |
| `H8` | DRUG FORMULATIONS, BIOLOGICALS |
| `P2` | ELECTRONICS COMPONENTS |
| `I6` | ESSENTIAL OILS |
| `G9` | GOLD AND OTH PRECS METL JWLERY |
| `L5` | ALUMINIUM, PRODUCTS OF ALUMINM |
| `L6` | COPPER AND PRDCTS MADE OF COPR |
| `D6` | ANIMAL CASINGS |
| `F2` | BULK MINERALS AND ORES |
| `N2` | BICYCLE AND PARTS |
| `N3` | CRANES, LIFTS AND WINCHES |
| `H2` | FERTILEZERS CRUDE |
| `H3` | FERTILEZERS MANUFACTURED |
| `E2` | DAIRY PRODUCTS |
| `C7` | FRESH FRUITS |
| `C8` | FRESH VEGETABLES |
| `R2` | COIR AND COIR MANUFACTURES |
| `S2` | CARPET (EXCL. SILK) HANDMADE |
| ... | *(~150 principal commodities total)* |

**Available Reports:**
1. Commodity-wise *(default)*
2. Commodity-wise 5 years
3. Commodity-wise all Countries
4. **Commodity x Country wise (Monthly)** ← **RIChest**
5. Commodity x Country wise (Annual)
6. Country wise
7. Country-wise all Commodities
8. Region-wise
9. Region-wise all Commodities
10. Region-wise all Countries
11. Predefined Group of countries
12. Customised Group of countries
13. Commodity x Country (n x n) Matrices

**Output Format (Commodity-wise):** Table with S.No, Commodity, Unit, Value (USD Million), Volume — for the selected month/year.

**Output Format (Commodity × Country Monthly):** Table with Commodity, Country, Value, Volume — the richest cross-section.

---

## 3. Extraction Strategy

### 3.1 Recommended Scrape Plan

```
Phase 1 — FTSPCC (Highest Priority)
├── Commodity-wise for each month (2010-01 to 2026-04)
│   └── ~196 months × 150 commodities = ~29,400 rows
├── Commodity × Country wise Monthly
│   └── ~196 months × 150 commodities × ~30 countries avg = ~882,000 rows
└── Country-wise for each month
    └── ~196 months × ~200 countries = ~39,200 rows

Phase 2 — MEIDB (HS-code granularity)
├── Commodity-wise for each month, at 2-digit, 4-digit, 6-digit HS level
└── Cross-reference HS codes with FTSPCC principal commodity mapping

Phase 3 — FTPA (High-level trends)
├── Commodity Group-wise for each month
└── Top n Commodities and Countries matrices

Phase 4 — EIDB (Yearly aggregate, validation)
├── Commodity-wise for each fiscal year
└── Used to validate monthly sums against yearly totals
```

### 3.2 Extraction Pipeline

```
┌──────────────────────┐
│  Step 1: Fetch page  │  GET request to portal URL
│  Parse HTML          │  Extract CSRF token from <input name="_token">
│  Build POST payload  │  Set month, year, report type, commodity
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Step 2: Submit form │  POST with form data + CSRF token
│  Receive HTML table  │  Response contains <table class="table-bordered">
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Step 3: Parse table │  HTMLRewriter / regex / cheerio
│  Extract rows        │  Map columns → normalized schema
│  Validate types      │  Value → float, remove commas, handle "—"
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Step 4: Transform   │  Add metadata: source_portal, scraped_at
│                      │  Normalize country names, unit codes
│                      │  Derive demand_level, est_shipment_cost
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Step 5: Store to D1 │  UPSERT on natural key
│  Log to scraping_log │  (source, year, month, commodity, country)
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Step 6: Trigger AI  │  Generate insights on new data
└──────────────────────┘
```

### 3.3 Iteration Logic (Pseudo)

```typescript
async function scrapeAllFtspcc(env: Env) {
  const token = await fetchCsrfToken('https://tradestat.commerce.gov.in/ftspcc/export_commodity_wise')

  for (const year of range(2010, 2026)) {
    for (const month of range(1, 12)) {
      // Skip future months
      if (year === 2026 && month > 4) break

      // Skip if already scraped (check scraping_log)
      const already = await env.DB.prepare(
        'SELECT 1 FROM scraping_log WHERE source_url = ? AND year = ? AND month = ? AND status = ?'
      ).bind(`ftspcc/export`, year, month, 'success').first()
      if (already) continue

      // --- Scrape 1: Commodity-wise ---
      const html1 = await postForm(`${BASE}/ftspcc/export_commodity_wise`, {
        _token: token,
        ddMonthEx: month,
        ddYearEx: year,
        PCommodityEx: 'all',
        ddReportValEx: '1',  // Commodity-wise
      })
      const commodities = parseCommodityTable(html1)

      // --- Scrape 2: Country-wise (all countries for each commodity) ---
      for (const commodity of commodities) {
        const html2 = await postForm(`${BASE}/ftspcc/export_commodity_wise`, {
          _token: token,
          ddMonthEx: month,
          ddYearEx: year,
          PCommodityEx: commodity.code,
          ddReportValEx: '3',  // Commodity-wise all Countries
        })
        const countryRows = parseCountryTable(html2)
        await upsertToD1(env.DB, countryRows, ftspcc, year, month)
      }

      // Log scrape
      await env.DB.prepare(
        'INSERT INTO scraping_log (...) VALUES (...)'
      ).bind(...).run()
    }
  }
}
```

---

## 4. Anti-Scraping Countermeasures

### 4.1 Challenges Identified

| Challenge | Portal(s) | Mitigation |
|-----------|-----------|------------|
| **CSRF tokens** | All | Extract `_token` from HTML before each POST. Token may expire — refresh every request. |
| **`history.forward()` / `noBack()`** | All | Pure client-side JavaScript. Workers `fetch()` is unaffected. |
| **`oncopy`, `oncontextmenu`, `ondrag` disabled** | All | Client-side only, no effect on server requests. |
| **Livewire reactive updates** | FTPA, FTSPCC | Livewire sends `wire:model` updates via XHR. For scraping, fall back to standard POST form submission. |
| **Session-based blocking** | All | Maintain cookie jar across requests. Use `fetch()` with `credentials: 'include'`. |
| **Rate limiting** | All | 1 request per 3 seconds. Randomize user-agent. Spread across 6-hour cron window. |
| **IP blocking** | All | Workers egress IPs change per request; low risk. Add retry with exponential backoff. |
| **Table structure changes** | All | Multi-strategy parser: try HTMLRewriter with known class, fallback to regex `<table>`, fallback to generic `<tr><td>` parsing. |

### 4.2 Required Request Headers

```typescript
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type': 'application/x-www-form-urlencoded',
  'Origin': 'https://tradestat.commerce.gov.in',
  'Referer': 'https://tradestat.commerce.gov.in/...',
}
```

### 4.3 CSRF Token Extraction

```typescript
async function fetchCsrfToken(url: string): Promise<string> {
  const resp = await fetch(url, { headers: HEADERS })
  const html = await resp.text()

  // Method 1: Standard Laravel CSRF
  const match1 = html.match(/<input[^>]*name="_token"[^>]*value="([^"]+)"/)
  if (match1) return match1[1]

  // Method 2: Livewire meta tag
  const match2 = html.match(/data-csrf="([^"]+)"/)
  if (match2) return match2[1]

  // Method 3: Cookie-based XSRF-TOKEN
  const cookies = resp.headers.getSetCookie()
  const xsrf = cookies.find(c => c.startsWith('XSRF-TOKEN='))
  if (xsrf) return decodeURIComponent(xsrf.split(';')[0].split('=')[1])

  throw new Error('CSRF token not found')
}
```

---

## 5. Data Schema (Normalized)

### 5.1 Unified Trade Record

```typescript
interface TradeRecord {
  // Keys
  source_portal: 'ftspcc' | 'meidb' | 'eidb' | 'ftpa'
  data_year: number          // 2010–2026
  data_month: number | null  // 1–12, null for yearly (EIDB)
  fiscal_year: string | null // '2025-2026' for EIDB

  // Commodity identifiers
  hs_code: string | null       // 2/4/6/8 digit HS (MEIDB, EIDB)
  principal_code: string | null // e.g. 'M3' (FTSPCC)
  commodity_name: string

  // Trade partner
  country_name: string
  country_code: string | null  // ISO 2-letter (normalized)

  // Trade values
  trade_value_usd: number      // USD Million
  volume: number | null
  unit: string | null          // 'KGS', 'NOS', 'MT', etc.

  // Metadata
  trade_type: 'export' | 'import'
  data_status: string | null   // '(R)', '(F)' for MEIDB
  scraped_at: string           // ISO timestamp
}
```

### 5.2 Principal Commodity → HS Code Mapping

This is a **critical derived table** generated by cross-referencing FTSPCC and MEIDB data:

```sql
CREATE TABLE principal_hs_mapping (
  principal_code TEXT NOT NULL,      -- e.g. 'M3'
  principal_name TEXT NOT NULL,      -- e.g. 'AUTO COMPONENTS/PARTS'
  hs_code TEXT NOT NULL,             -- e.g. '8708'
  hs_level INTEGER NOT NULL,         -- 2, 4, 6, or 8
  confidence REAL DEFAULT 0.5,       -- 0-1 how confident the mapping is
  source TEXT NOT NULL,              -- 'manual' | 'inferred' | 'meidb_crossref'
  created_at TEXT DEFAULT (datetime('now'))
);
```

**How to build:** Scrape MEIDB for individual HS codes, note which ones appear together under each FTSPCC principal commodity. Apply fuzzy matching on commodity name.

---

## 6. Scraping Schedule

```toml
[triggers]
# Primary: FTSPCC — every 6 hours (max 2 commodities per run to avoid rate limits)
crons = ["0 */6 * * *"]   # 4 runs/day → 8 commodities/day → all ~150 in ~19 days

# Secondary: MEIDB — daily at midnight (bulk HS codes)
crons = ["0 0 * * *"]

# Tertiary: EIDB — weekly (yearly aggregates only)
crons = ["0 6 * * 0"]

# Quarterly: FTPA — once a quarter (high-level trends)
crons = ["0 12 1 1,4,7,10 *"]
```

**Initial backfill:** A one-time script (not cron) that iterates all months from 2010-01 to 2026-04, running locally or on a larger Worker with a 5-minute timeout.

---

## 7. Extraction Implementation

### 7.1 Worker Scraper Structure

```
worker/src/scrapers/
├── index.ts           — Router: dispatch to correct scraper based on cron trigger
├── ftspcc.ts          — FTSPCC scraper (principal commodity × country × month)
├── meidb.ts           — MEIDB scraper (HS code level, monthly)
├── eidb.ts            — EIDB scraper (yearly aggregates)
├── ftpa.ts            — FTPA scraper (high-level groups)
├── csrf.ts            — CSRF token extraction utility
├── parser.ts          — HTML table parsers (multi-strategy)
├── normalizer.ts      — Country name → ISO code, unit normalization
└── scheduler.ts       — Determines what to scrape this cycle
```

### 7.2 HTMLRewriter Parse Strategy

```typescript
// Multi-strategy HTML table parser
const TABLE_PARSERS = [
  // Strategy 1: WordPress-style table
  { match: 'table.table-bordered', handler: parseBootstrapTable },

  // Strategy 2: Livewire-generated table
  { match: 'table[wire\\:sortable]', handler: parseLivewireTable },

  // Strategy 3: Generic table with header row
  { match: 'table', handler: parseGenericTable },
]

function parseBootstrapTable(element: Element) {
  const rows: Record<string, string>[] = []
  let headers: string[] = []

  element.querySelectorAll('tr').forEach((tr, i) => {
    if (i === 0) {
      headers = tr.querySelectorAll('th, td').map(th => th.textContent.trim())
    } else {
      const cells = tr.querySelectorAll('td')
      if (cells.length >= 2) {
        const row: Record<string, string> = {}
        cells.forEach((td, j) => {
          row[headers[j] || `col_${j}`] = td.textContent.trim()
        })
        rows.push(row)
      }
    }
  })
  return rows
}
```

### 7.3 Country Name Normalization

```typescript
const COUNTRY_NORMALIZE: Record<string, string> = {
  'U S A': 'USA',
  'U.S.A.': 'USA',
  'UNITED STATES': 'USA',
  'U K': 'UK',
  'U.K.': 'UK',
  'UNITED KINGDOM': 'UK',
  'U A E': 'UAE',
  'U.A.E.': 'UAE',
  'P R P CHINA': 'China',
  'HONG KONG': 'Hong Kong',
  'H K': 'Hong Kong',
  'REP OF KOREA': 'South Korea',
  'SOUTH KOREA': 'South Korea',
  'RUSSIA': 'Russia',
  'RUSSIAN FED': 'Russia',
  'SAUDI ARAB': 'Saudi Arabia',
  'SAUDI ARABIA': 'Saudi Arabia',
  'VIETNAM SOC REP': 'Vietnam',
  // ... expand as encountered
}
```

---

## 8. Data Validation

### 8.1 Cross-Portal Validation

```typescript
// FTSPCC commodity total for month M should ≈ sum of country values for month M
// EIDB yearly total should ≈ sum of MEIDB monthly values for that fiscal year

async function validateTotals(db: D1Database) {
  // FTSPCC commodity-wise value vs sum of country-wise values
  const mismatches = await db.prepare(`
    SELECT c.year, c.month, c.commodity_name,
           c.value as commodity_total,
           SUM(cc.value) as country_sum,
           ABS(c.value - SUM(cc.value)) as diff
    FROM trade_records c
    JOIN trade_records cc ON c.year = cc.year AND c.month = cc.month
                          AND c.commodity_name = cc.commodity_name
                          AND c.source_portal = 'ftspcc'
                          AND cc.source_portal = 'ftspcc'
                          AND c.country_name = '__TOTAL__'
                          AND cc.country_name != '__TOTAL__'
    GROUP BY c.year, c.month, c.commodity_name
    HAVING diff > 1.0
  `).all()

  if (mismatches.length > 0) {
    console.warn('Data validation failed:', mismatches)
    // Flag in scraping_log
  }
}
```

### 8.2 Anomaly Detection

- Value spike > 500% of 3-month rolling average → flag for AI review
- Zero values for previously active commodity-country pair → log warning
- Missing months in sequence → trigger re-scrape

---

## 9. Incremental vs Full Scrape

| Strategy | When | What |
|----------|------|------|
| **Incremental** | Every cron run (6h / daily) | Only scrape the latest month that TRADESTAT may have updated. Check `scraping_log` for latest successful month. |
| **Backfill** | Initial deploy | Iterate ALL months from 2010-01 to 2026-04. Run as a one-off script, not cron. |
| **Re-scrape** | Manual trigger | Re-scrape a specific month/year range (e.g., if validation fails, or TRADESTAT revises data) |

**Backfill estimation:**
- FTSPCC: ~196 months × 150 commodities × ~30 countries = ~882k records
- At 1 req/3 sec = 20 req/min → ~44,100 min = ~30 days for full backfill
- **Optimization:** Parallelize across 5 commodities at once → ~6 days

---

## 10. Error Recovery

```typescript
async function scrapeWithRetry(url: string, params: any, retries = 3): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams(params),
        headers: { ...HEADERS, 'Cookie': await getCookie() },
      })
      if (resp.status === 419) {
        // CSRF token expired — refresh and retry
        params._token = await fetchCsrfToken(url)
        continue
      }
      if (resp.status === 429) {
        // Rate limited — wait and retry
        await sleep(10_000 * (i + 1))
        continue
      }
      return await resp.text()
    } catch (err) {
      if (i === retries - 1) throw err
      await sleep(5_000 * (i + 1))
    }
  }
  throw new Error('Max retries exceeded')
}
```

---

## 11. Data Flow Diagram

```
TRADESTAT Portals
    │
    ├── FTSPCC (commodity × country × month) ───┐
    ├── MEIDB (HS code × month) ─────────────────┤
    ├── EIDB (HS code × year) ───────────────────┤
    └── FTPA (commodity group × month) ──────────┤
                                                 ▼
                                         ┌──────────────┐
                                         │  Scraper     │
                                         │  Workers     │
                                         │  (Cron)      │
                                         └──────┬───────┘
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │  Normalizer  │
                                         │  - Country   │
                                         │  - Unit      │
                                         │  - HS match  │
                                         └──────┬───────┘
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │  D1 Database │
                                         │  trade_items │
                                         │  mapping     │
                                         │  logs        │
                                         └──────┬───────┘
                                                │
                                ┌───────────────┼───────────────┐
                                ▼               ▼               ▼
                         ┌──────────┐   ┌────────────┐   ┌──────────┐
                         │ API      │   │  Workers   │   │ Validate │
                         │ Endpoints│   │  AI        │   │ + Alert  │
                         └──────────┘   └────────────┘   └──────────┘
```

---

## 12. Implementation Phases

### Phase 1 — Foundation (Week 1)
- [ ] Set up Worker project with Hono
- [ ] Implement CSRF token extraction
- [ ] Build FTSPCC scraper (commodity-wise for single month)
- [ ] Define D1 schema for trade_items + scraping_log
- [ ] Test with one commodity, one month

### Phase 2 — Full FTSPCC (Week 2)
- [ ] Iterate all commodities per month
- [ ] Add commodity × country wise scraping
- [ ] Country name normalization
- [ ] Backfill script for 2010–2026
- [ ] Validation: commodity total = sum of country values

### Phase 3 — MEIDB + EIDB (Week 3)
- [ ] MEIDB scraper (HS code level, monthly)
- [ ] EIDB scraper (yearly aggregates)
- [ ] Build principal commodity ↔ HS code mapping table
- [ ] Cross-portal validation

### Phase 4 — Production (Week 4)
- [ ] Cron triggers for incremental scraping
- [ ] Error recovery and alerting
- [ ] API endpoints to serve scraped data
- [ ] AI insight generation on fresh data

---

## 13. Key URLs Reference

### Exports
| Portal | URL |
|--------|-----|
| FTSPCC Commodity-wise | `https://tradestat.commerce.gov.in/ftspcc/export_commodity_wise` |
| FTSPCC × Country Monthly | `https://tradestat.commerce.gov.in/ftspcc/export_commodity_xcountry_wise_monthly` |
| FTSPCC Country-wise | `https://tradestat.commerce.gov.in/ftspcc/export_country_wise` |
| MEIDB Commodity-wise | `https://tradestat.commerce.gov.in/meidb/commoditywise_export` |
| MEIDB × Country | `https://tradestat.commerce.gov.in/meidb/country_wise_principal_commoditywiseall_hscode_export` |
| EIDB Commodity-wise | `https://tradestat.commerce.gov.in/eidb/commodity_wise_export` |
| EIDB × Country | `https://tradestat.commerce.gov.in/eidb/commodityx_countries_wise_export` |
| FTPA Commodity Group | `https://tradestat.commerce.gov.in/ftpa/export_commodity_group_new` |

### Imports (mirror structure — replace `export` → `import`)
| Portal | URL |
|--------|-----|
| FTSPCC Commodity-wise | `https://tradestat.commerce.gov.in/ftspcc/import_commodity_wise` |
| FTSPCC × Country Monthly | `https://tradestat.commerce.gov.in/ftspcc/import_commodity_xcountry_wise_monthly` |
| MEIDB Commodity-wise | `https://tradestat.commerce.gov.in/meidb/commoditywise_import` |
| EIDB Commodity-wise | `https://tradestat.commerce.gov.in/eidb/commodity_wise_import` |
| FTPA Commodity Group | `https://tradestat.commerce.gov.in/ftpa/import_commodity_group_new` |
