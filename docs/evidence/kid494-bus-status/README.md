# KID-494 (KID-489 item 5) — Bus on/off status: auto check-in/out, parent notify, auto off-bus after 2h

Branch: `kid494-bus-status` (PR to master). Issue: KID-494 / parent KID-489 enhancement batch, item 5.

## What shipped

1. **Schema** — `supabase/migrations/0035_kid494_bus_status.sql`: append-only `bus_event`
   ledger (`id, child_id, account_id, type ∈ {on, off}, auto, recorded_at`) with a
   `(child_id, recorded_at DESC)` index. Idempotent. Mirrored verbatim in
   `lib/sqlite-schema.ts` (SQLite test/local engine). No mutable status column on child —
   today's bus status is ALWAYS derived from the latest event of the day, so the
   existing `todayStatus` / `attendanceOn` / 3h auto-checkout behavior is untouched.
2. **Core** — `lib/store.ts`:
   - `setBusStatus()` — idempotent per day (same-type latest event inserts nothing);
     ON when not checked out → auto check-out (`autoCheckoutChild`); OFF when not
     checked in → auto check-in; side-effect comparisons read `check_in` for the bus
     event's own day; exactly one durable parent notification per transition through
     the shared `emitNotifications` pipeline (kinds `bus_on`/`bus_off`,
     activity `attendance`, ref `bus-<eventId>`).
   - `runBusAutoOffSweep()` — close + `BUS_AUTO_OFF_GRACE_HOURS` (= 2,
     `lib/working-hours.ts`) auto-sets off-bus with actor=system and the pinned
     notification ref `bus-auto-off-<childId>-<day>` (notify exactly once).
   - Rides the existing `runAutoCheckoutSweep()` call sites (`busOff` in the return
     shape) so the attendance page and `/api/attendance/sweep` cron run both nets.
3. **Staff controls** — `busStatusAction` (`lib/actions.ts`; parent-role refused, child
   scope + audit row) driving the new `components/BusStatusButtons.tsx` on the
   attendance roster (`app/portal/attendance/page.tsx`): new Bus column with
   On bus / Off bus badges + buttons, sweep legend lists the auto-off children.
4. **Parent surface** — current bus badge on the child page (`latestBusEvent`,
   `attendees.busOn/busOff` EN+AR); both notifications render in the KID-474
   notification center via `notificationViewCopy` per-locale copy
   (`feed.busOnTitle/…` EN+AR, dictionary parity pinned).

## Checks (this branch, commit 49545e7 — rebased on origin/master 0318190)

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit/kid494-bus-status.test.ts` | 12/12 green (matrix below) |
| kid494 + working-hours + kid472-parent-notifications (targeted) | 45/45 green |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 (pre-existing `<img>` warnings in untouched files only) |
| `npm run build` | exit 0 (67/67 routes) |
| `npm run db:verify-migrations` | "All migration checks passed." (0035 applied) |
| `npm test` (full suite, this lineage) | 868/869 — the single red (`curriculum.test.ts` "listObservations joins the curriculum names") is shared-workspace interference: a concurrent agent's vitest run resets the same SQLite working tree mid-suite; the same suite re-runs 19/19 green in isolation on BOTH this branch and pristine origin/master |

Timestamps: full suite 08:10–08:51 UTC (3649.07s, 80 files / 869 tests);
curriculum isolated re-run on this branch 09:11 (19/19); pristine `origin/master`
worktree re-run also 19/19.

Test matrix pinned by `tests/unit/kid494-bus-status.test.ts`:
migration mirror + live SQLite `bus_event` presence; ON auto-check-out + exactly one
parent notification (both linked parents); no duplicate ON when already out; same-day
idempotence (no event, no notification); re-ON after a manual check-in still
auto-checks out; OFF auto check-in + one notification; no duplicate OFF when already
in; auto-off sweep at close+2h01 with actor=system + exactly-once notification +
second sweep no-op (injectable clock, TZ=UTC); sweep before the cutoff does nothing;
the integrated `runAutoCheckoutSweep` keeps the 3h attendance auto-check-out
(regression) and flips the forgotten bus OFF in the same run; roster map without N+1;
EN/AR key parity + per-locale view copy.

## Shared-workspace note

Commit b0065cf (KID-556, kid472-report-today) swept the mid-flight KID-494 files into
its commit because a concurrent run switched the shared checkout — established
pattern (KID-499 / KID-487 notes). This commit carries the complete KID-494 file set
on its own branch. Credentials/tokens appear nowhere in text, commits or logs.
