import { Hono } from "hono";
import { cors } from "hono/cors";

// ── Runtime ──
// ponytail: CF Workers uses D1 binding from env; wrangler dev provides it locally

// ── Shipment cost rates ──
const SHIPMENT: Record<string, number> = {
  neighbor: 0.06, asia: 0.09, europe_africa: 0.13, americas_other: 0.16,
};

const COUNTRY_REGIONS: Record<string, string> = {
  BD: "neighbor", NP: "neighbor", LK: "neighbor", PK: "neighbor", BT: "neighbor", MM: "neighbor",
  CN: "asia", AE: "asia", SA: "asia", SG: "asia", JP: "asia", KR: "asia", HK: "asia",
  QA: "asia", MY: "asia", ID: "asia", TH: "asia", VN: "asia", PH: "asia", IR: "asia",
  IQ: "asia", KW: "asia", OM: "asia", BH: "asia", AU: "asia", NZ: "asia",
  DE: "europe_africa", GB: "europe_africa", FR: "europe_africa", NL: "europe_africa",
  ZA: "europe_africa", RU: "europe_africa", IT: "europe_africa", ES: "europe_africa",
  CH: "europe_africa", BE: "europe_africa", TR: "europe_africa", NG: "europe_africa",
  KE: "europe_africa", EG: "europe_africa", TZ: "europe_africa",
  US: "americas_other", BR: "americas_other", CA: "americas_other", MX: "americas_other",
};

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
    name: r.code === "XX" ? "Aggregate" : r.code,
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

    // ponytail: use helpers directly
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
        type: r.trade_type, country: r.country_code === "XX" ? "Aggregate" : r.country_code, countryCode: r.country_code,
        demandLevel: r.demand_level, tradeValueUsd: r.trade_value_usd, volume: r.volume, unit: r.unit,
        rank: i + 1 + offset,
        estShipmentCostUsd: Math.round(r.trade_value_usd * rate * 100) / 100,
        shipmentCostEstimated: true, source: r.source ?? "TRADESTAT / DGFT",
        sourceUrl: r.source_url ?? "https://tradestat.commerce.gov.in",
        lastUpdated: r.scraped_at ?? new Date().toISOString(),
      };
    });
    return c.json({ items, total, limit, offset });
  } catch (err: any) {
    return c.json({ error: err.message || "query failed" }, 500);
  }
});

// ── POST /api/trade/refresh ──
app.post("/api/trade/refresh", async (c) => {
  const d = db(c);
  try {
    await scrapeNow(d);
    const last = await first(d, "SELECT MAX(scraped_at) as last FROM trade_items");
    const count = await first(d, "SELECT COUNT(*) as c FROM trade_items");
    return c.json({ status: "done", items: (count as any)?.c ?? 0, lastUpdated: (last as any)?.last });
  } catch (err: any) {
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
    `Top categories: ${(topCats || []).map((x: any) => x.name).join(", ")}. Data sourced from TRADESTAT (DGFT, Ministry of Commerce).`;

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
    reply = `Top exports (TRADESTAT): ${top.map((x: any) => `${x.product_name} ($${x.trade_value_usd}M)`).join(", ") || "no data"}. Total: $${ev.toFixed(0)}M.`;
  } else if (lower.includes("import")) {
    const top = await all(d, "SELECT product_name, trade_value_usd FROM trade_items WHERE trade_type='import' ORDER BY trade_value_usd DESC LIMIT 5") as any[];
    reply = `Top imports (TRADESTAT): ${top.map((x: any) => `${x.product_name} ($${x.trade_value_usd}M)`).join(", ") || "no data"}. Total: $${iv.toFixed(0)}M.`;
  } else if (lower.includes("balance") || lower.includes("deficit") || lower.includes("surplus")) {
    reply = `Trade balance: $${(ev - iv).toFixed(0)}M (${ev >= iv ? "surplus" : "deficit"}). Exports: $${ev.toFixed(0)}M, Imports: $${iv.toFixed(0)}M.`;
  } else if (lower.includes("category") || lower.includes("sector")) {
    const top = await all(d, "SELECT cat.name, COALESCE(SUM(t.trade_value_usd),0) as v FROM categories cat JOIN trade_items t ON cat.hs_code=t.category_code GROUP BY cat.name ORDER BY v DESC LIMIT 5") as any[];
    reply = `Top categories: ${top.map((x: any) => `${x.name} ($${x.v.toFixed(0)}M)`).join(", ") || "no data"}.`;
  } else if (lower.includes("country") || lower.includes("partner")) {
    const top = await all(d, "SELECT country_code, COALESCE(SUM(trade_value_usd),0) as v FROM trade_items GROUP BY country_code ORDER BY v DESC LIMIT 5") as any[];
    reply = `Top partners: ${top.map((x: any) => `${x.country_code} ($${x.v.toFixed(0)}M)`).join(", ") || "no data"}.`;
  } else {
    reply = `India trade (TRADESTAT): exports $${ev.toFixed(0)}M, imports $${iv.toFixed(0)}M, balance $${(ev - iv).toFixed(0)}M. Ask about exports, imports, categories, countries, or balance.`;
  }

  return c.json({ role: "assistant", content: reply });
});

// ── GET /api/scraping/log ──
app.get("/api/scraping/log", async (c) => {
  const d = db(c);
  const rows = await all(d, "SELECT * FROM scraping_log ORDER BY id DESC LIMIT 20");
  return c.json(rows);
});

// ── GET /api/scraping/diag — diagnostic: try multiple POST strategies ──
app.get("/api/scraping/diag", async (c) => {
  const url = c.req.query("url") ?? "https://tradestat.commerce.gov.in/eidb/commodity_wise_export";
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

  const results: any[] = [];

  // Step 1: GET page
  const resp = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" } });
  const html = await resp.text();
  const cookies = resp.headers.get("set-cookie") ?? "";
  const sessionCookie = String(cookies).split(",").map(c => c.split(";")[0]?.trim()).filter(Boolean).join("; ");
  const csrf = html.match(/<input[^>]*name=["']_token["'][^>]*value=["']([^"']+)["']/)?.[1] ?? "";

  // Extract form action URL if different
  const formAction = html.match(/<form[^>]*action=["']([^"']+)["']/)?.[1] ?? url;
  const formMethod = html.match(/<form[^>]*method=["']([^"']+)["']/)?.[1] ?? "POST";

  const baseHeaders = {
    "User-Agent": UA,
    "Referer": url,
    "Origin": "https://tradestat.commerce.gov.in",
    "X-CSRF-TOKEN": csrf,
    ...(sessionCookie ? { "Cookie": sessionCookie } : {}),
  };

  // Try 1: Standard form POST
  const p1 = new URLSearchParams();
  p1.set("_token", csrf); p1.set("comType", "all"); p1.set("EidbComLevelCwe", "2"); p1.set("EidbYearCwe", "2025-2026"); p1.set("Eidb_ReportCwe", "1");
  const r1 = await fetch(formAction, { method: formMethod, headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded" }, body: p1, redirect: "follow" });
  results.push({ strategy: "form-post", status: r1.status, length: (await r1.clone().text()).length, title: ((await r1.clone().text()).match(/<title>([^<]+)<\/title>/)?.[1] ?? "") });

  // Try 2: AJAX with JSON accept
  const r2 = await fetch(formAction, { method: "POST", headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" }, body: p1 });
  const t2 = await r2.text();
  results.push({ strategy: "ajax-json", status: r2.status, length: t2.length, isJSON: t2.startsWith("{"), preview: t2.substring(0, 500) });

  // Try 3: DataTables AJAX (common Laravel pattern)
  const dtParams = new URLSearchParams();
  dtParams.set("draw", "1");
  dtParams.set("start", "0");
  dtParams.set("length", "50");
  dtParams.set("_token", csrf);
  dtParams.set("comType", "all");
  dtParams.set("EidbComLevelCwe", "2");
  dtParams.set("EidbYearCwe", "2025-2026");
  dtParams.set("Eidb_ReportCwe", "1");
  const dtUrl = formAction + (formAction.includes("?") ? "&" : "?") + "draw=1&start=0&length=50";
  const r3 = await fetch(formAction, { method: "POST", headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" }, body: dtParams });
  const t3 = await r3.text();
  results.push({ strategy: "datatables", status: r3.status, length: t3.length, isJSON: t3.startsWith("{"), preview: t3.substring(0, 500) });

  // Try 4: GET with query params (some portals use GET for reports)
  const qp = new URLSearchParams({ comType: "all", EidbComLevelCwe: "2", EidbYearCwe: "2025-2026", Eidb_ReportCwe: "1", _token: csrf });
  const r4 = await fetch(formAction + "?" + qp.toString(), { headers: baseHeaders });
  const t4 = await r4.text();
  results.push({ strategy: "get-query", status: r4.status, length: t4.length, hasTable: t4.includes("<table"), preview: t4.substring(0, 500) });

  return c.json({
    url, formAction, formMethod,
    csrfFound: !!csrf, cookiesPresent: !!sessionCookie,
    pageHasAjax: html.includes("ajax") || html.includes("DataTable") || html.includes("$.ajax") || html.includes("fetch"),
    pageScripts: (html.match(/<script[^>]*src=["']([^"']+)["']/g) ?? []).slice(0, 10).map(s => s.match(/src=["']([^"']+)["']/)?.[1]).filter(Boolean),
    results,
  });
});

// ────────────────────────────────────
//  SCRAPER — TradeMap.org API (clean JSON, no CSRF)
// ────────────────────────────────────

async function scrapeNow(d: any) {
  const startTime = new Date().toISOString();
  try {
    await run(d, "DELETE FROM trade_items");
    let total = 0;
    total += await scrapeTradeMap(d, "export");
    total += await scrapeTradeMapImports(d);
    await run(d, "INSERT INTO scraping_log(source,status,items_count,started_at) VALUES(?,?,?,?)", "trademap", total > 0 ? "success" : "partial", total, startTime);
    console.log(`[scraper] ${total} items from TradeMap`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await run(d, "INSERT INTO scraping_log(source,status,error_msg,started_at) VALUES(?,?,?,?)", "trademap", "failed", msg, startTime);
    console.error("[scraper]", msg);
  }
}

async function scrapeTradeMap(d: any, tradeType: string): Promise<number> {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
  const BASE = "https://www.trademap.org";

  // Get session cookie
  const initResp = await fetch(`${BASE}/embedded_india-tradeconnect/Dashboard.aspx`, {
    headers: { "User-Agent": UA, "Accept": "text/html" },
  });
  const rawCookies = initResp.headers.get("set-cookie") ?? "";
  const sessionCookies = Array.isArray(rawCookies)
    ? rawCookies.map(c => c.split(";")[0]?.trim()).filter(Boolean).join("; ")
    : String(rawCookies).split(",").map(c => c.split(";")[0]?.trim()).filter(Boolean).join("; ");
  const cookieHeader = sessionCookies + "; EmbeddedReferer=https://www.trade.gov.in/";
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
      const code = String(item.code ?? "").padStart(2, "0");
      const valueM = parseFloat(item.value ?? "0") / 1000; // thousands → millions USD
      if (valueM <= 0 || name.length < 2) continue;

      const catCode = classifyHS(name);
      const demand = valueM > 10000 ? "Very High" : valueM > 3000 ? "High" : valueM > 500 ? "Medium" : "Low";
      await run(d,
        "INSERT INTO trade_items(product_name,category_code,trade_type,country_code,trade_value_usd,volume,unit,demand_level,source,source_url,scraped_at) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'))",
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
        "INSERT INTO trade_items(product_name,category_code,trade_type,country_code,trade_value_usd,volume,unit,demand_level,source,source_url,scraped_at) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'))",
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

async function scrapeTradeMapImports(d: any): Promise<number> {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  const BASE = "https://www.trademap.org";
  const refYear = new Date().getFullYear() - 1;

  try {
    // Get fresh session
    const initResp = await fetch(`${BASE}/embedded_india-tradeconnect/Dashboard.aspx`, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
    });
    const rawCookies = initResp.headers.get("set-cookie") ?? "";
    const sessionCookies = Array.isArray(rawCookies)
      ? rawCookies.map(c => c.split(";")[0]?.trim()).filter(Boolean).join("; ")
      : String(rawCookies).split(",").map(c => c.split(";")[0]?.trim()).filter(Boolean).join("; ");
    const headers = { "User-Agent": UA, "Accept": "application/json", "Cookie": sessionCookies + "; EmbeddedReferer=https://www.trade.gov.in/" };

    // ponytail: linear chart has exports AND balance. imports = exports - balance.
    // This gives us country-level import data without needing a separate import endpoint.
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
            "INSERT INTO trade_items(product_name,category_code,trade_type,country_code,trade_value_usd,volume,unit,demand_level,source,source_url,scraped_at) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'))",
            `Imports from ${c.name}`, "84", "import", c.code, impV, null, "units",
            impV > 5000 ? "Very High" : impV > 1000 ? "High" : "Medium",
            "TradeMap / ITC", linUrl
          );
          count++;
        }
      }
      console.log(`[scraper:import] ${count} country import entries from linear chart`);
    }

    // Also try direct import treemap endpoints for HS-code breakdown
    // ponytail: if found, verify values differ from exports (TradeMap may default to exports for unknown params)
    const tmUrls = [
      `${BASE}/api/Dashboard?chart=treemap&countryCd=699&flow=m&referenceYear=${refYear}&lang=en`,
      `${BASE}/api/Dashboard?chart=treemap&countryCd=699&flow=-1&referenceYear=${refYear}&lang=en`,
    ];
    for (const url of tmUrls) {
      console.log(`[scraper:import] Trying ${url}`);
      const resp = await fetch(url, { headers });
      if (resp.ok) {
        const data = await resp.json() as any;
        // Verify: does the first value differ from exports? If same, TradeMap returned exports.
        if (data.children?.length > 0) {
          const firstVal = parseFloat(data.children[0]?.children?.[0]?.value ?? "0");
          const knownExportFirst = 22760; // Live animals export value in thousands (from HAR)
          // Only store if values differ significantly (>10% difference) from known exports
          if (firstVal > 0 && Math.abs(firstVal - knownExportFirst) / knownExportFirst > 0.1) {
            let hsCount = 0;
            for (const sec of data.children) {
              for (const item of sec.children ?? []) {
                const name = String(item.name ?? "");
                const valueM = parseFloat(item.value ?? "0") / 1000;
                if (valueM <= 0 || name.length < 2) continue;
                await run(d,
                  "INSERT INTO trade_items(product_name,category_code,trade_type,country_code,trade_value_usd,volume,unit,demand_level,source,source_url,scraped_at) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'))",
                  name.substring(0, 200), classifyHS(name), "import", "XX", valueM, null, "units",
                  valueM > 10000 ? "Very High" : valueM > 3000 ? "High" : "Medium",
                  "TradeMap / ITC", url
                );
                hsCount++;
              }
            }
            console.log(`[scraper:import] ${hsCount} verified HS import items`);
            return count + hsCount;
          } else {
            console.log(`[scraper:import] Values match exports (first=${firstVal}), skipping`);
          }
        }
      }
    }
    return count;
  } catch (err) {
    console.error("[scraper:import] Failed:", err instanceof Error ? err.message : String(err));
    return 0;
  }
}

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
  return "84";
}

// ── Ensure categories table is seeded ──
async function ensureCategories(d: any) {
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
  for (const [code, name, desc] of cats) {
    await run(d, "INSERT OR IGNORE INTO categories(hs_code,name,description) VALUES(?,?,?)", code, name, desc);
  }
}

// ── Cloudflare Workers exports ──
import indexHTML from "../public/index.html";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    try {
      await ensureCategories(env.DB);
    } catch (e) {
      console.error("ensureCategories failed:", e);
    }
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
