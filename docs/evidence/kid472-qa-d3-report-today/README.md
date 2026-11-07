# KID-536 — Daily-report "today" is one explicit rule: the UTC calendar day

Closes KID-482 QA defect **D-3 (LOW)**: "the staff daily-report editor defaults to the browser-local calendar day while the parent view defaults to the UTC day. Between midnight and the user's UTC offset the two roles can show different 'today' records."

## The rule (chosen)

**"Today" for every daily-report surface is the UTC calendar day, produced solely by `todayIso()` in `lib/report-dates.ts` and passed explicitly into each surface — the browser (or server) local clock is never consulted for report data.**

- Storage is untouched: `daily_report` rows stay keyed by `(child_id, report_date)` in `YYYY-MM-DD` UTC; no report storage key changes.
- No tenant timezone was introduced: the institute schema has no timezone field, so deriving a tenant-local day would have required storage/schema work beyond this task. UTC is a total order both roles already read consistently and matches the KID-472 item-4 header contract ("All math is UTC so a rendered date never drifts by a day between server and client timezones").
- Authoritative call sites after the fix:
  - Staff editor default `app/portal/children/[id]/page.tsx:78` → `const today = todayIso(); const reportDate = configuredReportDate(searchParams.date, today);`
  - Parent read default `app/child/[id]/page.tsx:64` → identical shape.
  - Client nav `components/DailyReportDateNav.tsx` receives `today`/`maxDate` only via props; its past-day boundary must stay `max(selected, todayIso())` (`recentDatesUpTo`, strip clamp).
  - Save/redirect fallbacks `lib/actions.ts` (`saveDailyReportAction`, status-action redirect) and `lib/mobile-api.ts` (`childSummary`) now call `todayIso()` instead of their own inline `new Date().toISOString().slice(0,10)` copies.

## Defect accounting (why QA saw a divergence)

At the time D-3 was filed, both role defaults on the deployed code already computed the UTC day via `todayIso()`; the rule however lived in **three inline copies** plus the choke point, with drift risk if any copy ever changed. QA's "date-picker 11-06 disabled (today)" sighting traces to the native `<input type="date">` calendar popup, which the browser renders against the **browser-local** clock (the QA operator sat in a negative UTC offset) — browser chrome UI, not app data. The app-data defect class D-3 describes (a role defaulting to a different calendar day) is now structurally impossible on the un-kinked path, and the boundary where "browser-local and UTC dates differ" is pinned by test.

## What changed

- `lib/actions.ts` — `saveDailyReportAction`'s missing/malformed-`reportDate` fallback and the status-action redirect's `statusDate` fallback now come from `todayIso()` (was: a second inline UTC copy).
- `lib/mobile-api.ts` — `childSummary`'s today fallback same unification.
- `tests/unit/kid472-report-today.test.tsx` — new focused suite (below).
- No auth, tenant, billing, or permission behavior changes; no schema changes; no i18n changes.

## Tests (`tests/unit/kid472-report-today.test.tsx`)

Harness: the kid472-daily-report-date-nav mocked-headers pattern (SQLite fixture, `renderToStaticMarkup`; fake clock restricted to `toFake: ["Date"]` so awaited DB calls keep real timers).

1. **The UTC-offset boundary, ruled explicitly**: at instant `2026-03-09T00:30:00Z`, an America/New_York browser shows calendar day `2026-03-08` (computed through `Intl.DateTimeFormat` with an explicit `timeZone`, so the assertion is runner-timezone-independent) while UTC has crossed to `2026-03-09`. `todayIso()` returns `2026-03-09`, not the NY day.
2. **`recentDatesUpTo` (nav strip) stays anchored on the same UTC day** when a past selection is handed it (strip ends at `max(selected, todayIso())`).
3. **Staff editor and parent read view open the SAME record by default** at the boundary: reports seeded separately for `2026-03-09` and `2026-03-08`; both surfaces render the UTC-day report and neither renders the 03-08 record; both navs carry `max="2026-03-09"`.
4. **Save fallback**: `saveDailyReportAction` with no `reportDate` field writes the UTC day (`2026-03-09`) and nothing to the NY day.
5. **Past-day navigation at the boundary reaches the correct records**: from the UTC day, prev-day = the 03-08 record, rendered identically on both surfaces, and the strip clamps at the past selection (no future chip).

## Checks (on `f2a2035`, run in a clean pinned worktree)

- `npm test`: **80 files, 862/862 passed** (incl. the 5 new focused tests)
- `npx tsc --noEmit`: exit 0
- `npm run lint`: exit 0 (pre-existing `<img>` warnings only)
- `npm run build`: compiled successfully, 66/66 pages generated

## Deployment

- PR #37 was opened from `kid472-report-today` and closed: the parallel KID-494/KID-556 agent pushed unrelated in-flight work (broken `lib/sqlite-schema.ts`) onto that shared branch, failing its Vercel check through no fault of the KID-536 snapshot.
- Reopened isolated: **PR #38** from `kid536-report-today` (exactly `f2a2035`) → merged to master as **`be945d3`** ("Merge pull request #38"). PR checks: Vercel **pass** (deployment completed), Vercel Preview Comments pass, Supabase Preview "skipping" (the documented pre-existing Supabase-project-event ledger state, not a deploy gate — see KID-493 evidence).
- Production auto-deploy: **`dpl_89T1wAK3ikmxR4pGWNWUWZ4uyW7m`** (target production, commit `be945d3`) reached **READY** on the master auto-deploy.
- Production smoke (2026-11-07, immediately after READY): `https://kiddyapp.net` → 200, `https://kiddyapp.net/login` → 200, `https://sunshine.kiddyapp.net` → 200, `https://sunshine.kiddyapp.net/login` → 200.

## Notes

- The native date-input popup will still highlight the browser's local day inside the picker chrome (unchangeable from app code); all app-owned data (selection, `max`, Today chip, saved record) is UTC-routed. Future surface additions should default through `todayIso()`/`configuredReportDate`, never a fresh `new Date()` copy.
- Process note: this issue's worktree was shared with concurrently-running agents, so the full check suite ran in a clean pinned git worktree on the branch snapshot to keep the evidence attributable to KID-536's commit alone (the KID-494 agent's push later confirmed the call was right).
- No credentials, tokens, or secrets appear anywhere in this document, the commits, or the logs.
