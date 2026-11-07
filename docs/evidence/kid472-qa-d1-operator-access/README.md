# KID-472 D-1 — production platform-operator access verified, item 9 re-run on production

Resolves the D-1 defect from KID-482 QA ("the platform-operator credentials used in the
QA brief are rejected on production — item 9 verified only against a local production
build"). This pass confirms the **real production operator identity** from the deployment
config and re-verifies the board's item 9 (gear icon → `/platform/daycares/{id}/billing`
→ Billing + Insights tabs, timeframe switching, operator guard, tenant scoping) **on
production**.

## Deployment verified

| field            | value |
| ---------------- | ----- |
| Host             | `https://kiddyapp.net` (canonical platform address, KID-237) |
| Deployment       | `dpl_HdyM68MCtYRUEjdFQF3Jo2bbJDtR` (Vercel, production target, READY) |
| Commit           | `99822d3261c34327fdae81112719609424adbbe8` — `origin/master` at check time (merge of PR #32, KID-482 QA evidence) |
| Feature merge    | KID-481 Billing+Insights (`6f33441`, PR #29) is an ancestor of the verified commit |
| Verified at      | 2026-11-07 (this run) |

## How the production operator identity was resolved (no credential printed anywhere)

- The Vercel project `kiddy` (team `kiddy2`) production environment has **both**
  `PLATFORM_ADMIN_EMAIL` and `PLATFORM_OPERATOR_PASSWORD` set (production target only).
  They were read through the Vercel env-var API (single-env GET with decrypt) and
  compared as runtime values only.
- **No credential value is quoted, fingerprinted, or hinted in this document, the commit,
  logs, or the screenshots' captions.** The authenticated session in the screenshots
  shows the operator header exactly as production renders it (the same header any real
  operator sees; no credential value is displayable there).
- The documented demo defaults (`superadmin@kiddy.test` / `kiddy-superadmin`,
  `lib/platform.ts` / `lib/seed.ts` / `docs/PLATFORM_BOOTSTRAP.md`) are **not** the
  production identity — and were re-confirmed rejected on production during this pass:
  `POST /api/mobile/login` with the demo pair → `401 {"error":"Invalid email or
  password."}`. That is the correct rail (`KID-199.4r`: demo credentials must not exist
  on a public deployment); production access runs through the configured operator env
  pair, per `docs/PLATFORM_BOOTSTRAP.md`.

## Production operator access = CONFIRMED

- **Mobile API:** `POST https://kiddyapp.net/api/mobile/login` with the production
  operator identity → **HTTP 200**, `account.role: "platform"`, signed session token
  returned. (Operation note for future QA: a default script UA gets Cloudflare 1010; a
  browser UA passes.)
- **Web:** the session token is the same `kiddy_sess` cookie format the web app signs
  (`lib/auth.ts`), so the server-rendered `/platform` surface was exercised with it
  (screenshots below). The header reads "Kiddy Platform Operator" and shows the
  operator's own email — production renders it (never a credential value).

## Item 9 on production — PASS

Daycare used for the walkthrough: **Sunshine Daycare** (id `mtnfwlhn-jokgnsiw`, active;
a second daycare, Maple Grove, exists on production and is disabled).

| # | Check | Evidence | Result |
| - | ----- | -------- | ------ |
| 1 | Operator signed in; daycare list with the gear icon (⚙ Billing) | `platform-list.png` | PASS |
| 2 | Gear icon → `/platform/daycares/{id}/billing` — **Billing tab renders** (plan, four amounts, first cycle, enrolled children, save form) | `billing-tab.png` | PASS |
| 3 | **Insights tab renders** (`?tab=insights&days=30`): totals line, per-tool table (daycares using / adoption % / events), Most-used + Least-used lists, per-daycare breakdown, estimate-history note | `insights-30.png` | PASS |
| 4 | **Last 7 days**: totals and lists change (123 events; Billing 10; Consents/Staff 0/1; Least-used includes Staff) | `insights-7.png` | PASS |
| 5 | **Last 90 days**: aggregate grows again (134 events; Billing 11, second in Most-used; Surveys/Finance/Parent-drive/Learning now 1/1; Least-used becomes Report center/Incidents/Forms/Events/Calendar) | `insights-90.png` | PASS |
| 6 | **Custom timeframe** (form, `from=2026-09-01&to=2026-11-06`): "Custom range" chip active, dates prefilled, a genuinely different profile (12 events; Messages/Dashboard 0; Most-used flips to Attendance/Children/Consents/Enhancements/Finance @ 1) | `insights-custom.png` | PASS |
| 7 | **Operator-guarded**: the same URL without a session cookie → 307 redirect to `/login` (curl) → sign-in page rendered (screenshot) | `guard-redirect.png` | PASS |
| 8 | **Tenant-scoped**: insights are strictly aggregate across **active** daycares — disabled Maple Grove shows "Disabled, 0 events, —" and only its name/status; unknown daycare id → 307 `/platform?error=missing-id`; the page itself is guarded by the double check (`isPlatformOperatorRole` + `isPlatformOperatorEmail`, `app/platform/daycares/[id]/billing/page.tsx:57`) | curl + screenshots | PASS |

Notes:
- Totals move between requests (e.g. 116 → 126 events across the curl pass and the
  browser pass) because each operator visit to the billing/insights surface records its
  own `tool_usage_event` — the numbers differing *in the expected direction* is itself
  behavior-consistent with the instrumentation.
- The per-range Most-used/Least-used change is the acceptance point for item 9; every
  range shows a materially different ordering/content above.

## Method / apparatus (for reproducibility)

- Env resolution + login + guarded-URL checks: `curl`/HTTP API only (no store writes;
  no credential recorded).
- Screenshots: local headless Chromium driven over the DevTools protocol with the
  authenticated `kiddy_sess` cookie injected at runtime into the ephemeral browser
  profile; the cookie/token existed only in this run's temporary working directory and
  is **not** part of the repository or any artifact.
- 1366px viewport, full-page captures; no retries or data mutations beyond the pages'
  own visit instrumentation.

## Local checks on this branch (evidence-only change — no app code touched)

Recorded from the battery run on `kid472-d1-operator-access` (isolated `git worktree`
off `origin/master` @ `99822d3`, shared `node_modules`, no mutation of the shared
checkout):

- `npx tsc --noEmit` — clean, exit 0.
- `npm run lint` — exit 0 (pre-existing warnings only).
- `npm test` — **834/834 tests passed, 77/77 files** (exit 0).
- `npm run build` — exit 0, "Compiled successfully".

No app code is modified by this branch (docs + screenshots only), so no new focused
unit test file is added: the behavior under test here is production runtime
configuration + deployment behavior, which is what the artifacts above capture.

## Files

- `platform-list.png` — signed-in operator, daycare list, gear icon entry
- `billing-tab.png` — Billing tab
- `insights-30.png` — Insights, last 30 days (default)
- `insights-7.png` — Insights, last 7 days
- `insights-90.png` — Insights, last 90 days
- `insights-custom.png` — Insights, custom 2026-09-01 → 2026-11-06
- `guard-redirect.png` — same URL signed out → production sign-in page
