-- Cloudflare D1 ledger for web checkout. Apply after: wrangler d1 create rtv-memory
CREATE TABLE IF NOT EXISTS pay_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  sku TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  channel_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  text TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pay_events_channel ON pay_events (channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_channel ON memory_events (channel_id, created_at);
