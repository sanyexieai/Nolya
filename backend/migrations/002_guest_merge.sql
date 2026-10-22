-- Ephemeral approvals contain only a digest; never a password or raw token.
CREATE TABLE IF NOT EXISTS merge_previews (
 token_hash TEXT PRIMARY KEY,
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 source_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_merge_preview_session ON merge_previews(session_hash);
ALTER TABLE idempotency_keys ADD COLUMN invalidated INTEGER NOT NULL DEFAULT 0 CHECK(invalidated IN (0,1));
INSERT OR IGNORE INTO schema_migrations VALUES (2, datetime('now'));
