import { Hono } from "hono";
import { cors } from "hono/cors";

// ── Shipment cost rates ──
const SHIPMENT: Record<string, number> = {
  neighbor: 0.06, asia: 0.09, europe_africa: 0.13, americas_other: 0.16,
};

const COUNTRY_REGIONS: Record<string, string> = {
  "050": "neighbor", "524": "neighbor", "144": "neighbor", "586": "neighbor", "064": "neighbor", "104": "neighbor",
  "156": "asia", "784": "asia", "682": "asia", "702": "asia", "392": "asia", "410": "asia", "344": "asia",
  "634": "asia", "458": "asia", "360": "asia", "764": "asia", "704": "asia", "608": "asia", "364": "asia",
  "368": "asia", "414": "asia", "512": "asia", "048": "asia", "036": "asia", "554": "asia",
  "276": "europe_africa", "826": "europe_africa", "250": "europe_africa", "528": "europe_africa",
  "710": "europe_africa", "643": "europe_africa", "380": "europe_africa", "724": "europe_africa",
  "756": "europe_africa", "056": "europe_africa", "792": "europe_africa", "566": "europe_africa",
  "404": "europe_africa", "818": "europe_africa", "834": "europe_africa",
  "842": "americas_other", "076": "americas_other", "124": "americas_other", "484": "americas_other",
};

// ── Country full names — ITC numeric codes (used by TradeMap API) ──
const COUNTRY_NAMES: Record<string, string> = {
  "842": "USA", "156": "China", "784": "UAE", "682": "Saudi Arabia", "702": "Singapore",
  "392": "Japan", "410": "South Korea", "344": "Hong Kong", "634": "Qatar", "458": "Malaysia",
  "360": "Indonesia", "764": "Thailand", "704": "Vietnam", "608": "Philippines", "364": "Iran",
  "368": "Iraq", "414": "Kuwait", "512": "Oman", "048": "Bahrain", "036": "Australia", "554": "New Zealand",
  "276": "Germany", "826": "United Kingdom", "250": "France", "528": "Netherlands",
  "710": "South Africa", "643": "Russia", "380": "Italy", "724": "Spain",
  "756": "Switzerland", "056": "Belgium", "792": "Turkiye", "566": "Nigeria",
  "404": "Kenya", "818": "Egypt", "834": "Tanzania",
  "050": "Bangladesh", "524": "Nepal", "144": "Sri Lanka", "586": "Pakistan", "064": "Bhutan", "104": "Myanmar",
  "076": "Brazil", "124": "Canada", "484": "Mexico",
};

// ── Cookie helper ──
function cookieFrom(resp: Response): string {
  const raw = resp.headers.get("set-cookie") ?? "";
  return String(raw).split(",").map((c: string) => c.split(";")[0]?.trim()).filter(Boolean).join("; ");
}

// ── Hono App ──
const app = new Hono();
app.use("*", cors());

// ── D1 helpers ──
function db(c: any) { return c.env.DB; }

async function all(d: any, sql: string, ...params: any[]) {
  const result = await d.prepare(sql).bind(...params).all();
  return result.results ?? [];
}

async function first(d: any, sql: string, ...params: any[]) {
  return d.prepare(sql).bind(...params).first();
}

async function run(d: any, sql: string, ...params: any[]) {
  return d.prepare(sql).bind(...params).run();
}

// ── Simple health check / test endpoint ──
app.get("/api/ping", async (c) => {
  const d = db(c);
  try {
    const r = await d.prepare("SELECT 1 as ok").first();
    return c.json({ ok: true, db: !!r });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ── GET /api/trade/categories ──
app.get("/api/trade/categories", async (c) => {
  const d = db(c);
  const type = c.req.query("type") ?? "export";
  const rows = await all(d,
    `SELECT c.hs_code as code, c.name, c.description, COUNT(t.id) as item_count,
     COALESCE(SUM(t.trade_value_usd), 0) as total_value_usd
     FROM categories c LEFT JOIN trade_items t ON c.hs_code = t.category_code AND t.trade_type = ?
     GROUP BY c.hs_code, c.name ORDER BY total_value_usd DESC`,
    type
  );
  return c.json(rows);
});

// ── GET /api/trade/countries ──
app.get("/api/trade/countries", async (c) => {
  const d = db(c);
  const rows = await all(d,
    `SELECT t.country_code as code,
     COALESCE(SUM(CASE WHEN t.trade_type='export' THEN t.trade_value_usd ELSE 0 END),0) as export_value,
     COALESCE(SUM(CASE WHEN t.trade_type='import' THEN t.trade_value_usd ELSE 0 END),0) as import_value
     FROM trade_items t GROUP BY t.country_code ORDER BY (export_value+import_value) DESC`
  );
  return c.json((rows || []).map((r: any) => ({
    ...r,
    region: COUNTRY_REGIONS[r.code] ?? "asia",
    name: r.code === "XX" ? "Aggregate" : (COUNTRY_NAMES[r.code] ?? r.code),
  })));
});

// ── GET /api/trade/sources ──
app.get("/api/trade/sources", async (c) => {
  const d = db(c);
  const last = await first(d, "SELECT MAX(scraped_at) as last FROM trade_items");
  return c.json({
    source: "TradeMap / ITC",
    sourceUrl: "https://www.trademap.org",
    lastUpdated: (last as any)?.last ?? new Date().toISOString(),
  });
});

// ── GET /api/trade/:type (exports|imports) ──
app.get("/api/trade/:type", async (c) => {
  const d = db(c);
  const type = c.req.param("type") === "exports" ? "export" : "import";
  const search = c.req.query("search") ?? "";
  const country = c.req.query("country") ?? "";
  const sort = c.req.query("sort") ?? "value_desc";
  const limit = Math.min(+(c.req.query("limit") ?? 50), 200);
  const offset = +(c.req.query("offset") ?? 0);

  try {
    const conds = ["t.trade_type = ?"];
    const binds: any[] = [type];
    if (search) { conds.push("(LOWER(t.product_name) LIKE ? OR LOWER(t.country_code) LIKE ?)"); binds.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`); }
    if (country) { conds.push("t.country_code = ?"); binds.push(country.toUpperCase()); }

    const orderMap: Record<string, string> = {
      value_desc: "t.trade_value_usd DESC", value_asc: "t.trade_value_usd ASC",
      product_asc: "t.product_name ASC", product_desc: "t.product_name DESC",
      country_asc: "t.country_code ASC", country_desc: "t.country_code DESC",
      demand_desc: "CASE t.demand_level WHEN 'Very High' THEN 4 WHEN 'High' THEN 3 WHEN 'Medium' THEN 2 ELSE 1 END DESC",
    };
    const orderBy = orderMap[sort] ?? "t.trade_value_usd DESC";
    const where = conds.join(" AND ");

    const countRow = await first(d, `SELECT COUNT(*) as c FROM trade_items t WHERE ${where}`, ...binds) as any;
    const total = countRow?.c ?? 0;

    const rows = await all(d,
      `SELECT t.*, c.name as category_name FROM trade_items t LEFT JOIN categories c ON t.category_code = c.hs_code WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      ...binds, limit, offset
    );

    const items = (rows || []).map((r: any, i: number) => {
      const region = COUNTRY_REGIONS[r.country_code] ?? "asia";
      const rate = SHIPMENT[region] ?? 0.16;
      return {
        id: r.id, productName: r.product_name, category: r.category_name ?? "", categoryCode: r.category_code,
        type: r.trade_type, country: r.country_code === "XX" ? "Aggregate" : (COUNTRY_NAMES[r.country_code] ?? r.country_code), countryCode: r.country_code,
        demandLevel: r.demand_level, tradeValueUsd: r.trade_value_usd, volume: r.volume, unit: r.unit,
        rank: i + 1 + offset,
        estShipmentCostUsd: Math.round(r.trade_value_usd * rate * 100) / 100,
        shipmentCostEstimated: true, source: r.source ?? "TradeMap / ITC",
        sourceUrl: r.source_url ?? "https://trademap.org",
        lastUpdated: r.scraped_at ?? new Date().toISOString(),
      };
    });
    return c.json({ items, total, limit, offset });
  } catch (err: any) {
    return c.json({ error: err.message || "query failed" }, 500);
  }
});

// ponytail: simple in-memory throttle — resets on cold start (good enough)
let lastRefresh = 0;
const REFRESH_COOLDOWN = 30_000; // 30 seconds

// ── POST /api/trade/refresh ──
app.post("/api/trade/refresh", async (c) => {
  const now = Date.now();
  if (now - lastRefresh < REFRESH_COOLDOWN) {
    return c.json({ status: "throttled", retryAfter: Math.ceil((REFRESH_COOLDOWN - (now - lastRefresh)) / 1000) }, 429);
  }
  lastRefresh = now;

  const d = db(c);
  try {
    await scrapeNow(d);
    const last = await first(d, "SELECT MAX(scraped_at) as last FROM trade_items");
    const count = await first(d, "SELECT COUNT(*) as c FROM trade_items");
    return c.json({ status: "done", items: (count as any)?.c ?? 0, lastUpdated: (last as any)?.last });
  } catch (err: any) {
    // ponytail: release throttle on failure so user can retry
    lastRefresh = 0;
    return c.json({ status: "failed", error: err.message }, 500);
  }
});

// ── GET /api/ai/summary ──
app.get("/api/ai/summary", async (c) => {
  const d = db(c);
  const exp = await first(d, "SELECT COALESCE(SUM(trade_value_usd),0) as v FROM trade_items WHERE trade_type='export'") as any;
  const imp = await first(d, "SELECT COALESCE(SUM(trade_value_usd),0) as v FROM trade_items WHERE trade_type='import'") as any;
  const topCats = await all(d, "SELECT cat.name, COALESCE(SUM(t.trade_value_usd),0) as v FROM categories cat JOIN trade_items t ON cat.hs_code=t.category_code GROUP BY cat.name ORDER BY v DESC LIMIT 5") as any[];

  const ev = exp?.v ?? 0, iv = imp?.v ?? 0;
  const summary = `India's trade data: exports $${ev.toFixed(0)}M, imports $${iv.toFixed(0)}M, balance $${(ev - iv).toFixed(0)}M${ev > iv ? " surplus." : " deficit."} ` +
    `Top categories: ${(topCats || []).map((x: any) => x.name).join(", ")}. Data sourced from TradeMap / ITC.`;

  return c.json({ insightType: "summary", insightText: summary, confidence: 0.85, generatedAt: new Date().toISOString(), totals: { exports: ev, imports: iv, balance: ev - iv }, topCategories: topCats });
});

// ── POST /api/ai/chat ──
app.post("/api/ai/chat", async (c) => {
  const d = db(c);
  const { message } = await c.req.json() as any;
  if (!message) return c.json({ error: "message required" }, 400);

  // Workers AI
  if (c.env?.AI) {
    try {
      const ev = (await first(d, "SELECT COALESCE(SUM(trade_value_usd),0) as v FROM trade_items WHERE trade_type='export'")) as any;
      const iv = (await first(d, "SELECT COALESCE(SUM(trade_value_usd),0) as v FROM trade_items WHERE trade_type='import'")) as any;
      const top10 = await all(d, "SELECT product_name, trade_value_usd, trade_type, category_code FROM trade_items ORDER BY trade_value_usd DESC LIMIT 15") as any[];
      const topCats = await all(d, "SELECT cat.name, COALESCE(SUM(t.trade_value_usd),0) as v, t.trade_type FROM categories cat JOIN trade_items t ON cat.hs_code=t.category_code GROUP BY cat.name, t.trade_type ORDER BY v DESC LIMIT 10") as any[];
      const countryData = await all(d, "SELECT country_code, trade_type, COALESCE(SUM(trade_value_usd),0) as v FROM trade_items WHERE country_code != 'XX' GROUP BY country_code, trade_type ORDER BY v DESC LIMIT 10") as any[];

      const ctx = `You are an India trade data analyst with access to REAL TradeMap/ITC data.\n\n` +
        `TOTALS: Exports $${(ev?.v ?? 0).toFixed(0)}M, Imports $${(iv?.v ?? 0).toFixed(0)}M, Balance $${((ev?.v ?? 0) - (iv?.v ?? 0)).toFixed(0)}M\n\n` +
        `TOP ITEMS: ${JSON.stringify(top10.slice(0, 10))}\n\n` +
        `CATEGORIES: ${JSON.stringify(topCats.slice(0, 8))}\n\n` +
        `COUNTRY BREAKDOWN: ${JSON.stringify(countryData.slice(0, 8))}\n\n` +
        `Answer concisely with specific numbers from the data. Source: TradeMap.org / ITC.`;

      const result = await c.env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
        messages: [{ role: "system", content: ctx }, { role: "user", content: message }],
        max_tokens: 500,
      });

      return c.json({ role: "assistant", content: result.response ?? String(result) });
    } catch (err) { console.error("AI error:", err); }
  }

  // Fallback: rule-based
  const exp = (await first(d, "SELECT COALESCE(SUM(trade_value_usd),0) as v FROM trade_items WHERE trade_type='export'")) as any;
  const imp = (await first(d, "SELECT COALESCE(SUM(trade_value_usd),0) as v FROM trade_items WHERE trade_type='import'")) as any;
  const ev = exp?.v ?? 0, iv = imp?.v ?? 0;
  const lower = message.toLowerCase();
  let reply = "";

  if (lower.includes("export")) {
    const top = await all(d, "SELECT product_name, trade_value_usd FROM trade_items WHERE trade_type='export' ORDER BY trade_value_usd DESC LIMIT 5") as any[];
    reply = `Top exports (TradeMap): ${top.map((x: any) => `${x.product_name} ($${x.trade_value_usd}M)`).join(", ") || "no data"}. Total: $${ev.toFixed(0)}M.`;
  } else if (lower.includes("import")) {
    const top = await all(d, "SELECT product_name, trade_value_usd FROM trade_items WHERE trade_type='import' ORDER BY trade_value_usd DESC LIMIT 5") as any[];
    reply = `Top imports (TradeMap): ${top.map((x: any) => `${x.product_name} ($${x.trade_value_usd}M)`).join(", ") || "no data"}. Total: $${iv.toFixed(0)}M.`;
  } else if (lower.includes("balance") || lower.includes("deficit") || lower.includes("surplus")) {
    reply = `Trade balance: $${(ev - iv).toFixed(0)}M (${ev >= iv ? "surplus" : "deficit"}). Exports: $${ev.toFixed(0)}M, Imports: $${iv.toFixed(0)}M.`;
  } else if (lower.includes("category") || lower.includes("sector")) {
    const top = await all(d, "SELECT cat.name, COALESCE(SUM(t.trade_value_usd),0) as v FROM categories cat JOIN trade_items t ON cat.hs_code=t.category_code GROUP BY cat.name ORDER BY v DESC LIMIT 5") as any[];
    reply = `Top categories: ${top.map((x: any) => `${x.name} ($${x.v.toFixed(0)}M)`).join(", ") || "no data"}.`;
  } else if (lower.includes("country") || lower.includes("partner")) {
    const top = await all(d, "SELECT country_code, COALESCE(SUM(trade_value_usd),0) as v FROM trade_items GROUP BY country_code ORDER BY v DESC LIMIT 5") as any[];
    reply = `Top partners: ${top.map((x: any) => `${x.country_code} ($${x.v.toFixed(0)}M)`).join(", ") || "no data"}.`;
  } else {
    reply = `India trade (TradeMap): exports $${ev.toFixed(0)}M, imports $${iv.toFixed(0)}M, balance $${(ev - iv).toFixed(0)}M. Ask about exports, imports, categories, countries, or balance.`;
  }

  return c.json({ role: "assistant", content: reply });
});

// ── GET /api/scraping/log ──
app.get("/api/scraping/log", async (c) => {
  const d = db(c);
  const rows = await all(d, "SELECT * FROM scraping_log ORDER BY id DESC LIMIT 20");
  return c.json(rows);
});

// ────────────────────────────────────
//  SCRAPER — TradeMap.org API (clean JSON, no CSRF)
// ────────────────────────────────────

async function scrapeNow(d: any) {
  const startTime = new Date().toISOString();
  // ponytail: scrape into temp table, swap on success — no data loss on partial failure
  await run(d, "DROP TABLE IF EXISTS _trade_new");
  await run(d, "CREATE TABLE _trade_new (id INTEGER PRIMARY KEY AUTOINCREMENT, product_name TEXT NOT NULL, category_code TEXT NOT NULL, trade_type TEXT NOT NULL, country_code TEXT NOT NULL, trade_value_usd REAL NOT NULL, volume REAL, unit TEXT DEFAULT 'units', demand_level TEXT, source TEXT DEFAULT 'TradeMap', source_url TEXT, scraped_at TEXT DEFAULT (datetime('now')))");

  let total = 0;
  try {
    total += await scrapeTradeMap(d, "_trade_new", "export");
    total += await scrapeTradeMapImports(d, "_trade_new");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await run(d, "INSERT INTO scraping_log(source,status,error_msg,started_at) VALUES(?,?,?,?)", "trademap", "failed", msg, startTime);
    await run(d, "DROP TABLE IF EXISTS _trade_new");
    console.error("[scraper]", msg);
    return;
  }

  if (total > 0) {
    // ponytail: atomic swap via batch (D1 batch runs in a transaction)
    await d.batch([
      d.prepare("DROP TABLE IF EXISTS _trade_old"),
      d.prepare("ALTER TABLE trade_items RENAME TO _trade_old"),
      d.prepare("ALTER TABLE _trade_new RENAME TO trade_items"),
      d.prepare("DROP TABLE IF EXISTS _trade_old"),
      d.prepare("INSERT INTO scraping_log(source,status,items_count,started_at) VALUES(?,?,?,?)").bind("trademap", "success", total, startTime),
    ]);
    console.log(`[scraper] ${total} items from TradeMap`);
  } else {
    await run(d, "DROP TABLE IF EXISTS _trade_new");
    await run(d, "INSERT INTO scraping_log(source,status,items_count,started_at) VALUES(?,?,?,?)", "trademap", "partial", 0, startTime);
  }
}

async function scrapeTradeMap(d: any, table: string, tradeType: string): Promise<number> {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
  const BASE = "https://www.trademap.org";

  const initResp = await fetch(`${BASE}/embedded_india-tradeconnect/Dashboard.aspx`, {
    headers: { "User-Agent": UA, "Accept": "text/html" },
  });
  const cookieHeader = cookieFrom(initResp) + "; EmbeddedReferer=https://www.trade.gov.in/";
  const headers = { "User-Agent": UA, "Accept": "application/json", "Cookie": cookieHeader };

  const refYear = new Date().getFullYear() - 1;
  let count = 0;

  // Fetch treemap (HS code breakdown)
  const tmUrl = `${BASE}/api/Dashboard?chart=treemap&countryCd=699&referenceYear=${refYear}&lang=en`;
  console.log(`[scraper:${tradeType}] GET ${tmUrl}`);
  const tmResp = await fetch(tmUrl, { headers });
  if (!tmResp.ok) throw new Error(`TradeMap treemap: HTTP ${tmResp.status}`);
  const tmData = await tmResp.json() as any;

  for (const section of tmData.children ?? []) {
    for (const item of section.children ?? []) {
      const name = String(item.name ?? "");
      const valueM = parseFloat(item.value ?? "0") / 1000; // thousands → millions USD
      if (valueM <= 0 || name.length < 2) continue;

      const catCode = classifyHS(name);
      const demand = valueM > 10000 ? "Very High" : valueM > 3000 ? "High" : valueM > 500 ? "Medium" : "Low";
      await run(d,
        `INSERT INTO ${table}(product_name,category_code,trade_type,country_code,trade_value_usd,volume,unit,demand_level,source,source_url,scraped_at) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
        name.substring(0, 200), catCode, tradeType, "XX", valueM, null, "units", demand, "TradeMap / ITC", tmUrl
      );
      count++;
    }
  }

  // Fetch linear (country partners)
  const linUrl = `${BASE}/api/Dashboard?chart=linear&countryCd=699&lang=en`;
  console.log(`[scraper:${tradeType}] GET ${linUrl}`);
  const linResp = await fetch(linUrl, { headers });
  if (linResp.ok) {
    const linData = await linResp.json() as any;
    for (const c of linData.countries ?? []) {
      const valueM = parseFloat(c.exported_value_usd ?? "0") / 1000;
      if (valueM <= 0) continue;
      await run(d,
        `INSERT INTO ${table}(product_name,category_code,trade_type,country_code,trade_value_usd,volume,unit,demand_level,source,source_url,scraped_at) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
        `Trade with ${c.name}`, "84", tradeType, c.code, valueM, null, "units",
        valueM > 5000 ? "Very High" : valueM > 1000 ? "High" : "Medium",
        "TradeMap / ITC", linUrl
      );
      count++;
    }
  }

  console.log(`[scraper:${tradeType}] Stored ${count} items`);
  return count;
}

async function scrapeTradeMapImports(d: any, table: string): Promise<number> {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  const BASE = "https://www.trademap.org";
  const refYear = new Date().getFullYear() - 1;

  try {
    const initResp = await fetch(`${BASE}/embedded_india-tradeconnect/Dashboard.aspx`, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
    });
    const headers = { "User-Agent": UA, "Accept": "application/json", "Cookie": cookieFrom(initResp) + "; EmbeddedReferer=https://www.trade.gov.in/" };

    // ponytail: linear chart has exports AND balance. imports = exports - balance.
    const linUrl = `${BASE}/api/Dashboard?chart=linear&countryCd=699&lang=en`;
    console.log(`[scraper:import] Linear: GET ${linUrl}`);
    const linResp = await fetch(linUrl, { headers });
    let count = 0;

    if (linResp.ok) {
      const linData = await linResp.json() as any;
      for (const c of linData.countries ?? []) {
        const expV = parseFloat(c.exported_value_usd ?? "0") / 1000;
        const balance = parseFloat(c.balance ?? "0") / 1000;
        const impV = expV - balance; // imports = exports - balance

        if (impV > 0) {
          await run(d,
            `INSERT INTO ${table}(product_name,category_code,trade_type,country_code,trade_value_usd,volume,unit,demand_level,source,source_url,scraped_at) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
            `Imports from ${c.name}`, "84", "import", c.code, impV, null, "units",
            impV > 5000 ? "Very High" : impV > 1000 ? "High" : "Medium",
            "TradeMap / ITC", linUrl
          );
          count++;
        }
      }
      console.log(`[scraper:import] ${count} country import entries from linear chart`);
    }

    // ponytail: import treemap — speculative, undocumented params; skip if empty data
    // TradeMap may return export data regardless of flow param, so we only use this
    // as a fallback when the linear chart gave us nothing.
    if (count === 0) {
      const tmUrl = `${BASE}/api/Dashboard?chart=treemap&countryCd=699&flow=m&referenceYear=${refYear}&lang=en`;
      console.log(`[scraper:import] Treemap fallback: GET ${tmUrl}`);
      const resp = await fetch(tmUrl, { headers });
      if (resp.ok) {
        const data = await resp.json() as any;
        if (data.children?.length) {
          for (const sec of data.children) {
            for (const item of sec.children ?? []) {
              const name = String(item.name ?? "");
              const valueM = parseFloat(item.value ?? "0") / 1000;
              if (valueM <= 0 || name.length < 2) continue;
              await run(d,
                `INSERT INTO ${table}(product_name,category_code,trade_type,country_code,trade_value_usd,volume,unit,demand_level,source,source_url,scraped_at) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
                name.substring(0, 200), classifyHS(name), "import", "XX", valueM, null, "units",
                valueM > 10000 ? "Very High" : valueM > 3000 ? "High" : "Medium",
                "TradeMap / ITC", tmUrl
              );
              count++;
            }
          }
          console.log(`[scraper:import] ${count} HS items from treemap fallback`);
        }
      }
    }
    return count;
  } catch (err) {
    console.error("[scraper:import] Failed:", err instanceof Error ? err.message : String(err));
    return 0;
  }
}

// ponytail: no longer needed — import treemap fallback only runs when linear chart gives nothing

function classifyHS(name: string): string {
  const c = name.toLowerCase();
  if (c.includes("petrol") || c.includes("fuel") || c.includes("crude") || (c.includes("oil") && !c.includes("veg") && !c.includes("palm")) || c.includes("lng") || c.includes("lpg")) return "27";
  if (c.includes("diamond") || c.includes("gold") || c.includes("jewel") || c.includes("gem") || c.includes("prec") || c.includes("silver")) return "71";
  if (c.includes("drug") || c.includes("pharma") || c.includes("medic") || c.includes("vaccin") || c.includes("surg")) return "30";
  if (c.includes("electron") || c.includes("telecom") || c.includes("phone") || c.includes("circuit") || c.includes("solar") || c.includes("semicon")) return "85";
  if (c.includes("textile") || c.includes("cotton") || c.includes("apparel") || c.includes("garment") || c.includes("knit") || c.includes("cloth")) return "61";
  if (c.includes("steel") || c.includes("iron") || c.includes("metal") || c.includes("ore")) return "72";
  if (c.includes("rice") || c.includes("wheat") || c.includes("spice") || c.includes("cereal") || c.includes("grain") || c.includes("fruit") || c.includes("vegetable") || c.includes("meat") || c.includes("sugar") || c.includes("tea") || c.includes("coffee")) return "10";
  if (c.includes("plastic") || c.includes("polymer") || c.includes("chemical") || c.includes("organic") || c.includes("dye")) return "39";
  if (c.includes("auto") || c.includes("vehicle") || c.includes("car") || c.includes("motor") || c.includes("tractor")) return "87";
  if (c.includes("veg") || c.includes("palm") || c.includes("sunflower") || c.includes("soy") || c.includes("castor")) return "15";
  if (c.includes("toy") || c.includes("sport") || c.includes("game") || c.includes("cricket")) return "95";
  if (c.includes("machin") || c.includes("boiler") || c.includes("engine") || c.includes("equipment") || c.includes("pump") || c.includes("turbine")) return "84";
  return "00"; // ponytail: unknown — no misleading default
}

// ── Seed categories once ──
let _categoriesReady: Promise<void> | null = null;

async function ensureCategories(d: any) {
  if (_categoriesReady) return _categoriesReady;
  _categoriesReady = (async () => {
    const cats = [
      ["10","Agricultural Products","Cereals, grains, agricultural produce"],
      ["15","Vegetable Oils","Edible oils and fats"],
      ["27","Mineral Fuels & Oils","Petroleum, natural gas, mineral fuels"],
      ["30","Pharmaceuticals","Drug formulations, bulk drugs, medical products"],
      ["39","Plastics & Chemicals","Polymers, organic chemicals, plastics"],
      ["61","Textiles & Apparel","Clothing, fabrics, textile articles"],
      ["71","Gems & Jewelry","Diamonds, gold jewelry, precious stones"],
      ["72","Iron & Steel","Iron, steel, and metal products"],
      ["84","Machinery & Equipment","Industrial machinery and mechanical appliances"],
      ["85","Electronics & Telecom","Electronic goods, telecommunications equipment"],
      ["87","Transport Equipment","Vehicles, auto components, transport machinery"],
      ["95","Toys & Sports","Toys, games, sporting goods"],
    ];
    await d.batch(cats.map(([code, name, desc]) =>
      d.prepare("INSERT OR IGNORE INTO categories(hs_code,name,description) VALUES(?,?,?)").bind(code, name, desc)
    ));
  })();
  return _categoriesReady;
}

// ── Cloudflare Workers exports ──
import indexHTML from "../public/index.html";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    // ponytail: fire-and-forget category seed — never blocks a request
    ctx.waitUntil(ensureCategories(env.DB).catch((e: any) => console.error("ensureCategories failed:", e)));
    const res = await app.fetch(request, env, ctx);
    // ponytail: if Hono returns 404, serve index.html (SPA fallback)
    if (res.status === 404 && !request.url.includes("/api/")) {
      return new Response(indexHTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return res;
  },
  async scheduled(_event: any, env: any, _ctx: any) {
    if (env.DB) {
      await ensureCategories(env.DB);
      await scrapeNow(env.DB);
    }
  },
};
