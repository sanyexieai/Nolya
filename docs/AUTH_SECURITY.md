# Local account security

Nolya accounts use local username/password authentication, not email identity. There is no email password reset or operator backdoor. Passwords are Argon2id hashes with independent random salts. Sessions and recovery codes use OS-generated 256-bit secrets; the database stores only their SHA-256 digests. Never log request bodies, cookies, recovery codes, or password fields.

## API contract

All mutation requests require an allowlisted `Origin`. Authenticated mutations require the current `X-CSRF-Token`. JSON rejects unknown fields.

| Endpoint | Body | Successful result |
| --- | --- | --- |
| `POST /api/v1/auth/password` | `current_password`, `new_password` | 200, new session envelope and cookie; every previous session and recovery code invalidated |
| `POST /api/v1/auth/logout-all` | No body | 204, all account sessions revoked and browser cookie cleared |
| `POST /api/v1/auth/recovery-code` | `current_password` | 200, `{recovery_code, shown_once:true}`; replaces any previous code |
| `POST /api/v1/auth/recover` | `username`, `recovery_code`, `new_password` | 204; consumes code, changes password, revokes recovered account sessions; does not sign in or switch current guest identity |
| `DELETE /api/v1/me` | `confirmation:"DELETE"`, plus `password` for registered accounts | 204, account data and credentials removed |

New passwords require 12–128 Unicode characters and at most 512 UTF-8 bytes. Password changes reject the unchanged password. Recovery codes must be stored by the user somewhere secure outside this account. They cannot be retrieved later. A lost password and lost recovery code mean the local account cannot be recovered. After password change or recovery, create a fresh code. Generating a replacement invalidates the old code immediately.

Credential verification and password hashing happen outside the database lock, with at most four blocking password jobs. The permit remains owned by the computation even if its HTTP request is cancelled. The transaction revalidates the live session and the exact verified password hash before making sensitive changes, preventing stale verification from overriding concurrent changes. Recovery uses a compare-and-swap transaction, so concurrent attempts can consume the code only once; a failed database transaction does not consume it.

Sessions expire after the configured lifetime (default 30 days, accepted range 1–30). Issuance removes expired sessions and retains at most 20 active sessions per account. Login, password reauthentication and recovery have bounded in-process rate limits; 429 responses include `Retry-After: 60`. No proxy-provided IP header is trusted. At larger scale use a trusted reverse-proxy global/per-client limiter and shared throttling before running multiple backend processes; restart resets these in-memory counters.

## Deployment boundary

Serve the production site on HTTPS, set `NOLYA_COOKIE_SECURE=true`, and explicitly configure the public/allowed origins. Secure cookies add HSTS. Authentication API successes and failures are `Cache-Control: no-store`, with nosniff, CSP, frame denial, and no-referrer headers. Do not cache API responses at the reverse proxy. Protect SQLite and backup files with OS permissions; recovery digests and password hashes are still confidential.

This change does not add MFA, email verification, external identity providers, credential breach checking, centralized distributed throttling, or a completed operational security audit. It does not deploy the application.

## Regression checks

`python3 tests/auth_security_api.py` starts only owned loopback servers with disposable SQLite databases and synthetic identities. It covers wrong-password rejection, CSRF/Origin, password/session rotation, recovery hash storage and export redaction, code replacement and single-use concurrency, guest preservation, all-session logout, reauthenticated deletion, rollback/retry, guest denial, rate limits, non-enumerating recovery errors, and security headers on middleware errors. No supplied server URL or existing database is accepted.
