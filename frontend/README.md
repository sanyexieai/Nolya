# Nolya Web

Mobile-first Chinese React + TypeScript application for the local Nolya MVP. The Rust API owns questions, scoring, identities, consented responses and durable results. The frontend never substitutes demo counts or sample answers for missing API data.

## Run

Use the repository-level development or production scripts. Frontend-only development:

```sh
npm ci
npm run dev
```

Vite binds to `127.0.0.1:5173` and proxies `/api` to `127.0.0.1:3000`. Configure the backend origin to `http://127.0.0.1:5173` when using Vite. The production build can be served directly by Rust. Node 22.18+ is required for the native TypeScript test runner.

## Implemented routes

| Route | Flow |
|---|---|
| `/` | Chinese homepage, original CSS mirror illustration, first-value entry |
| `/self` | Eight server-provided choices, Back/Next, submit/retry |
| `/self/result` | Saved deterministic result, feedback, invitation and Daily entry |
| `/invite` | Owner invitation generation, copyable share link, disclosure |
| `/friend/:token` | Explicit consent, three assigned questions, submission state |
| `/mirror` | Empty, first, partial and full aggregate views, exact respondent counts |
| `/today` | China-scheduled daily question, immutable answer and genuine cohort result |
| `/journal` | Paginated saved choices, seven-date evidence or honest insufficient-data state |
| `/guess/new` | Select a real saved answer and create a challenge |
| `/guess/:token` | Guess, correct/incorrect reveal, reverse answer and invitation |
| `/space` | Real saved totals, return hub, share/revoke owned links |
| `/account` | Local registration/login, nickname, export, logout, typed deletion confirmation |

Guest registration keeps the current identity. If login to another account cannot merge guest data, the user can export, explicitly leave the guest session and then log in. Guest deletion is available without registration. The export is a JSON backup, not an automatic restoration workflow.

## State and privacy boundaries

- HttpOnly session cookie managed by the backend; no password or access-token storage in localStorage
- Same-origin credentialed requests, current CSRF token on writes, explicit idempotency keys for retriable submissions
- Guest bootstrap is single-flight; sensitive token pages remount when the route token changes
- Self drafts remain only in the mounted page and are discarded when leaving; the UI states this before answering
- Guess source selection is locked while creating the share link; answers remain server-hidden until a successful guess
- No external portrait assets, image requests, fonts, analytics, or fake social counters
- Original abstract CSS illustration preserves the prototype's lilac, warm-white and soft-pink visual direction
- Keyboard-operable A/B radios, visible focus states, loading/errors, consent checks and disabled submit states

## Verification

```sh
npm run typecheck
npm run build
npm test
npm run format:check
```

The native tests cover the actual API client: credentials, CSRF rotation/clear, idempotency, bootstrap exemptions, network and server errors, no-content responses, token encoding and China-date formatting.

Type checking, production build and 11 API-client tests passed in the implementation environment. Actual Chromium navigation, screenshots and responsive browser acceptance remain unverified: Chromium was blocked by the environment's Unix-socket permissions, and the supported elevated path also failed. The repository contains a browser smoke test for a suitable local environment; do not interpret build/tests as a visual or browser-interaction pass.
