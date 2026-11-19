# KID-2447 — auto check-out at the end of center working hours

## Root cause (confirmed in code and data)

There **was** an auto check-out sweep, but its child cutoff was
`closeCutoff = closing + 3h` (`lib/working-hours.ts`,
`AUTO_CHECKOUT_GRACE_HOURS = 3`). For an 18:00 close the ledger stayed
"checked in" until 21:00, so at 20:06 the founder still saw children present.
Nothing ran at the actual end of working hours. The sweep also only ran on
attendance/dashboard page loads or when a scheduler called
`/api/attendance/sweep` — no schedule was configured in `vercel.json`.

## What changed

| Area | File | Change |
|---|---|---|
| Child cutoff | `lib/working-hours.ts` | New `endOfWorkingHoursCutoff` = the center-local closing instant (grace 0). `closeCutoff` stays close + 3h for the historical staff grace. All cutoffs share one `graceCutoff` helper, DST/cross-midnight safe. |
| Sweep | `lib/store.ts` → `runAutoCheckoutSweep` | Children whose latest event today is still `in` are checked out when the center-local close is reached. Config is read at run time, so a changed closing time applies on the next run. Staff keep +3h. No check-in-time window: even a child checked in after closing is not left in all evening. |
| Distinct source | `lib/store.ts` → `autoCheckoutChild`, `AUTO_CHECKOUT_SOURCE` | The sweep writes `check_in.source = 'auto_end_of_day'`, actor = system, no pickup person. Manual/staff/parent rows keep `NULL`. Readers use it only as a display marker. |
| Migration | `supabase/migrations/0051_kid2447_auto_checkout_source.sql`, `lib/sqlite-schema.ts` | Adds nullable `check_in.source` (idempotent) plus the SQLite mirror/backfill. |
| Notification | `lib/store.ts` → `notifyAutoCheckout` | One durable in-app `attendance / auto_checkout` row per center owner/admin **and** each affected child's classroom teachers (`staff_room`). Payload lists the children; ref `auto-checkout-<institute>-<centerDay>` dedupes repeated sweeps. Best-effort: never rolls back the checkout. |
| Copy | `lib/i18n.ts`, `notificationViewCopy`, `app/portal/notifications/page.tsx` | EN + AR title/body; the notice links to `/portal/attendance`. |
| Visible marker | `app/portal/attendance/page.tsx`, `app/child/[id]/page.tsx` | Check-out time shows an **auto / تلقائي** badge; the child page says "Checked out automatically at …" instead of implying a pickup. |
| Schedule | `vercel.json` | Removed on 19 Nov 2026: Vercel rejected every deploy with "Hobby accounts are limited to daily cron jobs" for `* * * * *`. The route is unchanged and the sweep still runs on attendance/dashboard loads. An every-minute trigger needs Pro Cron Jobs or an external scheduler that calls `GET /api/attendance/sweep` with `Authorization: Bearer $CRON_SECRET` (see `docs/DEPLOY_SECRETS.md`). |

## Expected behavior

- At the center-local closing time, every child of that center whose latest
  event that day is still a check-in gets exactly one automatic check-out.
- Closed days produce no check-out.
- A manual checkout before the job leaves one manual row and no auto row.
- A second sweep is a no-op (ledger state is the idempotency guard), and the
  staff summary is emitted once per center/day.
- Admins/owners and the affected children's classroom teachers get the
  notification; teachers of other rooms do not.

## How the founder tests it on staging

1. Sign in as the center owner/admin.
2. Settings → Center details → Working hours: set today's closing time a few
   minutes ahead (keep the center's timezone correct), save.
3. Attendance: check in a test child (staff or parent, whichever the center
   allows).
4. Wait until the closing time has passed (at most one minute for the cron;
   on a staging preview, where Vercel crons are not active, just open
   `/portal/attendance` or `/portal/dashboard` — the sweep runs on load).
5. Expect: the child shows **checked out** with the **auto / تلقائي** marker,
   the `attendance.autoCheckoutRun` line names the child, and the notification
   bell has "Auto check-out at closing time" listing the child by name.
6. Optional direct simulation (only after the configured close has passed):
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<staging-host>/api/attendance/sweep`
   returns `{"ok":true}`.

The sweep deliberately does nothing before the configured close, so a test
cannot "simulate" an earlier closing time without changing today's config —
that is the supported path.

## Staging deploy

- Branch `staging`, commit `b482108` (clean cherry-pick of the shared-tree
  commit onto the then-current `origin/staging` `ea3903b`).
- URL: https://kiddy-staging-orcin.vercel.app — responds `200` after the push.
- `GET /api/attendance/sweep` without a secret responds `401 {"ok":false}`,
  i.e. the deployed route is the fail-closed, CRON_SECRET-protected one.
- The same commit was checked in a clean worktree of `origin/staging`:
  `npx tsc --noEmit` clean and `kid2447` + `kid494` suites 21/21 green.

## Verification

- `tests/unit/kid2447-auto-checkout.test.ts` — 9 tests: close-instant
  checkout + source, before-close no-op, after-close check-in, closed day,
  manual-checkout dedupe, runtime config change, repeat-sweep idempotency,
  owner/admin + room-teacher notification, other-room teacher excluded.
- `tests/unit/working-hours.test.ts`, `tests/unit/kid494-bus-status.test.ts` —
  regression, 40/40 green (`test-battery.log`).
- `npx tsc --noEmit` — clean.
- `npm run db:verify-migrations` — all checks passed (`verify-migrations.log`).
- `next lint` on the touched files — no new warnings (one pre-existing
  `<img>` warning in the child page).

## Production cut

Founder sign-off: the staging confirmation card was accepted
2026-11-19T23:22Z (staging test steps above). This cut carries the same
behavior that was tested on staging.

| Item | Value |
|---|---|
| Pull request | #68 `kid2447-prod-cut` → `master` |
| Merge commit | `c824633` (2026-11-19T23:41:05Z) |
| Vercel deployment | production deployment for `c824633` — READY (2026-11-19T23:42:14Z) |
| Deployment URL | https://kiddy-4vnnzeu7g-kiddy2.vercel.app |
| Production aliases | `kiddyapp.net`, `*.kiddyapp.net`, `sunshine.kiddyapp.net` |

The cut branch was rebased on `f802cab` (the current `master`, which already
contains KID-2448's bus cycle). Conflicts were resolved by combining both
features: the sweep keeps KID-2448's "child is on the bus" skip and KID-2447's
close-instant cutoff, and the attendance roster shows both the `bus` and
`auto_end_of_day` markers. KID-2447's migration shares the nullable
`check_in.source` column with KID-2448's `0051_kid2448_bus_cycle.sql`; both are
idempotent.

`vercel.json` is deliberately unchanged in production: Hobby projects reject
sub-daily cron jobs, so the per-minute schedule stays out. The sweep still runs
on attendance/dashboard page loads, and the `CRON_SECRET`-protected
`GET /api/attendance/sweep` route is available for Pro Cron Jobs or an external
scheduler. Closing-time check-outs therefore land on the next attendance or
dashboard view rather than from a built-in timer.

Post-deploy smoke check (anonymous, after the aliases moved):

| URL | Result |
|---|---|
| `https://kiddyapp.net/api/attendance/sweep` (no secret) | `401 {"ok":false}` |
| `https://kiddyapp.net/login` | `200` |
| `https://kiddyapp.net/portal/attendance` (anonymous) | `307` → `/login` |
| `https://kiddy-4vnnzeu7g-kiddy2.vercel.app/api/attendance/sweep` (no secret) | `401 {"ok":false}` |

Gates on the cut branch (rebased on `f802cab`): `tsc --noEmit` 0;
KID-2447 + working-hours + KID-2448 suites 39/39; migration verifier all checks
passed; `next build` green; `next lint` on the touched files with only the
pre-existing `<img>` warning.
