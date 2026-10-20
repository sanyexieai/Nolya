# Nolya local MVP API contract

Version: `local-mvp-1`, 2026-10-19. Contract for the Rust Axum backend and TypeScript React frontend. Core API behavior has passed the independent real HTTP tests and actual restart persistence checks in [E2E_RESULTS.md](E2E_RESULTS.md). That report defines the verified scope; untested endpoints and edge cases are not implied to pass. Read `DELIVERY_PLAN.md` for release gates and deferred production capabilities.

## Conventions

- Base path `/api/v1`; JSON keys `snake_case`. No `{data: ...}` wrapper. Choices are exactly `"A" | "B"`; dimensions `"D1" | "D2" | "D3" | "D4"`.
- Current implementation returns `200` for successful reads, creations and updates; successful deletion/logout returns `204`. Clients must not require `201` for creation. Times are RFC3339 UTC; dates `YYYY-MM-DD`. Opaque IDs are strings. Public links contain opaque tokens, never user IDs or answers.
- Frontend uses same-origin `/api`, with Vite proxy in development, `credentials: "include"`. Production wildcard credentialed CORS is forbidden.
- Every response containing user data or tokens: `Cache-Control: no-store`. Public invitation/guess responses also use `no-store` and must never contain hidden answers.
- Session cookie: opaque server-generated >=256-bit token; HttpOnly, SameSite=Lax, Path=/, Secure under HTTPS. Database stores a digest, not the raw token. Guest lifetime 30 days; registered sessions 30 days. Expiration is enforced when read.
- GET `/session` does not create users. POST `/session/guest` is the bootstrap exception to CSRF and requires a configured allowed Origin and JSON. Login without an existing session also requires that Origin but no CSRF; login with a session and all other writes require `X-CSRF-Token` plus strict same-origin validation. No state-changing GET.
- Mutating domain requests must send `Idempotency-Key` (UUID or 16–128 ASCII characters from letters, digits, `-`, `_`, `:`, `.`). Uniqueness scope is authenticated identity + method + concrete route + key. Store canonical-body digest and successful response in the same transaction. Same key/body replays; same key/different body returns `409 idempotency_conflict`. Identity merge invalidates affected non-Self response bodies while retaining their guards; same-body replay then returns `409 idempotency_stale`, requiring a refreshed view and a new request key. Natural unique constraints remain authoritative even with different keys. Auth/session changes and `/me` profile/delete currently do not use idempotency records; all Self/Friends/Pulse/Guess mutations require the header. Sending the header on `/me` is harmless but is not a guarantee of replay after account deletion.
- Errors: `{"error":{"code":"validation_error","message":"请完整回答 8 道题","details":null}}`. Optional details is an object of validation fields, never secrets or SQL. UI localizes stable codes; server message is a fallback.
- Main statuses: `400/415/422 invalid_json` for malformed JSON/extraction, `401 unauthenticated|invalid_credentials`, `403 forbidden|csrf_invalid|self_response_forbidden`, `404 not_found`, `409 conflict|already_answered|already_submitted|idempotency_conflict|idempotency_stale|cohort_full|username_taken|guest_merge_required|merge_preview_stale|merge_preview_expired`, `410 invite_expired|invite_revoked`, `422 validation_error|invalid_username|weak_password` (answer-set/source validation uses `validation_error`; invalid choice enum uses `invalid_json`), `429 rate_limited`, `500 internal_error`, `503 unavailable`. Unauthorized object access should generally look like `404 not_found`.
- Body limit 32 KiB; reject unknown question IDs, duplicate IDs, extra answers, invalid enum values, incompatible versions, and missing answers. Do not trust owner IDs or scores supplied by clients.
- Current shipped catalog and UI are `zh-CN` only. Session/profile accepts and stores `locale: "zh-CN"|"en"` for future support, but it does not translate the current API; question responses identify `locale:"zh-CN"`. `?locale=en` is not an implemented translation contract. A future locale layer must change text only, never question IDs, saved choices, dates, or scoring.

## Shared objects

```ts
type Choice = 'A' | 'B';
type Dimension = 'D1' | 'D2' | 'D3' | 'D4';
type User = {
  id: string; kind: 'guest' | 'registered'; username: string | null;
  display_name: string; locale: 'zh-CN' | 'en'; region: 'CN';
};
type Session = { user: User | null; csrf_token: string | null };
type Question = {
  id: string; version: string; dimension: Dimension | null;
  prompt: string; choice_a: string; choice_b: string;
};
type SavedAnswer = {
  id: string; question_id: string; choice: Choice; answered_at: string;
};
type SelfResult = {
  id: string; version: string; created_at: string;
  answers: SavedAnswer[];
  dimensions: Array<{
    dimension: Dimension; score: -1 | 0 | 1;
    label: string; state: 'stable' | 'contextual';
  }>;
  observations: string[]; // max 2 stable observations + 1 contextual note
  summary: string;
  target_dimensions: Dimension[]; // exactly 3, frozen for this assessment
};
type ShareLink = {
  id: string; token: string; url: string; expires_at: string;
};
```

`User.id` is safe only in the owner's private session response; omit it from public invitation contexts. `SavedAnswer.id` is an owner-scoped source reference, never a grant of access. All labels and question text come from versioned server-side content.

## 1. Session and real local accounts

| Method | Path | Input | Output |
|---|---|---|---|
| GET | `/health` | none | `{status:"ok",version:"local-mvp-1"}`; no secrets |
| GET | `/session` | none | `Session`, unauthenticated is null fields |
| POST | `/session/guest` | `{locale?:"zh-CN"|"en"}` | `Session`; reuse valid current session |
| POST | `/auth/register` | `{username,password,display_name?}` | `Session`; upgrades guest in place, rotates session |
| POST | `/auth/login` | `{username,password}` | `Session`; rotates session; guest migration described below |
| POST | `/auth/logout` | `{}` | `204`, revokes session and clears cookie |
| PATCH | `/me` | `{display_name?,locale?}` | `{user:User}` |
| GET | `/me/export` | none | current owner's portable JSON data, excludes password/session hashes |
| DELETE | `/me` | `{confirmation:"DELETE"}` | `204`; remove account and owned/private data, revoke invites and sessions |

Local account usernames: normalized lowercase ASCII `[a-z0-9_]{3,32}`; display name 1–40 Unicode characters, plain text; password 12–128 characters. Passwords use Argon2id with per-password salt, never logs/echoes. Generic invalid-credentials error and login rate limiting. Registration is a deliberate development/pilot adaptation, not email verification or WeChat login. There is no password recovery in this build. Display that limitation before registration; do not offer fake OTP/reset success. Password entry belongs only to the user's app UI, never support/chat.

Registration preserves the existing user ID and every guest record. Ordinary login still returns `409 guest_merge_required` when the current guest has records; it never silently switches away. An explicit two-step flow supports conflict-free, all-or-nothing migration. Both endpoints require the active guest session, Origin and CSRF.

| Method | Path | Input | Output |
|---|---|---|---|
| POST | `/auth/merge/preview` | `{username,password}` | `MergePreview`; verifies destination credentials without switching identity |
| POST | `/auth/merge/confirm` | `{merge_token,confirmation:"MERGE"}` | `Session`; atomic transfer and guest-session revocation |

```ts
type MergePreview = {
  can_merge: boolean; merge_token: string | null; expires_at: string | null;
  target: {username: string; display_name: string};
  summary: {self_assessments: number; pulse_answers: number; friend_responses: number;
    friend_reservations: number; friend_invites: number; guesses: number; guess_links: number};
  conflicts: Array<{code: string; count: number; message: string}>;
  notice: string;
};
```

Preview only stores a hashed, session-bound, five-minute approval token when there are no conflicts. No product data, ownership, login session or destination settings change. Confirmation must exactly match `MERGE`. Its single-use token binds both identities and a fingerprint of their relevant product records. Any intervening product change returns `409 merge_preview_stale`; missing, expired or differently bound tokens return `409 merge_preview_expired`. Failed confirmation preserves both identities and the guest session.

Conflict policy: block the whole merge for overlapping Pulse dates (even identical choices), duplicate Friend cohort participation/reservations, duplicate Guess participation in one round or the same underlying answer, cross-identity interactions that would become self-feedback/self-guess, targeted self-Reverse, duplicate reverse ownership for one parent, or colliding idempotency scope/key pairs. Return explicit conflict counts and no token. There is no silent overwrite, discarded vote, excluded interaction or partial success. This bounded policy supersedes the initial unimplemented existing-answer-wins proposal. See [GUEST_MERGE.md](GUEST_MERGE.md).

Successful confirmation retains record IDs, immutable snapshots, creation times, Self/cohort bindings, links and expiry/revocation state, updating ownership and participation/Reverse target references transactionally. Destination profile and credentials remain unchanged; shared links will show the destination display name. Idempotency keys and fingerprints move with the source identity. Immutable `self.create` snapshots remain replayable; other affected response bodies are scrubbed and marked invalidated. Replaying an invalidated key returns `409 idempotency_stale`, while changed-body replay still returns `409 idempotency_conflict`. Unrelated peers’ cache records are retained. The empty guest identity and all guest sessions are removed; a fresh destination Cookie/CSRF is issued. Other destination sessions remain valid. A consumed token cannot repeat migration; after a lost response, clients should refresh `/session` before attempting authentication again.

Export uses a field allowlist, excludes authentication secrets and peers' raw user IDs from interaction rows, and is not an implemented import/restore format. Deletion removes the owner's Self/Pulse content, invitation cohorts and owned guess rounds; removes their friend submissions and guesses from other owners' aggregates. Related cross-identity idempotency caches containing the deleted owner's disclosures are purged before deleting source records. Other people's own answers are not deleted. Export/deletion are product requirements; a release without them must be labeled local development only.

## 2. Self

| Method | Path | Input | Output |
|---|---|---|---|
| GET | `/self/questions` | none; current catalog zh-CN | `{version:string,questions:Question[]}`: exactly 8 |
| POST | `/self/assessments` | `{version:string,answers:[{question_id,choice}]}` | `SelfResult` |
| GET | `/self/latest` | none | `SelfResult | null` |
| POST | `/self/assessments/{id}/feedback` | `{rating:"very_like"|"somewhat_like"|"not_like"}` | `{saved:true}`; owner only; one latest rating |

Question IDs are the eight `SELF-D{1..4}-{01,02}` source IDs. Each dimension is `(signed_answer_1 + signed_answer_2) / 2`, A=+1/B=-1. The source bank version is recorded. The server chooses target dimensions: stable dimensions first, deterministic priority D1,D2,D4,D3, then contextual dimensions if needed. Four stable dimensions therefore select D1,D2,D4. Result summaries are deterministic templates, never inferred beyond the answers.

The current frontend keeps unfinished Self answers only in component memory. Previous/Next and an in-page failed submit retain them; leaving the route or refreshing clears them, and this must be disclosed before answering. No sessionStorage/localStorage draft is promised, preventing leftovers from being shown to another account. They are not a saved result until POST succeeds. Changing an answer before submission is allowed. A new completed assessment is a new immutable snapshot; existing friend cohorts stay bound to their original assessment. The latest mirror selects the latest assessment and never mixes old-cohort judgments.

## 3. Friends invitation and respondent flow

| Method | Path | Input | Output |
|---|---|---|---|
| POST | `/invites` | `{self_assessment_id:string}` | `ShareLink` plus `{type:"friends",completed_count:0,max_respondents:3}` |
| GET | `/invites` | none | `{invites:Array<ShareLink & {status,completed_count,self_assessment_id}>}`; owner only |
| DELETE | `/invites/{id}` | none | `204`; owner revoke; does not erase already-consented answers |
| GET | `/invites/{token}` | none | public `FriendContext` below; no private Self answers |
| POST | `/invites/{token}/start` | `{consent:true}` | `FriendSession` below |
| POST | `/invites/{token}/responses` | `{session_id,answers:[{question_id,choice}]}` | `{submitted:true,completed_count:number}` |
| GET | `/mirror` | optional `self_assessment_id` owned by caller | `Mirror` below |

```ts
type FriendContext = {
  type: 'friends'; owner_display_name: string;
  status: 'active' | 'expired' | 'revoked' | 'full';
  completed_count: number; max_respondents: 3;
  already_submitted: boolean; is_owner: boolean;
  privacy_notice: string;
};
type FriendSession = {
  session_id: string; question_bank_version: string;
  questions: Question[]; // exactly 3, server allocated and frozen
  already_submitted: boolean;
};
type Mirror = {
  self_assessment_id: string | null;
  state: 'empty' | 'first' | 'partial' | 'full';
  completed_count: number; required_count: 3;
  respondent_basis: 'distinct_sessions';
  identity_notice: string; // browser/account distinction, not proof of three humans
  target_dimensions: Dimension[];
  comparisons: Array<{
    dimension: Dimension; self_score: -1 | 0 | 1; self_label: string;
    a_count: number; b_count: number; sample_size: number;
    friend_label: string | null;
    consensus: 'insufficient' | 'moderate' | 'strong';
    relation: 'insufficient' | 'contextual' | 'aligned' | 'gap';
  }>;
  insights: string[];
};
```

Expired or revoked Friend/Guess GET and POST fail closed with `410`; they do not return context or a past reveal. The status enum describes active/list data, not permission to expose expired content. Consent copy before start must explain that structured answers are sent to the inviter as an aggregate; with a single participant the first view can still reveal their individual perspective. No name/avatar needed; use `TA` when display name absent. No free-text feedback. Do not claim anonymity from the inviter or from the operator. The owner may not respond to their own invite.

One cohort per Self assessment, three slots total. Repeated invitation creation returns the active cohort, rather than creating duplicate scoring cohorts. Sharing the same link is sufficient; revoke then recreate must preserve respondent uniqueness for that assessment. Reserve a distinct parallel variant only on authenticated POST `/start`, atomically. Repeating `/start` returns the same session. Unsubmitted reservations older than 30 minutes may be reclaimed on a later start; submitted variants are never reassigned. Preferred first-three variants B,C,D for every selected dimension; never activate ambiguous `FRIEND-D1-A`. Commit exactly three server-assigned answers in one transaction. Same respondent cannot contribute twice even via different invite tokens. Unique browser/account identities do not prove unique real people; private-pilot UI must explicitly disclose this limitation.

At one/two responses, show exact observed counts and independent perspectives, not a group consensus or meaningful gap claim. Full mirror at three distinct accepted respondents uses 2/3 moderate, 3/3 strong; alignment/gap additionally requires stable Self score and compatible versions. Use counts (`2/3`), not fake precision. Fourth/unmeasured dimension stays absent. Owner-only aggregated results; no raw per-respondent matrices or identity lists in this MVP.

## 4. Daily Pulse, journal and Solo pattern

| Method | Path | Input | Output |
|---|---|---|---|
| GET | `/pulse/today` | none | `PulseResult` with answer/statistics absent before answering |
| POST | `/pulse/{id}/answers` | `{choice:"A"|"B"}` | `PulseResult`, server-confirmed save |
| GET | `/journal` | `?limit=20&cursor=...` | `{entries:JournalEntry[],next_cursor:string|null,total:number}` |
| GET | `/solo` | none | `SoloResult` below |

```ts
type Crowd = {
  sample_size: number; mode: 'insufficient' | 'qualitative' | 'percentage';
  majority: Choice | 'tie' | null;
  a_percent: number | null; b_percent: number | null;
};
type PulseResult = {
  id: string; date: string; region: 'CN'; timezone: 'Asia/Shanghai';
  question: Question; topic: string;
  answer: SavedAnswer | null;
  crowd: Crowd | null; // null before answer, including sample size
  saved_count: number;
};
type JournalEntry = {
  answer_id: string; pulse_id: string; date: string;
  question: Question; choice: Choice; answered_at: string;
  share_eligible: boolean;
};
type SoloResult = {
  answered_days: number; required_days: 7; eligible: boolean;
  window_start: string | null; window_end: string | null;
  most_different: {entry:JournalEntry,same_choice_percent:number,sample_size:number} | null;
  most_aligned: {entry:JournalEntry,same_choice_percent:number,sample_size:number} | null;
  self_comparison: {dimension:Dimension,kind:'echo'|'gap',evidence_count:number,text:string} | null;
  notice: string;
};
```

One immutable answer per user + region + scheduled date instance. Repeated same choice returns original saved result; different choice returns `409 already_answered`. GET is unable to leak distribution before current user submits. Reject stale POST after day rollover with `409 pulse_expired`, retaining UI selection and offering today's question. Daily scheduling uses configured CN/Asia-Shanghai date, not browser time. The 30 source questions cycle deterministically with `index = date.num_days_from_ce().rem_euclid(30) + 1`, resolving `PULSE-{index:02}`; each date is a separate Pulse instance and cohort. Clock is injectable in tests; never seed invented historical user answers.

Today, Journal and Guess read the immutable question snapshot saved with the Pulse answer; later catalog text must not reinterpret it. Crowd data is scoped by region, pulse date/instance, and question version. N=0: no majority; N<50: percentages null, use qualitative count wording only; N>=50: real rounded percentages, B=100-A. Public results mean participants in this instance, never “all people,” “global population,” or scientific representativeness. Sample count is genuine. Friends-only and age-cohort statistics are deferred until consented relationships and sufficient data exist.

Solo pattern uses the latest seven distinct answered dates (not a consecutive streak); eligible only when seven exist. Label the actual date window. Most different/aligned need real cohort N>=50; otherwise null and an honest insufficient-data notice. Self echo/gap needs the earliest stable Self assessment that existed before midnight Asia/Shanghai at the start of the observed date window (converted to UTC for comparison), and >=2 semantically mapped Pulse observations all in one direction; mixed directions produce no claim. Untagged topics never map automatically. Pulse never updates Self. No fake sample or invented seven-day preview in real user routes.

## 5. Guess and reverse

| Method | Path | Input | Output |
|---|---|---|---|
| POST | `/guesses` | `{source_type:"self"|"pulse",answer_id:string}` | `ShareLink` plus `{source_type,status:"active"}` |
| GET | `/guesses` | none | `{rounds:Array<ShareLink & {status,guess_count,created_at}>}`; owner only |
| GET | `/guesses/{token}` | none | `GuessContext` below; answer hidden unless this caller already guessed |
| POST | `/guesses/{token}/answers` | `{choice:"A"|"B"}` | `Reveal` below |
| POST | `/guesses/{token}/reverse` | `{choice:"A"|"B"}` | `ShareLink` plus `{source_type:"reverse",status:"active"}` |
| DELETE | `/guesses/{id}` | none | `204`; owner revoke |

```ts
type GuessContext = {
  id: string; owner_display_name: string; question: Question;
  status: 'active' | 'expired' | 'revoked'; is_owner: boolean;
  already_guessed: boolean; reveal: Reveal | null;
};
type Reveal = {
  guessed_choice: Choice; actual_choice: Choice; correct: boolean;
  relationship: {
    correct_count: number; total_count: number;
    display_mode: 'getting_started' | 'counts' | 'ratio';
  };
  can_reverse: boolean;
};
```

Create requires ownership of a real immutable saved answer; no client-supplied actual answer on standard creation. Snapshot question ID/version and owner choice server-side. Friend and Guess links currently expire after seven days. `ShareLink.id` equals its opaque token in this implementation, so DELETE may use that returned `id` or `token`. A guesser sees prompt/options but no answer anywhere in HTML, source, JSON, URL or previews until their successful submission. Owner may not guess their own round. One guess per identity/round, transactionally enforced; identical repeated choice returns same reveal, changed choice returns `409 already_submitted` without changing history. Guess is consensual disclosure: owner explicitly shares selected answer by creating a challenge and peer consents by guessing; no unrelated relationship history is disclosed.

Reverse requires this user to have submitted the parent round. It records their own actual A/B choice on the same versioned Self/Pulse question as a standalone reverse source answer, then issues a new round owned by this user. It does not complete Self or count as Daily Pulse participation. Link `parent_round_id`; restrict reverse to the original owner as target where identity remains available. New guests can reverse without finishing eight questions. All constraints and answer hiding apply identically. The choice sent to reverse is the new owner's answer, never a guess on the prior owner.

Directional relationship stats count distinct underlying saved source answers between the pair, not repeated invite-token creation for the same answer. <3: “还在摸清彼此”; 3–5: correct/total counts; >=6: measured ratio/counts allowed, no psychological index. Neutral text, no moral verdict. No public leaderboards.

## 6. My Space

GET `/space` (authenticated):

```ts
{
  user: User;
  self: {completed:boolean,assessment_id:string|null};
  daily: {saved_count:number,answered_today:boolean,latest_answer_id:string|null};
  friends: {completed_count:number,state:'empty'|'first'|'partial'|'full'};
  guesses: {created_count:number,received_count:number};
  guest_expires_at:string|null;
  capabilities: {can_invite:boolean,can_guess:boolean,can_register:boolean};
}
```

Only real persisted counts. No social activity implies zero; no sample fixture fallback. Account signup is optional and cannot block Today or existing guest results. This build allows guests to create a limited cohort and guesses so the complete loop is testable; production quota/identity policies are a separate release decision.

## 7. Minimum verification matrix

1. New session -> 8 real Self answers -> deterministic four-dimension result; restart backend -> result still present.
2. Owner invitation -> three separate browser identities, three allocated variants -> 1/2/3 mirror state transitions; same identity cannot contribute twice; owner blocked.
3. All A Self D1 and friend B/C/D all A -> alignment 3/3. Self D2 A/A; friends B/B/A -> gap 2/3. Self mixed -> contextual, never gap.
4. FRIEND-D1-A inactive; raw letter comparison cannot bypass polarity metadata.
5. Pulse before answer has no crowd object; after 1 answer percentages null; at 49 null, at 50 genuine distribution; cross-region/day/version not mixed.
6. Guess GET has no actual choice; after valid submission reveals; a different guest still cannot see that answer; revoke/expire deny new participation.
7. Guest upgrade preserves Self/Pulse/Friends/Guess; existing-account merge verifies conflict handling; failed merge never discards guest state.
8. Every private object rejects another identity; CSRF and bad Origin blocked; secrets absent from logs/API; invalid enum/duplicates/extra answers rejected.
9. Parallel duplicate submissions and idempotency replays create exactly one durable row and count.
10. Empty/error/loading views never show sample people, scores, history, or fake success.

## 8. Verification snapshot (2026-10-19 local initial delivery)

- Independent real HTTP E2E and actual stop/restart against the same isolated SQLite passed: [E2E_RESULTS.md](E2E_RESULTS.md)
- Later independent targeted HTTP safety/data-integrity checks passed all 18 groups: [SECURITY_REVIEW.md](SECURITY_REVIEW.md). This added coverage for authenticated-login CSRF, targeted reverse access, duplicate-source relationship scoring, deleted-peer/cache cleanup, stored question snapshots, region/version cohorts, earlier Solo baseline, safe guest merge refusal, export, and expired Guess/session access
- Rust: 9 tests and Clippy with warnings denied passed. Frontend: TypeScript + Vite production build passed
- Real browser UI interaction/visual/responsive validation is blocked and not run; no browser acceptance is claimed. Exact environment blockers and remaining scope are in DELIVERY_PLAN

Fresh login without a session is Origin-only; login with a current session requires that session's CSRF, as enforced in `backend/src/core.rs`. Origin is required and must exactly match the configured allowlist on every mutation, including guest bootstrap. These checks do not prove production readiness or verified distinct human participation.


## 0.2 产品化增量

账户维护接口详见 AUTH_SECURITY.md。所有注册账户 DELETE /me 需 `{confirmation:"DELETE",password:"当前密码"}`；访客不需要密码。

- GET `/self/history?limit=20&cursor=评估ID`：`assessments,next_cursor,total`，按创建时间及内部顺序倒序，游标必须属于当前身份。
- GET `/journal?from=YYYY-MM-DD&to=YYYY-MM-DD&choice=A&limit=20&cursor=日期`：起止均含当天，选项 A/B 可选；total 为筛选后总数；游标仅限制当前页，不改变总数。
- GET `/invites?limit=20&cursor=token` 与 `/guesses?limit=20&cursor=token`：原数组字段之外返回 `next_cursor,total`，默认20、最多100，私有稳定分页。朋友邀请增加 created_at。
- GET `/health/live`：进程存活；GET `/health/ready`：数据库可查询。它们不证明公网/TLS或业务健康。

以上路径均在 `/api/v1` 下。

- GET `/api/v1/journal/entries/{id}`：获取单条本人历史日记，不受最近100条选择器限制；他人或已删除 ID 返回404。
