-- 256-bit randomly generated recovery codes are shown only once, never stored raw.
ALTER TABLE users ADD COLUMN recovery_code_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
INSERT OR IGNORE INTO schema_migrations VALUES (3, datetime('now'));
