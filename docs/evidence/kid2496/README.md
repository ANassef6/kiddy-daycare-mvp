# KID-2496 — check-in times rendered ~2h behind (UTC vs center timezone)

Date: 2026-11-26. Author: Cody.

## Root cause: code, not config

The staging fixture is not missing its timezone:

- `scripts/seed-staging-founder.ts` seeds **Founder Test Daycare** with
  `timeZone: "Africa/Cairo"`.
- `supabase/migrations/0046_kid2437_institute_timezone.sql` and
  `lib/sqlite-schema.ts` add `institute.timezone TEXT NOT NULL DEFAULT
  'Africa/Cairo'`.
- `getCenterSchedule()` already normalizes an empty/invalid value to
  `Africa/Cairo` (KID-2437).

The defect was in the **display** path. `fmtDateFor`, `fmtTimeFor` and
`fmtDateTimeFor` in `lib/i18n.ts` called `Intl.DateTimeFormat` with no
`timeZone`. That uses the HOST zone, and the Cloudflare Worker / Vercel
renderer runs in UTC. A check-in stored as `14:34Z` (16:34 Cairo) therefore
rendered as `14:34` on every server-rendered surface — exactly the founder's
screenshot.

The KID-2437 helpers only covered business-rule comparisons (`checkInOpen`,
pickup validation, cutoffs); display formatting was never routed through the
center zone.

## Fix

1. `lib/timezone.ts` now owns the display formatters too:
   `formatZonedValue()` and `zonedWallClock()`, built on the same
   `zonedParts`/`normalizeTimeZone` projection as the working-hours rules.
   Date-only values (`dob`, `report_date`, `due_date`) render in UTC so the
   stored calendar day never shifts.
2. `fmtDateFor` / `fmtTimeFor` / `fmtDateTimeFor` take the center `timeZone`
   (default `Africa/Cairo`, the platform operating zone) and delegate to the
   helper above. No ad-hoc `toLocale*` time formatting remains.
3. `i18nForAccount` resolves the request tenant and returns its
   `getCenterSchedule().timeZone`, so every portal/child page that already
   calls it gets the right clock with no duplicate lookup logic.
4. Every user-facing timestamp call site passes that `timeZone`:
   attendance, dashboard, child profile/parent surface, daily report log +
   saved-by line, status log, learning observations, messages, newsfeed,
   incidents, consents, audit, staff profile/schedule/hours, tags, support,
   forms, report center, notifications feed, push copy, platform contract /
   invoice dates, bulk-upload timestamps, and the attendance CSV export.
5. Shared `Attribution` and `BulkUploadCard` components take the center zone
   as a prop; the platform per-daycare pages use **that daycare's** zone.

## Surfaces verified

| Surface | File | Result |
| --- | --- | --- |
| Attendance checked-in/out | `app/portal/attendance/page.tsx` | 14:34Z → **16:34** |
| Dashboard checked-in now | `app/portal/dashboard/page.tsx` | Cairo clock |
| Parent child profile | `app/child/[id]/page.tsx` | Cairo clock |
| Portal child profile + report | `app/portal/children/[id]/page.tsx` | Cairo clock |
| Daily report saved-by / status log | `app/portal/children/[id]/page.tsx` | Cairo clock |
| Daily report feed meta | `lib/store.ts` via `feedCopyFor` | Cairo clock |
| Push notification copy | `lib/push.ts` | account's own center |
| Messages (portal + parent) | `app/portal/messages`, `app/child/messages` | Cairo clock |
| Newsfeed post times | `app/portal/newsfeed`, `app/child/newsfeed` | Cairo clock |
| Incidents (portal + parent) | `app/portal/incidents`, `app/child/incidents` | Cairo clock |
| Notifications feed | `app/portal/notifications`, `app/child/notifications` | Cairo clock |
| Audit log | `app/portal/audit/page.tsx` | Cairo clock |
| Staff profile/history/schedule/hours | `app/portal/staff/**` | Cairo clock |
| Consents + attribution | `app/portal/consents`, `components/Attribution.tsx` | Cairo clock |
| Learning observations | `app/portal/learning/**`, `app/child/learning` | Cairo clock |
| Tags / support / forms / report center | matching pages | Cairo clock |
| Platform contracts + invoice dates | `app/platform/daycares/[id]/settings/**` | viewed daycare's zone |
| Owner + platform invoice dates | `app/portal/account-billing`, platform invoices | center zone / date-only safe |
| Attendance CSV export | `app/api/export/route.ts` | center-local wall clock |

## Evidence (local, TZ=UTC)

The tests force `process.env.TZ = "UTC"` so they reproduce the server
renderer, then render the real pages:

- `tests/unit/kid2496-display-timezone.test.ts` — 8 assertions: 14:34Z →
  16:34 Cairo, New York uses its own offset, date-only values do not shift,
  Arabic keeps the Cairo clock, CSV wall clock, and the default is the
  platform zone.
- `tests/unit/kid2496-timezone-resolution.test.ts` — `i18nForAccount` returns
  the seeded center's zone and follows a change to `America/New_York`.
- `tests/unit/kid2496-attendance-render.test.tsx` — real server renders:
  attendance board contains `16:34` and not `14:34`; dashboard and child
  profile contain the Cairo clock and not the UTC clock.

Run:

```sh
npx vitest run tests/unit/kid2496-*.test.ts tests/unit/kid2496-*.test.tsx
```

Result: **14 passed**. Related regression suites also green:
`kid2436`, `kid2437`, `kid2483*`, `kid685`, `i18n`, `i18n-page-coverage`,
`kid221`, plus the platform billing/contract suites.

`npx tsc --noEmit` is clean; ESLint reports only the pre-existing `<img>`
warnings.

## Staging

Deployed from `staging` after the EN/AR check. Re-check:

1. Sign in on `https://staging.kiddyapp.net` as the founder owner.
2. Check a child in; the attendance Checked-in column must show the Cairo
   wall-clock time (e.g. 16:34, not 14:34).
3. Confirm the same time on the dashboard, the daily report, and the child
   profile.

No production data or production code path was changed.
