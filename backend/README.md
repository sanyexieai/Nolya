# Nolya Rust API

Axum 0.8 + Tokio + rusqlite (bundled SQLite), versioned Chinese question bank and local Argon2id accounts. Run commands from the product root; see the root README and docs/API.md for the user-facing contract.

```sh
cargo run --manifest-path backend/Cargo.toml
cargo test --manifest-path backend/Cargo.toml
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
```

Default listen address: `127.0.0.1:3000`. Default database: `data/nolya.sqlite`; default static directory: `frontend/dist`. Startup applies the checked-in schema transactionally through SQLite's migration statements; data is durable across process restarts. WAL, foreign-key constraints, busy timeout, parameterized queries and a process-local connection mutex are enabled. This is a single-process pilot design, not a horizontally scaled datastore.

## Safety boundaries

- Session tokens are 256 random bits; only SHA-256 digests are stored. Browser cookies are HttpOnly and SameSite=Lax, with Secure required for HTTPS configuration. Sessions last 30 days. Cookie expiry is not a claim of automatic data erasure; users can export/delete their records.
- Every mutation validates its Origin against the configured list. Current-session mutations need a CSRF token, including login. Anonymous login and guest bootstrap still require allowed Origin and JSON.
- Passwords use salted Argon2id on blocking workers with at most four concurrent password jobs. Login, registration, guest creation and domain writes have in-process rate limits. These are pilot safeguards; distributed abuse protection is still required before public rollout.
- Domain insert operations use idempotency records plus natural database uniqueness, inside the same transaction. Reusing a key with changed content is rejected. Request bodies are limited to 32 KiB and typed inputs reject unknown fields.
- Public invite/guess contexts never include private Self answers or the Guess answer before that identity commits. Expired/revoked links fail closed. Reverse rounds are restricted to the original inviter.
- Structured friend feedback is aggregated only for the assessment owner. Three independent browser/account identities are not proof of three real people. No synthetic participants or statistics are seeded.
- Pulse snapshots preserve the wording/version/region that was answered; crowd statistics are isolated by version, CN region and Shanghai calendar date. Precise percentages require at least 50 real submitted rows for that instance. Tests use explicit synthetic identities in isolated databases only.
- Account export is allowlisted and excludes hashes/session tokens. Deletion removes user-owned content, the user's contributions elsewhere, and related cached disclosures held under peer idempotency records. Deletion is logical database removal, not a claim of forensic deletion of storage/backups.

## Known release limits

This is a local development/private-pilot backend. Local username/password accounts support password changes, revocation and pre-generated one-time recovery codes. There is no email verification, WeChat identity, email-based recovery, cross-device guest recovery, automatic guest-data cleanup or production consent/retention control panel. Upgrading the current guest to a new local account keeps all records and rotates the session. Login to an existing account with a nonempty guest fails with `409 guest_merge_required` and preserves the guest; explicit preview and confirmation can perform conflict-free transactional merge; conflicts preserve both spaces. See GUEST_MERGE.md.

The question bank is Chinese. Locale `en` may be saved as a preference but does not imply translated measurement content. Keep existing bank versions immutable; changing measurement meaning requires a new version and a deliberate migration/read-compatibility policy. Ambiguous source question FRIEND-D1-A is retained as inactive and never assigned.

The daily 30-question schedule uses Gregorian CE ordinal day modulo 30 plus one, in Asia/Shanghai. `AppConfig.fixed_date` is injectable by in-process tests; there is no production clock manipulation endpoint. Group-comparison and Solo claims are withheld when evidence is insufficient.

TLS termination, production trusted origins, encrypted backups, durable throttling, operational monitoring, security/privacy review and real auth-provider setup remain deployment gates. No deployment is included.
