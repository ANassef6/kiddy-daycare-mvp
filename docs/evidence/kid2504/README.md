# KID-2504 — check-in/out defects (KID-215 founder report)

Date: 2026-11-26. Author: Cody.

Founder report: KID-215 comment `fe5e3a34` with screenshot `4b6cabe9` (admin
attendance roster). Three staging defects:

1. an admin check-in was not visible on the parent `/child/{id}` page,
2. a manual check-out left a stale **On bus (home)** current-state badge,
3. repeated same-day check-in/out pairs needed to be verified and pinned.

## Root causes

### 1. Parent page missed a later admin check-in

`todayStatus()` returned `checkedIn` = the latest `in` row and `checkedOut` =
the latest `out` row. Every caller then computed the current state as
`!!status.checkedIn && !status.checkedOut`. A child with an earlier check-out
the same day (including the end-of-day sweep) still had an `out` row after a
new admin check-in, so the parent surface rendered **Not checked in yet**.
`app/child/page.tsx` had the same flaw.

Fix: `todayStatus()` now exposes `isCheckedIn`, derived from the day's LAST
event. `checkedIn` / `checkedOut` remain the latest row of each type for the
timestamp history (`Checked in at … · Checked out at …`, KID-1371 behaviour
preserved). The parent detail page (both branches), the parent child list, and
the mobile summary use `isCheckedIn`. The roster already used `last_event`;
its subqueries now add `id DESC` tie-breakers for deterministic ordering.

### 2. Stale **On bus** badge after a manual check-out

The bus badge derived only from the append-only `bus_event` ledger. A manual
check-out writes `check_in` but never advances the bus ledger, so the roster
and the parent page kept rendering `afternoon_on` (**On bus (home)**).

Fix (display-only; the ledger is untouched): `busBadgeIsStale(busRecordedAt,
lastAttendanceAt)` suppresses the phase when a real attendance write is later
than the latest bus event. Bus side-effect rows share the transition's
`recorded_at`, so genuine on/off-bus phases still show. KID-2448 strict
alternation and the append-only ledger are unchanged.

**Displayed-state rule:** *the bus badge shows only while the latest bus event
is the newest event of the day. Any later attendance write — manual check-out,
re-check-in, or the end-of-day sweep — supersedes the ledger and hides the
phase.*

### 3. Dedupe used the UTC day

`registerCheckInOut()` deduped "today" with `date(recorded_at)` (server/UTC
day) while every reader uses the center-local day (KID-2437). Near midnight
this could stack a duplicate or update the wrong entry. It now uses
`zonedDateKey` + `centerDayRange` for the child's center schedule.

## Tests

- `tests/unit/kid2504-checkin-out.test.ts` — repeated pairs, current-state
  flip, center-local dedupe across UTC midnight, badge staleness rule, and an
  assertion that the bus ledger is not mutated.
- `tests/unit/kid2504-badge-render.test.tsx` — real server renders of the
  roster and parent `/child` page: admin check-in after an earlier check-out,
  stale bus badge suppressed before/after a manual check-out.
- Related suites green: `kid2448`, `kid2447`, `kid2437`, `kid2436`, `kid1371`,
  `kid1329`, `kid2503`, `i18n`, `i18n-page-coverage`.
- `npx tsc --noEmit` clean; `npx next lint` reports only the pre-existing
  `<img>` warnings.

## Staging deploy

| Item | Value |
| --- | --- |
| PR | #160 (merged to `staging`) |
| Source | `origin/staging` @ `94e4ee2` |
| Worker | `kiddy-web-staging` |
| Deployed version | `eca45c3c-847d-4b2e-a465-be62c4e9236e` |
| Host | https://staging.kiddyapp.net |

### Migration note (staging)

The merged KID-2503 code reads `check_in.geofence_override` / `lat` / `lng`
and `staff_status.lat`. The staging `schema_migrations` ledger was behind
(0059 and 0060 never applied), so the first deploy of the combined code
returned `Something went wrong` on attendance. I applied the two idempotent
migrations to the staging Supabase project (`pjubkhhuccoqboypgpty`) with the
Supabase Management query API and recorded them in `schema_migrations`:

- `0059_kid2494_consent_response_tracking.sql`
- `0060_kid2503_premises_geofence.sql`

No code change was needed; the deployed bundle already contained the SQL. Any
future migration merge must be applied to staging before or with the deploy.

## Live verification (Skyvern, staging)

Fixture: Founder Test Daycare, Omar Founder, `Africa/Cairo`. The times below are
Cairo local.

Testing after the 18:00 close would let the end-of-day sweep auto-check-out the
child on each attendance page load, so for the run I temporarily set
Thursday's close to `23:59` (restored to `18:00` afterwards). The synthetic
`kid2504-bus-*` ledger rows used to stage the "before" badge were removed after
the run; the real admin check-in/out rows remain.

| Step | Evidence | Observed |
| --- | --- | --- |
| Admin checks Omar in from the roster after an earlier 18:00 auto check-out | [roster-admin-checkin-repeated-pair.png](roster-admin-checkin-repeated-pair.png) | Status **Checked in**, checked in 19:33, checked out 18:00 (history), action **Check out** |
| Parent opens `/child/{id}` | [parent-admin-checkin-visible.png](parent-admin-checkin-visible.png) | **Checked in** badge, **Check out** button, `Checked in at 19:33 · Checked out automatically at 18:00` |
| Bus ledger at `afternoon_on` (count 3) before a manual check-out | [roster-bus-badge-before-checkout.png](roster-bus-badge-before-checkout.png) | Bus badge **On bus (home)** |
| Admin manually checks out | [roster-bus-badge-after-checkout.png](roster-bus-badge-after-checkout.png) | Status **Checked out**, Bus **—** (ledger controls still offer the next cycle step) |
| Parent reloads the child page after the manual check-out | [parent-bus-badge-after-checkout.png](parent-bus-badge-after-checkout.png) | **Not checked in yet**, no bus badge, `Checked in at 19:33 · Checked out at 19:40` |

All evidence was captured through the deployed staging Worker with a real
browser session; the images were downloaded from the Skyvern run artifacts.

### Note: intermittent staging 503

While driving the runs, some requests returned Cloudflare **Error 1102 —
Worker exceeded resource limits** (`outcome: exceededCpu`, also on `/login`).
Retries succeed and the captured flows completed. It is a staging Worker
resource-limit condition, not specific to the changed routes; no application
exception was logged.

## Compatibility

- KID-58 / KID-1329 / KID-1371 gates unchanged.
- KID-2448 bus ledger semantics unchanged.
- KID-2503 geofence fields are preserved; `registerCheckInOut` still writes
  the optional coordinates, and `attendanceOn` keeps `last_event_override` /
  `last_event_by`.
- No new user-facing strings; EN + AR dictionaries untouched.
