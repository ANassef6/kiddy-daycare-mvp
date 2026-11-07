# KID-482 — KID-472 item 10: Independent QA acceptance of all 10 enhancements

Date: 2026-11-07 · Verdict: **PASS WITH DEFECTS** (2 defects raised; adverse findings do not block this gate)
Tester: QA agent (independent — implementation comments were not trusted; everything below was reproduced)
Target: production tenant `https://sunshine.kiddyapp.net` + master check battery
Master under test: `6f33441` (merge of PR #29, KID-481)

## 0. Deployment gate (before anything else)

| Check | Result |
|---|---|
| `origin/master` | `6f33441` — "Merge pull request #29: KID-481 super-admin Billing + Insights page…" |
| GitHub commit status on `6f33441` | `Vercel — success — Deployment has completed` → deployment [`dpl_BPFkcdCQe14Y5hdA1KLSJyyFN8w4`](https://vercel.com/kiddy2/kiddy/BPFkcdCQe14Y5hdA1KLSJyyFN8w4) (same id KID-481 reported READY) |
| Production smoke | `/login` → 200 (1.3 s), all authenticated probes below → 200 |
| Note | The `Supabase Preview` check-run on the merge commit is `failure` — that is the preview-branch check, not the production deploy gate |

Production is serving the merged master state. All live checks below ran against it.

## 1. Check battery on master

Run in an isolated `git worktree` at `origin/master` (branch `kid472-qa`) so the concurrently-held shared checkout was never mutated.

| Command | Result |
|---|---|
| `npm test` (vitest) | **PASS — 810/810 tests, 76 files, 0 failures** (exit 0; duration 2589 s under concurrent load) |
| `npx tsc --noEmit` | **PASS — clean** (0 bytes output, exit 0) |
| `npm run lint` | **PASS — exit 0**; warnings are the pre-existing `@next/next/no-img-element` set only |
| `npm run build` | **PASS — exit 0**; "Compiled successfully", 66/66 static pages |
| `npm run db:verify-migrations` | **PASS — all migration checks passed** |
| Secrets scan (`git grep` for high-entropy tokens/keys on master) | **PASS — none committed**. Remaining `password:` hits are validation copy, the local seed default `kiddy-admin`, and `scripts/setup-mobile-demo.mjs` (local demo helper); the production demo password appears nowhere in the repo |
| EN/AR copy | PASS — suite-wide i18n parity tests green (`kid466`, `kid474`, `kid481`…); live parent pages observed rendering in AR with EN switcher present |
| Auth / tenant isolation regressions | PASS — suite green incl. `kid212` host-gate, `kid372` cross-tenant guards, `kid491` tenant-scoped invoices, audit tenant-scope tests |

## 2. Matrix (PASS/FAIL each)

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Navigation/newsfeed timings, skeleton, no freeze | **PASS** | Authenticated TTFB (this sandbox is off-region; Vercel→Supabase same-region is faster — see kid472-perf). Parent `/child/newsfeed`: cold 2.71/1.63/1.66 s (first hits), warm n=5 **1.49–1.65 s, median 1.51 s**. Staff `/portal/newsfeed`: cold 2.67/3.18/1.86 s, warm n=5 **1.50–1.55 s, median 1.50 s**. SSR HTML contains the `Loading newsfeed` skeleton marker. Real-browser sessions (Skyvern) navigated without freezes; no UI hangs observed. |
| 2 | Notifications: tab, settings, badge, message/report items, sound, push, Chatwoot push | **PASS (push-on-device residual)** | Parent `/child/notifications` 200 with tab, "notification preferences" settings entry, "mark all as read", filter for messages & daily reports, and live items (staff message + daily report + login events). `/child/settings` shows push toggle, in-app sound toggle, preference list. Bell badge: owner portal shows `role=status aria-label="2 unread notifications"` with red count; parent badge absent at count 0 (correct) and lit after the staff reply below (verified in §3). Sound: `/notification-sound.wav` → 200; `NotificationSoundWatcher` polls `/api/notifications/unread` (200, `{"count":…}`). Push: `/sw.js` → 200, `/manifest.webmanifest` → 200, `/api/push/public-key` → 200 (VAPID), `POST /api/push/subscribe` → `{"ok":true}`; fan-out wired in `lib/store.ts` (KID-480). **Residual:** delivery to a physical phone/TWA cannot be exercised from this sandbox (no device) — subscribe/API path verified, end-to-end device receipt not. Chatwoot push: `POST /api/chatwoot/webhook` fails closed with **401 "Invalid webhook secret"** (secret configured on prod, not 503-unset); the Chatwoot-side URL/secret pairing needs Chatwoot admin access we don't have — webhook contract covered by suite tests. |
| 3 | Messaging: parent→staff send, staff→parent reply, thread reply | **PASS** | Parent typed and sent `KID-482 QA parent-to-staff ping` via the real UI composer (Skyvern) — message persisted in the thread (re-read via authenticated GET, timestamp 04:40/04:42 AM). Recipient selector offers classroom staff (bluestaff, Nassef, Sofia Fisher). Staff reply + parent receipt: see §3 (reply leg completed with a second parent message addressed to Sofia Fisher). |
| 4 | Daily report: past date both roles, staff edit/save, parent read-only, today default | **PASS** | Staff (`qa.kid186.staff`, Sofia Fisher): default date = today (date-picker `11-06 disabled (today)` in the browser's local day; parent shell defaults to UTC today `2026-11-07` — see D-3 observation), Prev/Next/date-picker/Today controls present; navigated to 2026-11-05, typed `QA-EDIT-KID472` into Note, Save → **independently re-read via authenticated GET `?date=2026-11-05`: value persisted** plus attribution lines. Parent: same past date renders the staff-edited note (`QA-EDIT-KID472` present), **zero report edit inputs, no Save button** (only the date picker + unrelated forms), attribution line rendered read-only. |
| 5/10 | Audit: inline actor/timestamp on key records; admin audit page filters and scope | **PASS** | Supplies list renders `Created by Nassef · 19 Sept 2026, 15:10` per record; staff report editor + parent report view render `Created by … · …` and `Last saved by Sofia Fisher · Sat Nov 07 2026 04:41 AM` (EN + AR strings in `lib/i18n.ts`). `/portal/audit` (owner) → 200: "Audit trail — Who changed what, and when", filters **From / To / Actor (all actors) / Record type / Apply / Reset**, paginated rows `date · actor · action · entity · summary` (e.g. `6 Nov 2026, 21:35 · Ahmed Refaat · check_in · attendance · …`). Non-admin staff do not get the nav entry; page is admin/owner-gated and tenant-scoped via `resolveTenantInstituteId()` (code + suite's tenant-scope tests). |
| 6 | Support: no manual request form/list; Chatwoot KB/chat works | **PASS** | `/child/support` → 200: zero occurrences of "My requests"/request form/submit-a-request; renders Chatwoot help-center articles (AR) and loads `chatwoot.kiddyapp.net/packs/js/sdk.js` widget (bubble visible in real-browser screenshots). Staff support-inbox surface is not exposed to parents. |
| 7 | Demo account: new email/password web+mobile, name Nassef; old email fails; parent/operator unaffected | **PASS (operator half → D-1)** | Web UI login `trois4ever+admin@gmail.com` → lands `/portal/dashboard`, header shows **Nassef** (screenshot). Mobile API `POST /api/mobile/login` → 200 `fullName: "Nassef"`, `role: owner`. Old email `admin@sunshinedaycare.test` → web shows `Invalid email or password.` (screenshot) and mobile API → 401. Parent `parent@example.test` → 200 (Grace Nguyen) on both hosts — unaffected. **Operator: FAIL/unverifiable — brief's `superadmin@kiddy.test` / `kiddy-superadmin` is rejected in production (D-1); locally-seeded operator with the same credentials works, so the machinery is intact and the production account/credential differs.** |
| 8 | Supplies and Rooms under Children, not Tools, for admins | **PASS** | Owner sidebar order: `Home · Children · Child profile · Attendance · Consents · Supplies · Rooms · Learning · Staff · Tools` — Supplies/Rooms are Children items; the Tools group (report-center, tags, forms, surveys, performance, finance, + owner billing/enhancements) contains neither. Real-browser confirmation from the dashboard run: "Supplies and Rooms are nested under the Children group, not under Tools". Non-admin staff sidebar has no Supplies/Rooms at all (admin-only, unchanged). |
| 9 | Billing/Insights: gear opens page; Billing works; Insights timeframe + per-tool top/neglected | **PASS locally / FAIL to verify in production (D-1)** | Production: cannot authenticate as operator (D-1), so the live gear/billing/insights pages could not be opened — **adverse finding, not converted to blocked**. Local production build (`next build && next start`, seeded SQLite): operator login OK → `/platform` gear link → `/platform/daycares/{id}/billing` → 200 with **Billing + Insights tabs**; Billing tab renders plan/rate form; Insights renders timeframe **Last 7/30/90 days + custom From/To/Apply**, usage totals with estimate banner, per-tool table (Events, Adoption %, daycares using), **Most-used tools** (Billing — 5, …) and **Least-used tools** (Supplies — 0, Report center — 0, …), per-daycare breakdown. Event counts changed across timeframes (10 → 11 → 12) proving the filter is live. |

## 3. Messaging round-trip (item 3 detail) + parent unread badge (item 2)

1. Parent (UI) sent `KID-482 QA parent-to-staff ping` → persisted in the default-recipient thread (dropdown recipients: bluestaff, Nassef, Sofia Fisher; messages re-read via authenticated GET, 04:40/04:42 AM).
2. Parent addressed a second message to classroom staff **Sofia Fisher** (`/child/messages?to=22a36ef0…` + recipient dropdown): `KID-482 QA parent-to-staff ping 3` — persisted (screenshot `parent-send-to-sofia.png`).
3. Staff leg: Sofia Fisher logged into `/portal/messages`, opened the thread with Grace Nguyen (parent@example.test), saw ping 3, and replied `KID-482 QA staff-to-parent reply` — appears in-thread at **05:13 AM**, no error banner (screenshot `staff-reply-sent.png`).
4. Parent receipt (independent re-read): thread contains **both** ping 3 and the staff reply; `GET /api/notifications/unread` → `{"count":1}`; the parent bell now renders the red badge span (`role="status"`, count 1) and `/child/notifications` lists `رسالة من Sofia Fisher … KID-482 QA staff-to-parent reply` as the newest item above the daily-report items. This closes the badge leg of item 2 (badge is hidden at count 0, lit at count 1 — verified both states).
5. Thread reply = replying inside the existing parent↔staff conversation (steps 2–3), not a new thread.

## 4. Defects

### D-1 — Production platform-operator credentials from the QA brief do not authenticate (HIGH)

- **Summary:** `superadmin@kiddy.test` / `kiddy-superadmin` is rejected everywhere on production; matrix items 7(operator half) and 9 cannot be verified live.
- **Preconditions:** production tenant `https://sunshine.kiddyapp.net` (also reproduced on `https://kiddy-one.vercel.app`); account from the KID-482 brief.
- **Steps:** 1. Open `/login`. 2. Enter the brief's operator credentials. 3. Submit. — also `POST /api/mobile/login` with the same pair.
- **Expected:** signed in (operator surfaces `/platform`, gear → Billing/Insights).
- **Actual:** web shows `Invalid email or password.`; mobile API returns 401 `Invalid email or password.` on **both** hosts (two independent paths, plus a real-browser screenshot run).
- **Notes:** the same credentials work against a locally seeded production build; kid472-perf previously logged in with "operator creds from the project's Vercel env", suggesting production's `PLATFORM_ADMIN_EMAIL`/`PLATFORM_OPERATOR_PASSWORD` (or a GoTrue-only account state) differs from the brief. Either the brief is stale or the production account needs fixing/confirmation.
- **Proposed fix/location:** confirm the real production operator credential (Vercel env) or reset the production operator account to the brief's pair; then re-run item 9 against production. Owner: parent issue owner (KID-472).

### D-2 — Intermittent HTTP 500 on `/child/messages` (parent messaging) (HIGH/MED)

- **Summary:** the parent messages page intermittently renders `Application error: a server-side exception has occurred … Digest: 3930614149` (Next.js server-component exception) in a real browser.
- **Preconditions:** signed-in parent session on production; observed while concurrent agent traffic was hitting the tenant (load-related trigger likely).
- **Steps:** 1. Sign in as `parent@example.test`. 2. Navigate to `/child/messages`. 3. Repeat in a real browser.
- **Expected:** thread list + composer render (HTTP 200 — this is what 16+ sequential curl loads returned, incl. a 10-request parallel burst).
- **Actual:** 2 of 4 real-browser loads returned **HTTP 500** with the digest error page (04:22:51 and 04:27:55 UTC); screenshot `screenshots/prod-child-messages-500.png`, console log captured. Same page later rendered fine, and a full send succeeded — so the failure is intermittent.
- **Proposed fix/location:** inspect Vercel function logs for digest `3930614149` around those timestamps; the page (`app/child/messages/page.tsx`) awaits several store calls per render (`threadsForAccountScoped`, `parentMessageRecipients`, optional thread loads) — a transient store/DB error thrown without a boundary surfaces as the 500. Consider a per-section error boundary or retry. Owner: parent issue owner (KID-472) → likely the messaging task (KID-475) maintainer.

### D-3 — Observation (LOW): report "today" default differs by shell timezone

The staff report editor defaulted to the browser-local day (11-06 while UTC was 11-07 04:41) while the parent view defaulted to the UTC day (2026-11-07). Both are "today" from their renderer's clock, but between 00:00 and the user's UTC offset the two roles can disagree about which day is "today". No functional break observed; recorded for follow-up if the board cares.

## 5. Environment limitations (not defects)

- **Physical device / TWA push receipt** and **Chatwoot-side webhook configuration** cannot be exercised from this sandbox; their server-side contracts were verified instead (§2 row 2).
- Timing numbers come from an off-region sandbox; treat them as upper bounds (kid472-perf measured same-region p95 1.33 s post-merge).

## 6. Artifacts

- `screenshots/demo-admin-login-nav.png` — demo admin web login, name Nassef, sidebar IA (item 7/8)
- `screenshots/old-email-login-fails.png` — old demo email rejected (item 7)
- `screenshots/staff-report-past-date-saved.png` — staff past-date edit saved + attribution (items 4/5)
- `screenshots/parent-thread-sent.png` — parent send persisted in thread (item 3)
- `screenshots/parent-send-to-sofia.png` — parent message addressed to Sofia Fisher (item 3)
- `screenshots/staff-reply-sent.png` — staff reply in-thread at 05:13 AM (item 3)
- `screenshots/prod-child-messages-500.png` — D-2 evidence
- Skyvern run ids: operator-login attempt `tsk_594168318493281874`, demo web login `tsk_594174894088212416`, staff report `tsk_594179047321586462`, old email `tsk_594179420983741634`, parent send `tsk_594179081681324838`, parent→Sofia `tsk_594186404600565244`, staff reply `tsk_594187886364281002`, 500 repro `tsk_594176307132451202`
- Check logs: `test` 810/810 exit 0, `tsc` clean, `lint` exit 0, `build` exit 0, `db:verify-migrations` all ok (run on `origin/master` worktree `kid472-qa`)
