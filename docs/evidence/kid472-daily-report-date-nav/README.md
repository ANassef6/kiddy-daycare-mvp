# KID-476 — KID-472 item 4: daily report redesign with past-day navigation

## Feature

The daily report inside the child profile is now date-navigable for both roles,
built to the existing Kiddy design language (cards, chips, local dict labels).
The board screenshot referenced in KID-472 has no attachment, so visual
refinement to match a specific mock will follow if the screenshot is supplied.

### What changed

1. **Shared date engine** — `lib/report-dates.ts`: pure UTC date helpers
   (`todayIso`, `isIsoDate`, `configuredReportDate`, `shiftIsoDate`,
   `recentDatesUpTo`). Every `?date=` value and hidden `reportDate` field funnels
   through `configuredReportDate`; anything malformed falls back to today, so
   no bogus `report_date` can reach `daily_report` (which is unique per
   child_id+date). No DB/browser/server deps — imported from both surfaces.

2. **Shared date-nav component** — `components/DailyReportDateNav.tsx`
   (client): input[type=date] (max = today, so no future days), ‹/› previous /
   next-day buttons, a Today shortcut badge chip, and a compact strip of the
   last 7 days ending at max(selected, today). Navigation is plain
   `window.location.assign` with `?tab=daily&date=…` on the same page — the
   server components refetch that day's record. The staff editor mounts the
   component with `formId="daily-report-form"`: any edit inside the report form
   arms a dirty flag and navigating away (`window.confirm`) from unsaved
   changes is opt-in. The parent read view mounts without the form guard.

3. **Staff editor** (`app/portal/children/[id]/page.tsx`) — the daily tab
   accepts `?date=`, `reportFor()` runs for the selected date, all existing
   fields kept, hidden `reportDate` carries the selection into
   `saveDailyReportAction`, "Last saved by" line unchanged. The status-log card
   keeps its existing today semantics ("logged instantly") and is unaffected.
   After save, the action redirects back to
   `/portal/children/<id>?tab=daily&date=<saved date>` so the edited day stays
   in view; status-log forms carry `statusDate` the same way.

4. **Parent read view** (`app/child/[id]/page.tsx`) — the daily report card is
   date-navigable and strictly read-only (no report form anywhere), empty days
   show a per-date empty state ("No report for this date yet."), today remains
   the default.

5. **Server actions** (`lib/actions.ts`) — `saveDailyReportAction` now
   validates `reportDate` through `configuredReportDate` (previously any string
   was persisted) and keeps the viewer on the daily tab of the saved date; the
   KID-103 scope guard is untouched. `saveChildStatusAction` returns to the
   viewed date.

6. **Mobile API** — `childSummary(child, reportDate?)` defaults byte-for-byte
   to the today payload; `GET /api/mobile/children/[id]?date=YYYY-MM-DD`
   optionally returns a past day's report in the same `todayReport` field
   (contains `reportDate`). Family-IDOR guard untouched.

7. **i18n** — new keys in BOTH dictionaries:
   `profile.dailyReportForDate / reportPrevDay / reportNextDay /
   reportTodayChip / reportPickDate / unsavedConfirm` and
   `child.reportForDate / noReportForDate / reportPrevDay / reportNextDay /
   reportTodayChip / reportPickDate`.

### Permissions statement

No auth, tenant, billing or permission behavior changed: `_server actions_`
still run `assertChildInScope` (KID-103) before any write, the parent read view
still runs `isChildVisibleToAccount` (KID-372) before any render, and the
mobile route still runs `isChildInFamily`. The date feature only selects which
row is read/written for children already authorized.

## Tests

`tests/unit/kid472-daily-report-date-nav.test.tsx` — 15 tests, all green:
- date helpers: fallback for malformed/impossible dates; month/year-boundary
  shifts; the 7-day strip window anchors at max(selected, today).
- staff editor: today default unchanged; `?date=` loads that day's saved values
  for editing; malformed date falls back to today; saving a past date writes
  (child_id, report_date) for that date (and only that date) and redirects back
  with tab+date preserved.
- permissions: parent page still 404s a foreign centre's child with a valid
  past date; `saveDailyReportAction` still refuses an unassigned-carer account
  (no classroom records — KID-103 fail closed) even with a past date, no row.
- parent read view: read-only selected-day card (no report form on the
  surface); per-date empty state on a day with no report.
- i18n: nav keys pinned in both dictionaries.
- mobile: default payload unchanged; `?date=` returns the past day's row.
- cross-role: staff-save on a past date is what the parent reads for that date.

## Verification (this working copy)

- `npx vitest run tests/unit/kid472-daily-report-date-nav.test.tsx` → 15/15
- `npx tsc --noEmit` → clean
- `npm run lint` → clean (only the pre-existing `<img>` warnings that exist on
  master)
- `npm run build` → clean

## Full suite

`npm test` → **69 files, 704/704 tests passed** on this branch (commit under
review). The two date-nav-adjacent suites that render the parent page directly
(kid254, kid372) stay green because the date-nav component deliberately avoids
`useRouter` — it plain-navigates, so a plain static render works.

## Browser evidence (production build, Chromium headless, seeded Sunshine fixture)

Server: `npm start` (production build of this branch), DB `data/kid472-qa.db`
seeded via `npx tsx lib/seed.ts`. Screenshots in `screenshots/`:

| State | Screenshot | Observed |
| --- | --- | --- |
| Staff daily tab, no `?date=` | `staff-daily-today-default.png` | date input = today (2026-11-06), today's seeded summary in the editor, strip highlights today |
| Staff daily tab, `?date=2026-11-03` | `staff-daily-past-day.png` | tab + heading become "Daily report · Tue Nov 03 2026", empty editable fields for that day, strip anchors to include today (10-31…11-06) with 11-03 selected |
| Unsaved-changes guard | `staff-daily-unsaved-guard-blocked.png` | after editing summary, clicking the Today chip fires the localized confirm ("You have unsaved changes on this report. Leave without saving?"); dismissed → still on 2026-11-03 |
| Save a past-day report | `staff-daily-past-day-saved-back-on-date.png` | Save report → redirect URL `/portal/children/<ella>?tab=daily&date=2026-11-03` and the saved summary back in the editor (server round-trip on that date) |
| Parent, no `?date=` | `parent-today-report-default.png` | "Daily report" section defaults to today |
| Parent, `?date=2026-11-03` | `parent-past-day-report-read-view.png` | "Daily report · Tue Nov 03 2026" heading, the staff-saved summary ("Kinetic past-day save: obstacle course session." + Breakfast Toast) rendered strictly read-only — no report textarea on the surface |
| Parent, empty past day (`?date=` −40d) | `parent-empty-past-day.png` | per-date empty state "No report for this date yet." |

Programmatic assertions during the run (all true):

- staff default date input = `2026-11-06`; `?date=` drives it to `2026-11-03`
- confirm dialog fires on navigation with unsaved edits; navigation blocked
- save redirect keeps `tab=daily&date=2026-11-03`; reloaded summary matches
- parent sees the staff-saved past summary (`true`); zero report
  textareas; empty state present for a reportless day
- zero console errors (page + browser) in both sessions

## Notes

- Screenshot parity with the board's (unavailable) KID-472 attachment was not
  possible — no attachment exists on the issue. The implemented UX follows the
  existing Kiddy design system (cards, chips, purple accents, shared
  DailyReportDateNav in both roles). If the board supplies the screenshot,
  visual refinement can follow without touching the data flow.
- The incidentally-created local QA artifacts (`.env.local`,
  `data/kid472-qa.db`, `mktoken*`) are untracked and removed; the server under
  3111 was stopped after capture.

