# KID-1371 — P2 security: webhook HMAC positive path, pickup-time boundaries, and flaky role tests

Source: KID-1330 `role-matrix-retest-2` (app-layer GO conditional; 26 PASS, 2
env-flaky, 0 security FAIL) hand-off to three leftover code-level gaps, under
the KID-215 owner direction "fix every finding" (non-destructive, synthetic
data only). Work is on `security-rc-integration` on top of the KID-1328/1329
fixes; the KID-1274 run shared this workspace concurrently, so only the
KID-1371 files are staged in this commit.

## 1. Webhook HMAC positive path (P)

KID-1330 could not test the configured-secret positive path of the Chatwoot
webhook. New suite `tests/unit/kid1371-webhook-hmac.test.ts` (9 tests) drives
the real route (`app/api/chatwoot/webhook/route.ts`) with a test secret:

- correct secret accepted through ALL three presentations (X-Chatwoot-Webhook-Secret
  header, `?token=` URL param, `Authorization: Bearer`): 200 `{handled:true}`
  AND the notification emission actually lands (row with a `chatwoot-%` ref),
- wrong secret → 401 `unauthorized` with no secret echo in the body,
- missing presented secret → 401 `unauthorized`,
- `CHATWOOT_WEBHOOK_SECRET` unset (and whitespace-only) fails closed → 503
  `webhook_disabled` — even with the correct secret presented,
- the comparison stays timing-safe: `crypto.timingSafeEqual` really fires for
  the equal compare AND the burned length-mismatch compare (3 calls verified
  via spy; the unit contract itself was already pinned in kid472),
- no failure/access log line ever contains the configured secret value
  (console spied across accept/reject/missing/unset/malformed-body paths).

No bug surfaced on the verify path — the route and `verifyChatwootWebhookSecret`
already behaved correctly; this run just pins it.

## 2. Pickup-time boundary rules (P)

KID-1330 could not prove past-time and cross-day rejection. Root cause: the
pick-up write path had NO boundary validation at all beyond the KID-58 "no
check-in before open" gate — any caller shape was silently accepted.

Fix, enforced server-side at the single chokepoint both surfaces share:

- `lib/pickup-policy.ts` (new, pure): `evaluatePickupTime` + `parsePickupAtCandidate`.
  A request-supplied candidate time (form field `pickupAt` on web, body `at`
  on mobile, ISO date-time or naive datetime-local) is hard-bounded:
  - `invalid_time` — a present-but-unparseable blob fails closed instead of
    being silently ignored (the exact KID-1330 blind spot),
  - `cross_day` — same-day only; past AND future days refused (the ledger day
    is `date(recorded_at)` UTC, so the same-day comparison is UTC too),
  - `past` — a chosen moment before the server clock is refused,
  - `closed_day` — a day the center is closed (institute.opening_hours),
  - `outside_hours` — before open or at/after close of that LOCAL day, with
    the same no-config → unconditional-allow rule as `checkInOpen`.
  No candidate supplied → the registration records the LIVE server clock
  (a moment nobody could have chosen): past/cross-day are impossible by
  construction there, and refusing real live events would break the daily
  loop and the auto-sweep/double-submit semantics; the web action separately
  keeps its pre-existing KID-58 closed-day/pre-open gate for check-ins.
- `lib/actions.ts checkInOutAction`: after the role/scope/toggle guards, the
  decision runs BEFORE any write; a refusal returns `{error}` (nothing is
  recorded), and an accepted decision feeds `registerCheckInOut` with the
  exact validated moment. Audit trail unchanged.
- `app/api/mobile/children/[id]/check-in/route.ts`: the same decision; a
  boundary refusal is an HTTP 422 `{error}` with nothing written, an
  accepted write lands 200 with the validated moment.
- `lib/store.ts registerCheckInOut` (new): the user-facing write — the
  validated primitive `checkChildInOut` stays untouched for the system flows
  (auto check-out sweep, bus ledger side effects). Two pickup-loop
  guarantees ride here:
  - one entry per child per day: a redundant same-type re-registration
    (double tap, mobile retry, deliberate re-set) is an in-place UPDATE of
    today's latest entry (`recorded_at`, `is_edit=1`), never a stacked row,
  - the alternating transition still works: an `in` after the pickup inserts
    a FRESH arrival row (the "cancel today's pickup" op) — the pickup row's
    15:00 history is never overwritten by the 15:20 cancel.

Suite `tests/unit/kid1371-pickup-boundaries.test.tsx` (27 tests): the full
pure policy matrix (valid now / valid supplied / past / yesterday / tomorrow /
before open / at-close-and-after / closed day / malformed blob / no-config,
plus rule precedence) and route-level proofs on the web action AND the
mobile route — past, cross-day, outside-hours, closed-day, duplicate-day
(one-entry update), valid set, update (`is_edit`), cancel (fresh arrival +
preserved pickup history), and "no staff approval needed" (the pickup link
registers directly). Everything runs on a fake clock pinned inside the
seeded center's working week, so none of it depends on the time of day the
suite runs.

## 3. Flaky role tests (P3)

The two KID-1329 redirect assertions ("web action: works again when the
toggle is back ON" and "pickup keeps its pickup-time registration even when
the toggle is OFF") are time-of-day flaky: on a night/weekend container
clock the seeded center (Mon–Fri 07:00–18:00) refuses success-path
check-ins via the pre-existing KID-58 gate, the action answers `{error}` and
the expected `NEXT_REDIRECT` never throws. Proof in this run: the suite ran
at 01:23 UTC and failed exactly those tests; re-run after the fix was all
green. KID-1329's own mobile 200-path had the same sensitivity once the
KID-1371 gate landed.

Fix (determinism only, no assertion weakened): the whole "defect 3" describe
in `tests/unit/kid1329-role-enforcement.test.tsx` pins a fake clock to a
Wednesday 11:00 UTC (`useFakeTimers({toFake:["Date"]})` + `setSystemTime`)
inside the center's working week, restored in afterEach. Clean re-runs (at
01:25 UTC and 03:05 UTC, both previously failing windows) pass 14/14.

## Gates on the fix tree

- `npm test` (full battery, 107 files / 1172 tests): 1169 PASS, 3 FAIL —
  `kid1175-sweep-cron-auth`, `kid1204-instapay-clear`, `kid1328-cross-tenant-child-scope`
  are pre-existing suites unrelated to this work; they failed ONLY under the
  concurrent KID-1274 battery sharing the box (load flakes) and pass
  24/24 in an isolated rerun on the same tree.
- Targeted/isolated: kid1371 (webhook 9/9 + pickup 27/27), kid1329 14/14,
  mobile-child-idor green (regression check on the mobile check-in path).
- `npx tsc --noEmit`: clean.
- `npx next lint`: 0 errors (the pre-existing baseline `<img>` warnings only).
- `npm run build`: green (Compiled successfully, all routes emitted).
- `npm run db:verify-migrations`: All migration checks passed (43 migrations,
  RLS + storage probes included; no schema change in this task).

## Out of scope (per plan)

- CSP enforcement + rate-limit proxy validation (KID-1274, running concurrently).
- Production deploy.
