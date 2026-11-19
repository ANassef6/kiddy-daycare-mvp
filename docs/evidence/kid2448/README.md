# KID-2448 — bus attendance cycle (on-bus / off-bus)

Branch: `kid2448-bus-cycle` (PR to master). Issue: KID-2448.
Source: founder directive in KID-215 comment 9fda488b (2026-11-19T20:19Z).

## What shipped

A daycare day now has two bus pairs per child, and the attendance transitions
are derived from the strict event sequence:

| # | Staff action | Bus state shown | Attendance side effect |
|---|---|---|---|
| 1 | **On bus** (morning) | on bus — on the way to the daycare | none (child is en route) |
| 2 | **Off bus** (morning) | arrived at the daycare by bus | **auto check-in**, `check_in.source = 'bus'` |
| 3 | **On bus** (afternoon) | on bus — on the way home | none (child is en route) |
| 4 | **Off bus** (afternoon) | dropped off at home by bus | **auto check-out**, `check_in.source = 'bus'` |

- `lib/store.ts`: `setBusStatus` derives the phase from the ordered events of
  the center-local day (`busPhaseForCount` / `busNextAction`). Guards:
  `off_without_on`, `on_before_off`, `cycle_complete`; a repeat of the latest
  type is an idempotent no-op (double click / repeated sweep). One durable
  guardian notification per inserted transition, with the phase in the payload.
- `runBusAutoOffSweep` (close + 2h) rides the same transition, so a forgotten
  off-bus does the right thing per phase (morning → check-in, afternoon →
  check-out).
- `runAutoCheckoutSweep` skips a child whose latest bus state is "on"
  (KID-2447 coordination: the end-of-day job must not close an on-bus child).
- `components/BusStatusButtons.tsx` enables only the next expected action and
  shows the localized guard message; manual Check in/Check out is unchanged
  (`AttendanceCheckIn`).
- `app/portal/attendance/page.tsx`: four bus badges (morning/afternoon, on/off)
  plus a `Bus` marker next to an attendance time written with `source='bus'`.
- `app/child/[id]/page.tsx`: parent badge uses the four wordings.
- `app/api/export/route.ts`: attendance CSV carries
  `checked_in_source` / `checked_out_source`.
- `supabase/migrations/0051_kid2448_bus_cycle.sql`: idempotent nullable
  `check_in.source`, mirrored in `lib/sqlite-schema.ts`.
- EN + AR strings for the four states, the guard messages, and the four
  guardian notifications.

## Checks (commit bd343dd, rebased on origin/master b07a645)

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit/kid2448-bus-cycle.test.ts` | 11/11 pass (`kid2448-suite.log`) |
| `working-hours` + `kid2437-timezone` + `kid472-parent-notifications` + `kid1385` | 64/64 pass |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 (pre-existing `<img>` warnings only) |
| `npm run build` (with a throwaway `SESSION_SECRET`) | exit 0, all routes collected |
| `npm run db:verify-migrations` | "All migration checks passed." |

## Founder test steps (staging / preview)

1. Open **Attendance** as staff for a test child that has no attendance today.
2. Press **On bus (to daycare)**. Expected: the bus badge says
   "On bus (to daycare)", the child is still not checked in, and no check-in
   time appears.
3. Press **Off bus (arrived at daycare)**. Expected: the badge says
   "Arrived at daycare" and the child is **checked in now**; the attendance time
   shows a small **Bus** marker.
4. Press **On bus (home)**. Expected: the badge says "On bus (home)"; the child
   remains checked in until the final off-bus.
5. Press **Off bus (dropped off at home)**. Expected: the badge says
   "Dropped off at home", the child is **checked out**, with the **Bus** marker.
   Both buttons are now disabled and "Bus cycle complete" shows.
6. Guards: on a fresh child, try **Off bus** first — expected: "Register On bus
   before Off bus." and no attendance row. After all four steps, a fifth
   transition is rejected.
7. Parent view: open the child page as a linked parent. The badge uses the
   morning/afternoon wording; the notification center shows four bus events
   (picked up / arrived / departing / dropped off), EN or AR per locale.
8. Non-bus regression: a child with a manual **Check in** / **Check out** still
   behaves exactly as before. The end-of-day sweep does not check out a child
   who is in the afternoon on-bus state; the bus off-bus writes that check-out.

## Merge note

KID-2447 (end-of-hours auto-checkout) is in flight on the same files. When both
branches land, keep one copy of the `check_in.source` migration statement
(`0050` + `0051` are both `ADD COLUMN IF NOT EXISTS`, so applying both is safe)
and keep one `checked_out_source` select/arg pair in `attendanceOn`. The
KID-2448 skip line in the `runAutoCheckoutSweep` child loop applies unchanged to
KID-2447's rewritten cutoff.
