# KID-481 — super-admin Billing + Insights page with per-tool usage by timeframe

Branch: `kid472-billing-insights` (from `origin/master` @ `335e65a`).
Worktree: isolated `git worktree` off the shared workspace (shared with the
KID-485 run at the time — zero mutations to the shared checkout).

## What shipped

- `supabase/migrations/0033_tool_usage_event.sql` + mirror in
  `lib/sqlite-schema.ts`: `tool_usage_event` (institute, account, tool_key,
  source portal/child/platform/backfill, occurred_at, bounded metadata) with
  three lookup indexes (institute+when, tool+when, account+when).
- `lib/tool-usage.ts`: 21-key stable tool registry (`TOOL_KEYS`/`TOOLS`),
  best-effort `recordToolUsage` (audit-parity: failure logged, action never
  blocked), `insightsTimeframe` (7/30/90 presets + inclusive custom range,
  fail-closed 30-day fallback, reversed-range clamp), `toolInsights`
  (aggregate-only cross-tenant read: per-tool events + adoption across ACTIVE
  daycares, top-5 most-used, bottom-5 neglected, per-daycare breakdown,
  platform-surface count, no N+1 — 3 grouped reads), and
  `backfillToolUsageEstimates` (19 domain-table rules → ONE estimate row per
  active daycare per tool, dated at the newest related record, labeled
  `{"estimate":true,"historical_rows":n}`; dashboard/report-center never
  seeded with fake stats; idempotent via NOT EXISTS).
- `app/platform/daycares/[id]/billing/page.tsx`: now the tabbed Billing |
  Insights surface behind the gear icon (same URL; `?tab=insights`). Billing
  tab = the KID-244 UI unchanged, same double guard
  (`isPlatformOperatorRole` + `isPlatformOperatorEmail` → `/login`). Insights
  tab renders `insights-view.tsx` (aggregate only, i18n EN/AR, plain GET form
  for custom range so it works without client JS).
- Usage instrumentation: one `recordToolUsage` call in every tool's server
  page — 22 portal pages (incl. learning/activities + learning/homework view
  markers and `account-billing` → billing) and 9 child pages (source
  `child`; institute derived from the family row when the page has no tenant
  variable). Utility surfaces (audit, settings, notifications, inquiries,
  support, tags, performance, account) are intentionally not registry tools
  and stay uninstrumented.
- Gear link (`app/platform/page.tsx:265-273`) unchanged by href — it already
  targets `/platform/daycares/<id>/billing`, which is now the tabbed page
  this issue required (verified by the static pin test).
- i18n: 27 new `platform.*` keys + 21 `platform.tool*` labels, EN + AR,
  parity-pinned.

## Checks (recorded results)

- `npx tsc --noEmit` — clean, exit 0.
- `npm run lint` — only the six pre-existing `<img>` warnings; no new errors.
- `npm run build` — exit 0; route `/platform/daycares/[id]/billing` in the
  server build output.
- `npm test` — 791–793 passed of 793. Two flaky failures appeared only when
  the full suite ran concurrently with OTHER agents' suites on the same host:
  `curriculum.test.ts` observation ordering and a `kid472-audit-trail` hook
  timeout (10s default hook timeout under load). Both files pass in focused
  runs on this branch: `npx vitest run tests/unit/curriculum.test.ts
  tests/unit/kid472-audit-trail.test.ts` → 33/33 passed (exit 0).
- New suite: `tests/unit/kid472-billing-insights.test.ts` — 19/19 passed
  (registry keys/labels, timeframe math incl. clamping + injected SQL-date
  probing, recorder best-effort + variants, aggregation incl. active-only
  adoption + old-event exclusion + platform-surface counting + per-daycare
  breakdown ordering, backfill estimate labeling + idempotency + disabled
  daycare skip, static operator-guard pins on both pages, i18n EN/AR parity
  for all new keys incl. tool labels + banner interpolation).

## Screenshot evidence (platform operator session, local dev server)

Login → gear session: `after-login.png`, `platform-list.png` (gear link),
`billing-tab.png` (Billing tab, unchanged KID-244 form + tab bar),
`insights-tab.png` (Insights tab default 30-day view: timeframe presets,
custom range, totals, per-tool adoption table, Most/Least-used lists,
per-daycare breakdown), `insights-7day.png` (7-day preset). Captured via
Playwright (headless, browserlibs) against `next dev` with a seeded SQLite
fixture; operator login `superadmin@kiddy.test` from `PLATFORM_ADMIN_EMAIL`
bootstrap. Regression caught during QA: labels initially rendered as raw
`toolDashboard` keys (missing `platform.` prefix in the view lookup) — fixed
and pinned by the static test.

## Notes

- No changes to auth, tenant, billing, or permission behavior; billing form
  logic is byte-identical (its render tree only gained the tab bar).
- Aggregate-only: daycare owners never see this page (guards listed above);
  backfill rows are labeled estimates and the UI says so.
