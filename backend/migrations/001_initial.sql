CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'guest' CHECK(kind IN ('guest','registered')),
 username TEXT UNIQUE COLLATE NOCASE, password_hash TEXT, display_name TEXT NOT NULL DEFAULT '我',
 locale TEXT NOT NULL DEFAULT 'zh-CN', region TEXT NOT NULL DEFAULT 'CN', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS assessments (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 version TEXT NOT NULL, answers_json TEXT NOT NULL, scores_json TEXT NOT NULL,
 target_dimensions_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assessments_user ON assessments(user_id,created_at);
CREATE TABLE IF NOT EXISTS self_feedback (
 assessment_id TEXT NOT NULL REFERENCES assessments(id), user_id TEXT NOT NULL REFERENCES users(id),
 rating TEXT NOT NULL CHECK(rating IN ('very_like','somewhat_like','not_like')), created_at TEXT NOT NULL,
 PRIMARY KEY(assessment_id,user_id)
);
CREATE TABLE IF NOT EXISTS friend_invites (
 token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), assessment_id TEXT NOT NULL REFERENCES assessments(id),
 created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_friend_invites_user ON friend_invites(user_id);
CREATE TABLE IF NOT EXISTS friend_assignments (
 invite_token TEXT NOT NULL REFERENCES friend_invites(token), respondent_id TEXT NOT NULL REFERENCES users(id),
 session_id TEXT NOT NULL UNIQUE, variant INTEGER NOT NULL, questions_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(invite_token,respondent_id)
);
CREATE TABLE IF NOT EXISTS friend_responses (
 id TEXT PRIMARY KEY, invite_token TEXT NOT NULL REFERENCES friend_invites(token), assessment_id TEXT NOT NULL REFERENCES assessments(id),
 respondent_id TEXT NOT NULL REFERENCES users(id), answers_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(assessment_id,respondent_id)
);
CREATE TABLE IF NOT EXISTS pulse_answers (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), day TEXT NOT NULL, question_id TEXT NOT NULL, question_json TEXT NOT NULL, version TEXT NOT NULL, region TEXT NOT NULL DEFAULT 'CN',
 choice TEXT NOT NULL CHECK(choice IN ('A','B')), created_at TEXT NOT NULL, UNIQUE(user_id,day)
);
CREATE INDEX IF NOT EXISTS idx_pulse_day ON pulse_answers(day,question_id);
CREATE TABLE IF NOT EXISTS challenges (
 token TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), question_id TEXT NOT NULL,
 question_json TEXT NOT NULL, source_answer_id TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, answer TEXT NOT NULL CHECK(answer IN ('A','B')), source TEXT NOT NULL,
 parent_token TEXT REFERENCES challenges(token), target_user_id TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_owner ON challenges(owner_id);
CREATE TABLE IF NOT EXISTS guesses (
 id TEXT PRIMARY KEY, challenge_token TEXT NOT NULL REFERENCES challenges(token), guesser_id TEXT NOT NULL REFERENCES users(id),
 choice TEXT NOT NULL CHECK(choice IN ('A','B')), correct INTEGER NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(challenge_token,guesser_id)
);
CREATE TABLE IF NOT EXISTS journal_notes (
 user_id TEXT NOT NULL REFERENCES users(id), answer_id TEXT NOT NULL REFERENCES pulse_answers(id),
 note TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,answer_id)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
 user_id TEXT NOT NULL REFERENCES users(id), scope TEXT NOT NULL, key TEXT NOT NULL,
 fingerprint TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,scope,key)
);
CREATE TABLE IF NOT EXISTS analytics_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES users(id), event TEXT NOT NULL, created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations VALUES (1, datetime('now'));
