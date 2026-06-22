CREATE TABLE IF NOT EXISTS categories (hs_code TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT);
CREATE TABLE IF NOT EXISTS trade_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_name TEXT NOT NULL,
  category_code TEXT NOT NULL,
  trade_type TEXT NOT NULL CHECK(trade_type IN ('export','import')),
  country_code TEXT NOT NULL,
  trade_value_usd REAL NOT NULL,
  volume REAL,
  unit TEXT DEFAULT 'units',
  demand_level TEXT,
  source TEXT DEFAULT 'TRADESTAT',
  source_url TEXT,
  scraped_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trade_type ON trade_items(trade_type);
CREATE INDEX IF NOT EXISTS idx_trade_category ON trade_items(category_code);
CREATE INDEX IF NOT EXISTS idx_trade_country ON trade_items(country_code);

CREATE TABLE IF NOT EXISTS scraping_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT,
  status TEXT,
  items_count INTEGER,
  error_msg TEXT,
  started_at TEXT,
  finished_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed categories (structural, not trade data)
INSERT OR IGNORE INTO categories (hs_code, name, description) VALUES
  ('10','Agricultural Products','Cereals, grains, agricultural produce'),
  ('15','Vegetable Oils','Edible oils and fats'),
  ('27','Mineral Fuels & Oils','Petroleum, natural gas, mineral fuels'),
  ('30','Pharmaceuticals','Drug formulations, bulk drugs, medical products'),
  ('39','Plastics & Chemicals','Polymers, organic chemicals, plastics'),
  ('61','Textiles & Apparel','Clothing, fabrics, textile articles'),
  ('71','Gems & Jewelry','Diamonds, gold jewelry, precious stones'),
  ('72','Iron & Steel','Iron, steel, and metal products'),
  ('84','Machinery & Equipment','Industrial machinery and mechanical appliances'),
  ('85','Electronics & Telecom','Electronic goods, telecommunications equipment'),
  ('87','Transport Equipment','Vehicles, auto components, transport machinery'),
  ('95','Toys & Sports','Toys, games, sporting goods');
