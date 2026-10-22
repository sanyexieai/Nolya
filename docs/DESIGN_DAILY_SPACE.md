# Pages 15–18: Daily Pulse, Choice Journal, and My Space

The implementation follows the supplied Page15–18 specifications and the actual Chinese desktop/mobile reference pixels, plus the frozen `Nolya_UI_Design_System_v1_0.md`. All question text, options, saved answers, counts, disclosures, filters, and controls are live React DOM backed by existing APIs. No entire functional screen is rendered as an image.

## Page and asset mapping

Paths below are relative to the extracted design archive's `packages/` directory. Public assets are unchanged copies of the supplied originals; no new photo, face, or photo provider was introduced.

| Page / application state | Public asset | Original source |
| --- | --- | --- |
| 15, `/today` unanswered, desktop | `design/daily-question-desktop-reference.png` | `Nolya_Page15_Daily_Pulse_Codex_Package_v1_0/Nolya_Page15_Daily_Pulse_v1_0/mockups/Nolya_Page15_Daily_Pulse_Desktop_zh-CN_v1_0.png` |
| 15, `/today` unanswered, mobile | `design/daily-question-mobile-reference.png` | `Nolya_Page15_Daily_Pulse_Codex_Package_v1_0/Nolya_Page15_Daily_Pulse_v1_0/mockups/Nolya_Page15_Daily_Pulse_Mobile_zh-CN_v1_0.png` |
| 16, `/today` server-confirmed saved answer | `design/daily-result-riverside.png` | `Nolya_Page16_Daily_Pulse_Result_Codex_Package_v1_0/Nolya_Page16_Daily_Pulse_Result_v1_0/source/assets/nolya_approved_riverside_portrait.png` |
| 17, `/journal` | `design/journal-small-reference.png` | `Nolya_Page17_Choice_Journal_Codex_Package_v1_0/Nolya_Page17_Choice_Journal_v1_0/source/assets/approved_ambassador_small_reference.png` |
| 18, `/space` | `design/space-riverside.png` | `Nolya_Page18_My_Space_Return_Hub_Codex_Package_v1_0/Nolya_Page18_My_Space_Return_Hub_v1_0/source/assets/approved_ambassador_riverside.png` |

The Page15 package contains only composite mockups, locale files, and its specification, not a separate cafe/journal photograph. Consequently only its original artwork window is CSS-clipped from the unchanged reference. This is an explicit source limitation, not a claim that standalone Page15 photography was supplied.

- Desktop: source **1536 × 1024**, artwork **x0–720, y82–972**, window **720 × 890**. The image width is `213.333333%` of the window, left is `0`, and top is `-9.213483%` of the window height.
- At widths up to 760px, mobile: source **941 × 1672**, artwork **x17–927, y153–745**, window **910 × 592**. Image width is `103.406593%`, left is `-1.868132%`, and top is `-25.844595%`.
- Those windows contain only the supplied editorial photo, photo-frame, and decorative handwritten notes. Original navbar, main page headline, A/B controls, and buttons are excluded. All functional equivalents are independently rendered in DOM.
- Pages16–18 supply the same approved riverside persona photograph for distinct uses. Their implementation preserves that original direction: large Page16 result illustration, a small Page17 scrapbook accent, and a secondary Page18 return-hub photo. The photograph is explicitly labeled as brand illustration, never as the signed-in user's avatar or evidence of real respondents.

## Hierarchy and responsive adaptation

`frontend/src/design-daily-space.css` is scoped to `.nolya-daily-design` and `.nolya-space-design`; it does not change auth forms, shared controls, or unrelated routes.

- **Page15:** desktop cafe/journal artwork left and editorial headline plus live question right; mobile artwork first, then headline, real question, explicit submit, and three benefit chips. The actual saved count remains a journal link, not a streak.
- **Page16:** desktop real saved result left and photo/statistics right; mobile actual result precedes photography and crowd statistics. History is the primary next step; optional friend guessing remains secondary. Highlighting comes from the saved A/B value, not the illustrative reference's B fixture.
- **Page17:** headline and retained date/choice filters; real records left and scrapbook right. Mobile places actual records before the scrapbook. The separate server-authorized solo summary remains available below the scrapbook rather than replacing the original editorial structure. Detail expanders revisit the same actual saved answer; pagination keeps active filters.
- **Page18:** a lavender return hero with Today and journal actions; three distinct Self/Daily/Friends source cards, then next-step cards and privacy/identity controls. Mobile stacks these sections and reduces the photo to a secondary accent. Existing invitation managers, revocation confirmations, and account/history/help routes remain intact below.

At 320px, benefit chips and hero actions can stack to avoid overflow. Text uses the frozen purple/lavender/peach/warm-white system; functional copy retains readable darker variants. Selected answer gradients use a darker endpoint than the reference so normal-size white labels retain AA contrast. Touch controls and keyboard-visible selections remain real accessible controls.

## Correctness boundaries and intentional differences

- Page15's prototype includes “换一道看看”. The current backend exposes one assigned question per day and no alternate-question endpoint. No fake question-cycling control or client-only substitute was added. Existing explicit submission and the one-question rule remain authoritative.
- Page16 is the saved state of the existing `/today` route, not a new unauthenticated answer-reference route. Only server-confirmed submission produces a saved state. A failed save keeps the local selection and displays an error; repeated same-tick submissions are guarded.
- Crowd percentages appear only for the server's `percentage` mode with both returned values available. Other modes retain the small-sample explanation and real `sample_size`; no approximate, illustrative, or invented percentages are shown.
- `saved_count` means actual saved choices, not a fabricated streak. No “7-day streak” or fake previous entry is introduced. Solo progress, required-day threshold, time window, and comparisons still come from `/solo`.
- Journal entries, selection, answered dates, total, filters, and cursor pagination come from `/journal`. Per-entry guessing remains gated by returned `share_eligible` and the downstream creation API.
- Space's eight-question completion state, saved choice count, independent friend count, and capabilities come from `/space`. Missing capabilities fail closed. Zero/one/two friends do not imply three-person consensus, and completed records are never inferred from illustrations.
- Guest expiry and cookie-loss warnings remain visible; guest account-save actions are capability-dependent. Registered users do not see an invitation to register again.
- Nothing changes Self/Friends measurement rules, guest security, invitation payload secrecy, account mutation flows, merge confirmations, or link revocation behavior.
- This change preserves the application's current Chinese UI. English source mockups exist, but the application does not advertise a newly implemented English locale.
- Supplied file names using “approved” do not establish a commercial license or model release. The existing supplied-reference rights caveat in `DESIGN_ALIGNMENT.md` still applies.

## Verification

After these changes, TypeScript typecheck and all 76 current frontend tests passed, including actual journal filtering/pagination and invitation management/revocation regressions. Aggregate build, API regression, and expanded browser checks are tracked by the parent release verification record; source-level tests alone are not a claim of pixel-perfect or full cross-browser acceptance.
