# KID-2483 — production cut record (staff schedule dates, rooms, duplication)

Status: **complete — the production Worker is cut, deployed and verified.**

The staging build and its EN/AR page renders live in the KID-2483 staging PR
(#126). This record covers the production cut only.

## Approval

The founder accepted the human-only confirmation card
`9a61b44b-edc5-4adb-b976-85acca61ce24` ("Founder sign-off: staff schedule")
on **2026-11-25T17:50:07Z**. Accept authorised the production cut.

## What shipped

Cherry-picked from `staging`:

- `c2031e8` — KID-2483: `staff_schedule.schedule_date`, the
  `staff_schedule_room` join table, per-shift room selection, date and
  duplicate controls in the add-shift form, date/time/room display in the
  schedule list, staff profile and dashboard, plus the "Staff on duty today"
  card. EN + AR copy and the SQLite mirror are included.

| Item | Value |
| --- | --- |
| Pull request | #135 `kid2483-prod-cut` → `master` |
| Merge commit | `166c05c` (2026-11-25T18:36Z) |
| Worker | `kiddy-web` version `303ac24d-660b-4e6d-8086-4c510bb1cc83` (2026-11-25T18:43:49Z) |
| Deploy message | `KID-2483-staff-schedule-master-166c05c` |
| Previous worker version (rollback) | `d349c0e6-5429-4fe8-ae98-ec7842116df5` (KID-2486 build, 2026-11-25T18:04Z) |
| Routes / DNS | unchanged |
| Worker secrets / bindings | unchanged |

`master` also carried the KID-2480 event-audience commits (`f5c36c1`,
`29a8b87`) that landed after the previous Worker. They ship in this build; no
KID-2483 file depends on them.

### Build inputs

The same public values as the previous production build:

- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public anon key already inlined in the live
  reset-password chunk
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` — public value already inlined in the
  live layout chunk
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`
- `KIDDY_CSP_MODE=report-only`
- `SESSION_SECRET` — build-only boot check; the Worker keeps its runtime secret

Deploy method: `npx opennextjs-cloudflare build` on `166c05c`, then
`npx opennextjs-cloudflare deploy --message KID-2483-staff-schedule-master-166c05c`
(top-level Worker environment).

## Migration

`0056_kid2483_staff_schedule_date_rooms.sql` was applied to the production
Postgres through the Supabase Management API in one transaction, and its
filename was recorded in `schema_migrations`. The file is idempotent, but it
was applied once.

Applied at 2026-11-25T18:47Z. Verified after the fact:

| Check | Result |
| --- | --- |
| `staff_schedule.schedule_date` column | present, `text` |
| `staff_schedule_room` table | present |
| `schema_migrations` row for the file | 1 |

## Verification on the cut tree

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run tests/unit/kid2483-staff-schedule.test.ts tests/unit/kid2483-staff-schedule-page.test.tsx tests/unit/i18n.test.ts tests/unit/i18n-page-coverage.test.ts` | 4 files / 31 tests pass |
| `node supabase/verify-migrations.mjs` | all migration checks pass (PGlite) |
| `npm run lint` | 0 errors (pre-existing `<img>` warnings only) |
| CI on PR #135 (`Test + build + wrangler dry-run`) | pass |
| CI on PR #135 (`audit`) | pass |
| CI on PR #135 (Vercel `kiddy`, `kiddy-staging`) | pass |

The only cherry-pick conflict was in `lib/sqlite-schema.ts`: the staging
commit also carried an unrelated KID-2481 `room.photo_url` backfill. That hunk
was dropped; the KID-2483 backfill and `staff_schedule_room` mirror were kept.

## Live production verification

### Served build

| Check | Result |
| --- | --- |
| `GET /` | `200`, `server: cloudflare`, `x-opennext: 1` |
| Live layout chunk | `layout-db2af10b12dbae82.js` — exactly the chunk in this build |
| `GET /login`, `GET /reset-password`, `GET /auth/confirm` | `200` |
| `GET /?lang=ar` and `/login` | `dir="rtl"` present |
| `GET /_next/static/chunks/9082-cba2351d726c936a.js` | `200`; contains "Staff on duty today" and Arabic "موظف" |
| `/portal/staff/schedule` | `307 → /login` (route exists and stays auth-gated) |
| `/portal/dashboard` | `307 → /login` |

### Database

The applied migration is listed above. Existing weekday-only
`staff_schedule` rows are untouched: the column is nullable and no backfill
ran, so the legacy weekly pattern keeps rendering.

### Not covered here

An authenticated add-shift walkthrough needs a production owner login, which
this agent does not hold. The same flow is covered by the KID-2483 unit and
page-render suites and by the staging EN + AR verification in PR #126.

## Rollback

```sh
npx wrangler rollback d349c0e6-5429-4fe8-ae98-ec7842116df5 --name kiddy-web
```

That returns the Worker to the KID-2486 build. The migration is additive and
backward compatible (nullable column, new join table), so the older Worker
keeps working against the migrated schema. No route, DNS or secret change was
made.
