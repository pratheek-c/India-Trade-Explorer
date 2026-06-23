import { useState, useEffect, useCallback, useRef } from "react";

// ── Types ──
type TradeItem = {
  id: number; productName: string; category: string; categoryCode: string;
  type: "export" | "import"; country: string; countryCode: string;
  demandLevel: string; tradeValueUsd: number; volume: number | null;
  unit: string | null; estShipmentCostUsd: number; shipmentCostEstimated: boolean;
  lastUpdated: string;
};
type Cat = { code: string; name: string; description: string; total_value_usd: number; item_count: number };
type Country = { code: string; name: string; region: string; export_value: number; import_value: number };
type Insight = { insightText: string; confidence: number; totals?: { exports: number; imports: number; balance: number }; topCategories?: { name: string; v: number }[] };
type ChatMsg = { role: string; content: string };

// ── API ──
const API = ""; // same origin — deployed alongside worker
const get = (p: string) => fetch(API + p).then(r => r.json());
const post = (p: string, body: any) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());

// ── Icons ──
const I = ({ d, className = "w-4 h-4" }: { d: string; className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const Sun = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>;
const Moon = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>;
const Search = () => <I d="m21 21-4.34-4.34M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />;
const XIcon = () => <I d="M18 6 6 18M6 6l12 12" />;
const Up = () => <I d="m18 15-6-6-6 6" />;
const Down = () => <I d="m6 9 6 6 6-6" />;
const Left = () => <I d="m15 18-6-6 6-6" />;
const Right = () => <I d="m9 18 6-6-6-6" />;
const Activity = () => <I d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />;
const Refresh = () => <I d="M21 12a9 9 0 1 1-6.219-8.56" />;
const Send = () => <I d="m22 2-7 20-4-9-9-4ZM22 2 11 13" />;
const Chat = () => <I d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;

// ── Theme ──
function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const d = localStorage.getItem("theme") === "dark" || (!localStorage.getItem("theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", d);
    return d;
  });
  const toggle = useCallback(() => setDark(p => {
    const n = !p;
    localStorage.setItem("theme", n ? "dark" : "light");
    document.documentElement.classList.toggle("dark", n);
    return n;
  }), []);
  return { dark, toggle };
}

// ── App ──
export function App() {
  const { dark, toggle } = useTheme();

  // Dashboard state
  const [tradeType, setTradeType] = useState<"export" | "import">("export");
  const [items, setItems] = useState<TradeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [cats, setCats] = useState<Cat[]>([]);
  const [catsLoading, setCatsLoading] = useState(false);
  const [countries, setCountries] = useState<Country[]>([]);
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [sort, setSort] = useState("value_desc");
  const [page, setPage] = useState(0);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [totals, setTotals] = useState({ exp: 0, imp: 0 });
  const [lastUpdated, setLastUpdated] = useState("");
  const [scraping, setScraping] = useState(false);
  const limit = 25;

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  // Fetch trade
  const fetchTrade = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: String(limit), offset: String(page * limit), sort });
      if (search) p.set("search", search);
      if (country) p.set("country", country);
      const ep = tradeType === "export" ? "/api/trade/exports" : "/api/trade/imports";
      const res = await get(`${ep}?${p}`);
      setItems(res.items);
      setTotal(res.total);
    } finally { setLoading(false); }
  }, [tradeType, search, country, sort, page]);

  // Country partners data (from country breakdown)
  const [partnerData, setPartnerData] = useState<{name: string; code: string; exp: number; imp: number; balance: number}[]>([]);

  // Top products
  const [topProducts, setTopProducts] = useState<TradeItem[]>([]);

  // Initial load
  useEffect(() => {
    // ponytail: totals computed from cats after they load (see useEffect below)
    get("/api/trade/countries").then((c: any[]) => {
      setCountries(c);
      // Build partner data with export/import/balance per country
      setPartnerData(c
        .filter((x: any) => x.code !== "XX" && (x.export_value > 0 || x.import_value > 0))
        .map((x: any) => ({ name: x.name, code: x.code, exp: x.export_value, imp: x.import_value, balance: x.export_value - x.import_value }))
        .sort((a: any, b: any) => (b.exp + b.imp) - (a.exp + a.imp))
        .slice(0, 10)
      );
    });
    // Top products
    get("/api/trade/exports?limit=10&sort=value_desc").then((r: any) => setTopProducts(r.items || []));
    get("/api/trade/sources").then((s: any) => setLastUpdated(s.lastUpdated));
    setInsightLoading(true);
    get("/api/ai/summary").then(setInsight).finally(() => setInsightLoading(false));
  }, []);

  useEffect(() => {
    setCatsLoading(true);
    get(`/api/trade/categories?type=${tradeType}`).then(c => {
      setCats(c);
      // ponytail: update totals from the first load of each type
      if (tradeType === 'export') setTotals(p => ({ ...p, exp: (c as Cat[]).reduce((s, x) => s + (x.total_value_usd ?? 0), 0) }));
      else setTotals(p => ({ ...p, imp: (c as Cat[]).reduce((s, x) => s + (x.total_value_usd ?? 0), 0) }));
    }).finally(() => setCatsLoading(false));
  }, [tradeType]);
  useEffect(() => { fetchTrade(); }, [fetchTrade]);

  // Auto-scroll chat
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs]);

  // Scrape trigger
  const triggerScrape = async () => {
    setScraping(true);
    try {
      await post("/api/trade/refresh", {});
      setTimeout(() => { fetchTrade(); get("/api/trade/sources").then((s: any) => setLastUpdated(s.lastUpdated)); setScraping(false); }, 3000);
    } catch { setScraping(false); }
  };

  // Chat send
  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    const userMsg: ChatMsg = { role: "user", content: msg };
    setChatMsgs(p => [...p, userMsg]);
    setChatInput("");
    setChatLoading(true);
    try {
      const res = await post("/api/ai/chat", { message: msg });
      setChatMsgs(p => [...p, { role: "assistant", content: res.content }]);
    } catch {
      setChatMsgs(p => [...p, { role: "assistant", content: "Sorry, failed to get a response. Is the worker running?" }]);
    } finally { setChatLoading(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--fg)" }}>
      {/* Header */}
      <header style={{ position: "sticky", top: 0, zIndex: 50, borderBottom: "1px solid var(--border)", background: "var(--bg)", opacity: 0.95 }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 16px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: "var(--primary)" }}><Activity /></span>
            <span style={{ fontWeight: 700, fontSize: 18 }}>India Trade Explorer</span>
            {lastUpdated && <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>Updated: {new Date(lastUpdated).toLocaleString()}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted-fg)" }}><Search /></span>
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Search..." style={{ height: 36, padding: "0 32px 0 36px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)", fontSize: 14, width: 200 }} />
              {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--muted-fg)", background: "none", border: "none", cursor: "pointer" }}><XIcon /></button>}
            </div>
            <div style={{ display: "inline-flex", borderRadius: 8, border: "1px solid var(--border)", background: "var(--muted)", padding: 2 }}>
              {(["export", "import"] as const).map(t => (
                <button key={t} onClick={() => { setTradeType(t); setPage(0); }} style={{ padding: "6px 12px", fontSize: 13, fontWeight: 500, borderRadius: 6, border: "none", cursor: "pointer", textTransform: "capitalize", background: tradeType === t ? "var(--bg)" : "transparent", color: tradeType === t ? "var(--fg)" : "var(--muted-fg)", boxShadow: tradeType === t ? "0 1px 2px rgba(0,0,0,0.1)" : "none" }}>{t}s</button>
              ))}
            </div>
            <button onClick={triggerScrape} disabled={scraping} title="Scrape fresh data from TradeMap" style={{ padding: 6, borderRadius: 6, border: "none", background: "transparent", color: "var(--muted-fg)", cursor: "pointer", position: "relative" }}>
              <span style={{ animation: scraping ? "spin 1s linear infinite" : "none", display: "inline-block" }}><Refresh /></span>
            </button>
            <button onClick={() => setChatOpen(!chatOpen)} title="AI Trade Analyst" style={{ padding: 6, borderRadius: 6, border: "none", background: chatOpen ? "var(--muted)" : "transparent", cursor: "pointer", color: chatOpen ? "var(--primary)" : "var(--muted-fg)" }}><Chat /></button>
            <button onClick={toggle} title={dark ? "Light" : "Dark"} style={{ padding: 6, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "var(--fg)" }}>{dark ? <Sun /> : <Moon />}</button>
          </div>
        </div>
      </header>

      <div style={{ display: "flex", maxWidth: 1280, margin: "0 auto", position: "relative" }}>
        {/* Main content */}
        <main style={{ flex: 1, padding: "24px 16px", minWidth: 0 }}>
          {/* AI Insight */}
          {insightLoading ? (
            <div className="p-4 rounded-xl mb-6" style={{ border: "1px solid var(--border)", background: "var(--card)", animation: "pulse 1.5s infinite" }}>
              <div style={{ height: 16, width: "60%", borderRadius: 4, background: "var(--muted)" }} />
            </div>
          ) : insight ? (
            <div className="p-4 rounded-xl mb-6" style={{ border: "1px solid var(--border)", background: "linear-gradient(135deg, #eff6ff, #eef2ff)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "#dbeafe", color: "#1d4ed8" }}>AI Insight</span>
                <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>{Math.round(insight.confidence * 100)}% confidence</span>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>{insight.insightText}</p>
            </div>
          ) : null}

          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 24 }}>
            <KPI icon={<span style={{ color: "#059669" }}><Up /></span>} label="Total Exports" value={`$${totals.exp.toFixed(0)}M`} color="#059669" />
            <KPI icon={<span style={{ color: "#dc2626" }}><Down /></span>} label="Total Imports" value={`$${totals.imp.toFixed(0)}M`} color="#dc2626" />
            <KPI icon={<span style={{ color: (totals.exp - totals.imp) >= 0 ? "#059669" : "#dc2626" }}>$</span>} label="Trade Balance" value={`$${(totals.exp - totals.imp).toFixed(0)}M`} color={(totals.exp - totals.imp) >= 0 ? "#059669" : "#dc2626"} />
            <KPI icon={<span style={{ color: "var(--primary)" }}><Activity /></span>} label="Top Category" value={cats[0]?.name ?? "—"} color="var(--primary)" />
          </div>

          {/* Country Partners */}
          {partnerData.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Top Trading Partners</h2>
              <div style={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--muted)" }}>
                        <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 500, color: "var(--muted-fg)" }}>Country</th>
                        <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 500, color: "#059669" }}>Exports</th>
                        <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 500, color: "#dc2626" }}>Imports</th>
                        <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 500, color: "var(--muted-fg)" }}>Balance</th>
                        <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 500, color: "var(--muted-fg)" }}>Trade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partnerData.map((p, i) => {
                        const maxVal = Math.max(...partnerData.map(x => x.exp + x.imp), 1);
                        const total = p.exp + p.imp;
                        const barW = (total / maxVal) * 100;
                        return (
                          <tr key={p.code} style={{ borderBottom: i < partnerData.length - 1 ? "1px solid var(--border)" : "none" }}
                            onMouseEnter={e => (e.currentTarget.style.background = "var(--muted)")}
                            onMouseLeave={e => (e.currentTarget.style.background = "")}
                          >
                            <td style={{ padding: "10px 16px", fontWeight: 500 }}>{p.name}</td>
                            <td style={{ padding: "10px 16px", textAlign: "right", fontFamily: "monospace", color: "#059669" }}>${p.exp.toFixed(0)}M</td>
                            <td style={{ padding: "10px 16px", textAlign: "right", fontFamily: "monospace", color: "#dc2626" }}>${p.imp.toFixed(0)}M</td>
                            <td style={{ padding: "10px 16px", textAlign: "right", fontFamily: "monospace", color: p.balance >= 0 ? "#059669" : "#dc2626" }}>{p.balance >= 0 ? "+" : ""}${p.balance.toFixed(0)}M</td>
                            <td style={{ padding: "10px 16px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--muted)", overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${barW}%`, borderRadius: 3, background: p.balance >= 0 ? "#059669" : "#dc2626", transition: "width 0.3s" }} />
                                </div>
                                <span style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "monospace" }}>${total.toFixed(0)}M</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Top Products */}
          {topProducts.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Top Export Products</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                {topProducts.slice(0, 6).map((p, i) => (
                  <div key={p.id} style={{
                    padding: "14px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.productName}>{p.productName}</div>
                      <div style={{ fontSize: 11, color: "var(--muted-fg)", marginTop: 2 }}>{p.category}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", color: i < 3 ? "var(--primary)" : "var(--fg)" }}>${p.tradeValueUsd.toFixed(0)}M</div>
                      <Badge level={p.demandLevel} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Category Grid */}
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, textTransform: "capitalize" }}>{tradeType} Categories</h2>
          {catsLoading ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 24 }}>
              {Array.from({ length: 12 }).map((_, i) => <div key={i} style={{ height: 80, borderRadius: 8, background: "var(--muted)", animation: "pulse 1.5s infinite" }} />)}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 24 }}>
              {cats.map(c => (
                <div key={c.code} style={{ padding: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer", transition: "all 0.15s" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--primary)")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
                >
                  <div style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "monospace" }}>HS {c.code}</div>
                  <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4, lineHeight: 1.3 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted-fg)", marginTop: 4 }}>${(c.total_value_usd ?? 0).toFixed(0)}M</div>
                </div>
              ))}
            </div>
          )}

          {/* Filters */}
          <div style={{ marginBottom: 16 }}>
            <select value={country} onChange={e => { setCountry(e.target.value); setPage(0); }}
              style={{ height: 36, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)", fontSize: 14 }}
            ><option value="">All Countries</option>{countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
          </div>

          {/* Trade Table */}
          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", background: "var(--card)" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--muted)" }}>
                    <Th label="Product" sortAsc="product_asc" sortDesc="product_desc" sort={sort} setSort={setSort} />
                    <Th label="Country" sortAsc="country_asc" sortDesc="country_desc" sort={sort} setSort={setSort} />
                    <Th label="Value (USD M)" sortAsc="value_asc" sortDesc="value_desc" sort={sort} setSort={setSort} />
                    <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 500, color: "var(--muted-fg)", fontSize: 13 }}>Volume</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 500, color: "var(--muted-fg)", fontSize: 13 }}>Shipment</th>
                    <Th label="Demand" sortAsc="" sortDesc="demand_desc" sort={sort} setSort={setSort} />
                  </tr>
                </thead>
                <tbody>
                  {loading ? <tr><td colSpan={6} style={{ padding: 48, textAlign: "center", color: "var(--muted-fg)" }}>Loading...</td></tr>
                   : items.length === 0 ? <tr><td colSpan={6} style={{ padding: 48, textAlign: "center", color: "var(--muted-fg)" }}>No data found</td></tr>
                   : items.map(item => (
                    <tr key={item.id} style={{ borderBottom: "1px solid var(--border)" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--muted)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}
                    >
                      <td style={{ padding: "12px 16px", fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.productName}>{item.productName}</td>
                      <td style={{ padding: "12px 16px", color: "var(--muted-fg)" }}>{item.country}</td>
                      <td style={{ padding: "12px 16px", fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>${item.tradeValueUsd.toFixed(1)}M</td>
                      <td style={{ padding: "12px 16px", color: "var(--muted-fg)", fontFamily: "monospace" }}>{item.volume ? `${item.volume.toLocaleString()} ${item.unit ?? ""}` : "—"}</td>
                      <td style={{ padding: "12px 16px", color: "var(--muted-fg)", fontFamily: "monospace" }}>${item.estShipmentCostUsd.toFixed(2)}M{item.shipmentCostEstimated && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.5 }}>est.</span>}</td>
                      <td style={{ padding: "12px 16px" }}><Badge level={item.demandLevel} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > 0 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--border)", background: "var(--muted)", fontSize: 13 }}>
                <span style={{ color: "var(--muted-fg)" }}>Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button onClick={() => setPage(p => p - 1)} disabled={page === 0} style={btnGhost}><Left /></button>
                  <span style={{ padding: "0 8px" }}>{page + 1} / {totalPages}</span>
                  <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} style={btnGhost}><Right /></button>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Chat sidebar */}
        {chatOpen && (
          <aside style={{ width: 360, flexShrink: 0, borderLeft: "1px solid var(--border)", background: "var(--bg)", height: "calc(100vh - 56px)", position: "sticky", top: 56, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--primary)" }}><Chat /></span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>AI Trade Analyst</span>
              </div>
              <button onClick={() => setChatOpen(false)} style={{ padding: 4, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: "var(--muted-fg)" }}><XIcon /></button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              {chatMsgs.length === 0 && (
                <div style={{ textAlign: "center", color: "var(--muted-fg)", padding: 40, fontSize: 13, lineHeight: 1.6 }}>
                  <p>👋 Ask me about India's trade data!</p>
                  <p style={{ fontSize: 12, marginTop: 8 }}>Try: "top exports", "import categories", "trade balance", "country partners"</p>
                </div>
              )}
              {chatMsgs.map((m, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "85%", padding: "10px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.5,
                    background: m.role === "user" ? "var(--primary)" : "var(--muted)",
                    color: m.role === "user" ? "white" : "var(--fg)",
                    borderBottomRightRadius: m.role === "user" ? 4 : 12,
                    borderBottomLeftRadius: m.role === "assistant" ? 4 : 12,
                  }}>{m.content}</div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: 12, background: "var(--muted)", fontSize: 13 }}>
                  <span style={{ animation: "pulse 1s infinite" }}>Analyzing...</span>
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
              <input
                value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendChat()}
                placeholder="Ask about trade data..."
                style={{ flex: 1, height: 40, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)", fontSize: 14 }}
              />
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                style={{ width: 40, height: 40, borderRadius: 8, border: "none", background: "var(--primary)", color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: chatLoading || !chatInput.trim() ? 0.5 : 1 }}
              ><Send /></button>
            </div>
          </aside>
        )}
      </div>

      {/* Loading overlay for scrape */}
      {scraping && (
        <div style={{ position: "fixed", bottom: 24, right: 24, padding: "12px 20px", borderRadius: 12, background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", fontSize: 13, display: "flex", alignItems: "center", gap: 8, zIndex: 100 }}>
          <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}><Refresh /></span>
          Scraping TradeMap data...
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
}

// ── Sub-components ──
const btnGhost: React.CSSProperties = { padding: 4, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "var(--fg)", display: "flex", alignItems: "center" };

function KPI({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div style={{ padding: 16, borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{icon}<span style={{ fontSize: 12, fontWeight: 500, color: "var(--muted-fg)" }}>{label}</span></div>
      <span style={{ fontSize: 20, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

function Th({ label, sortAsc, sortDesc, sort, setSort }: { label: string; sortAsc: string; sortDesc: string; sort: string; setSort: (s: string) => void }) {
  const active = sort === sortAsc || sort === sortDesc;
  const clickable = !!(sortAsc || sortDesc);
  return (
    <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 500, color: active ? "var(--fg)" : "var(--muted-fg)", fontSize: 13, cursor: clickable ? "pointer" : "default", userSelect: "none" }}
      onClick={() => clickable && setSort(sort === sortAsc ? sortDesc : sortAsc)}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{label}{sort === sortAsc ? <Up /> : sort === sortDesc ? <Down /> : null}</span>
    </th>
  );
}

function Badge({ level }: { level: string }) {
  const colors: Record<string, string> = { "Very High": "#fef2f2", High: "#fff7ed", Medium: "#fefce8", Low: "#f0fdf4" };
  const fgs: Record<string, string> = { "Very High": "#dc2626", High: "#ea580c", Medium: "#ca8a04", Low: "#16a34a" };
  return <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4, background: colors[level] ?? "#f3f4f6", color: fgs[level] ?? "#6b7280" }}>{level}</span>;
}
