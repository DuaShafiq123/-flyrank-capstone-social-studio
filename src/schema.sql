-- The one stored copy of each blog post. All generation reads from here.
CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type   TEXT NOT NULL CHECK (source_type IN ('url', 'markdown')),
  source_url    TEXT,
  title         TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  tags          TEXT NOT NULL DEFAULT '[]',
  content_hash  TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL
);

-- One platform-specific version of a post.
CREATE TABLE IF NOT EXISTS variants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id       INTEGER NOT NULL REFERENCES posts(id),
  platform      TEXT NOT NULL,
  text          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'approved', 'rejected', 'published')),
  origin        TEXT NOT NULL CHECK (origin IN ('template', 'manual')),
  reject_reason TEXT,
  reviewed_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- A calendar slot: "publish variant V at time T". This table IS the durable job store.
CREATE TABLE IF NOT EXISTS slots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id      INTEGER NOT NULL REFERENCES variants(id),
  scheduled_at    TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'claimed', 'published', 'failed', 'needs_attention', 'cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  attempts        INTEGER NOT NULL DEFAULT 0,
  lease_owner     TEXT,
  lease_until     TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slots_due ON slots (status, next_attempt_at);
-- A variant can have at most one live slot. The database itself enforces it.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_live_slot_per_variant
  ON slots (variant_id) WHERE status IN ('scheduled', 'claimed', 'published', 'needs_attention');

-- One row per idempotency key = at most one real post per (variant, slot).
-- 'sending' is written BEFORE the network call, so a crash leaves evidence behind.
CREATE TABLE IF NOT EXISTS publications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  slot_id         INTEGER NOT NULL REFERENCES slots(id),
  variant_id      INTEGER NOT NULL REFERENCES variants(id),
  adapter         TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('sending', 'succeeded', 'failed')),
  external_id     TEXT,
  external_url    TEXT,
  error           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Append-only publish history: every attempt and its result.
CREATE TABLE IF NOT EXISTS publish_attempts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id         INTEGER NOT NULL,
  variant_id      INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  adapter         TEXT,
  worker          TEXT,
  outcome         TEXT NOT NULL CHECK (outcome IN
                  ('success', 'failed', 'ambiguous', 'duplicate_skipped', 'reconciled', 'uncertain', 'refused', 'resolved')),
  detail          TEXT,
  external_url    TEXT,
  created_at      TEXT NOT NULL
);

-- What the mock adapters "posted". Deliberately NOT unique: a mock behaves like a
-- real platform that happily accepts duplicates, so the tests prove OUR idempotency.
CREATE TABLE IF NOT EXISTS mock_posts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  adapter         TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  text            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mock_posts_key ON mock_posts (adapter, idempotency_key);
