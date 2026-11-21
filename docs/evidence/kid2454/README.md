# KID-2454 — child status guards: sleep state, wake state, debounce, check-in

Status: **complete — staging signed off and production cut finished.**

## What shipped

| Area | Change |
| --- | --- |
| Sleep state | A second `Fell asleep` with no intervening `Woke up` is refused server-side (`ChildStatusGuardError("sleep-state")`). |
| Wake state | `Woke up` is refused unless the latest same-day sleep entry is `Fell asleep` (`"no-sleep"`). Allowed cycle: `Fell asleep → Woke up → Fell asleep → Woke up`. |
| Identical-entry debounce | The same child + kind + value as the most recent entry, within 60 seconds, is refused (`"duplicate"`). A changed note does not bypass it. Applies to every chip kind. |
| Check-in precondition | A status entry needs at least one `check_in` row for the entry's center-local day (`"not-checked-in"`). A child already checked out still accepts late notes; only a day with zero check-ins is blocked. |
| Error surfacing | `saveChildStatusAction` redirects to the same daily view with `?error=sleep_state`, `no_sleep`, `duplicate`, or `not_checked_in`; the daily tab renders an EN/AR staff banner. |
| Client hardening | `components/StatusChipButton.tsx` disables the chip while its form submit is pending. The server guard remains the source of truth. |
| i18n | EN + AR strings `profile.statusSleepStateError`, `statusDuplicateError`, `statusNotCheckedInError`, appended `statusNoSleepError`. |

No schema change: every guard reads existing `child_status` / `check_in` rows.

## Staging

| Item | Value |
| --- | --- |
| Staging head | `4d70cb1` |
| URL | https://kiddy-staging-orcin.vercel.app |
| KID-2454 commits | `01ce89a` (sleep state + debounce), `b2baf3b` (check-in), `b62e303` (keep the guards out of the messaging work), `4d70cb1` (wake state) |
| Deployment | READY |

Sign-off cards:

- `f284968c` **rejected** 2026-11-21T00:17:50Z — the founder could mark a child awake with no sleep registered.
- `09ff7532` **accepted** 2026-11-21T03:59:38Z after `4d70cb1`.

The founder's rejection reason: "I shouldn't be able to woke up the child while there is no sleep status registered." `4d70cb1` added the wake precondition and was re-tested on staging.

## Production cut

| Item | Value |
| --- | --- |
| Pull request | #81 `kid2454-prod-cut` → `master` |
| Merge commit | `d3bc2f554fdc303e7a6d17268c1c0d0d48997bff` (2026-11-21T04:12:04Z) |
| Cut branch base | `origin/master` `cfb3e3b` |
| Cut commits | `eafba3a` (sleep state, debounce, check-in, error banners), `403b308` (wake state) |
| Files changed | 6 — no messaging or unrelated KID-2455 code reverted |
| Production deployment | https://kiddy-fn7humnms-kiddy2.vercel.app — READY, `production`, 2026-11-21T04:14:07Z |
| Aliases | `kiddyapp.net`, `*.kiddyapp.net`, `sunshine.kiddyapp.net` |

The cut is a cherry-pick, not a staging merge. `staging` still carries older
unreviewed commits; only the KID-2454 guard changes were applied to `master`.

### Gates on the cut branch

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (pre-existing `<img>` warnings only) |
| `SESSION_SECRET=… npm run build` | green |
| `tests/unit/kid2454-child-status-guards.test.tsx` | 14/14 — every rejection is a direct server-action `FormData` POST |
| Related suites | 82/82 — i18n parity/coverage, KID-368 Arabic i18n, KID-472 daily-report date nav, KID-2413 server validation, KID-180 contact invite, KID-2455 attachments/archive, KID-2432 migration versions |
| PR checks | `audit` pass; Vercel `kiddy` and `kiddy-staging` pass; Supabase Preview skipped (integration disabled) |

### Production migrations

None. The cut changes application code only; the guard reads existing tables.

### Post-deploy smoke check (anonymous)

| URL | Result |
| --- | --- |
| `https://kiddyapp.net/login` | `200` |
| `https://kiddyapp.net/portal/children` | `307` → `/login` |
| `https://kiddyapp.net/api/attendance/sweep` (no secret) | `401` |

Production has no test login for this agent. The authenticated guards are
proven by the founder's staging sign-off, the direct-POST test suite, and the
production deployment/smoke checks above.

## Data cleanup (shadowed duplicate)

Removed exactly one production row during the staging phase, after identifying
it read-only: Sunshine Daycare, child `mud3euq6-j2xfy0jt` (Becca Nassef),
`child_status` id `mwp9vedf-qhrdjbhw` at 2026-11-20T17:48:00Z. The original
`17:47:45Z` entry (`mwp9v2fg-aq3l34y1`) remains and is that day's only sleep
entry. No bulk delete, no other child or day touched.

## Founder re-test steps (staging, already signed off)

1. Check in a child, then tap `Fell asleep` twice: one entry, second attempt shows the sleep-state banner.
2. Tap `Woke up` with no sleep that day: no entry, no-sleep banner.
3. `Fell asleep → Woke up → Fell asleep → Woke up`: all four log.
4. Tap any chip twice within 60 seconds: one entry, duplicate banner; a changed note does not bypass it.
5. Try a status entry for a child with no check-in today: refused with the check-in banner; after check-in (even checkout) it logs.
6. Switch EN/AR and confirm every banner renders in the selected language.
