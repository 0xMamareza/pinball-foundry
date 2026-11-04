CREATE TABLE IF NOT EXISTS challenges (
  nonce TEXT PRIMARY KEY NOT NULL,
  wallet TEXT NOT NULL,
  table_id TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant = 'standard'),
  expires_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1))
);
CREATE INDEX IF NOT EXISTS challenges_expiry ON challenges(expires_at);
