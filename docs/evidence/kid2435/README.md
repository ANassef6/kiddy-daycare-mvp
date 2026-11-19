# KID-2435 — pricing v2 bands and founding cohort in the invoice engine

## v3 scope update (19 Nov 2026, KID-2430)

The approved plan is now monthly only. This branch is **not merged to
production** because one approved rule needs a data-model decision first.

Implemented in this change:

- Annual is gone: no annual amount is billed, stored or displayed. The
  `pricing_band.annual_egp` / `annual_is_quote` columns and
  `daycare_billing.annual_amount_egp` are dropped by migration `0048`; the
  pricing, billing and portal surfaces no longer show an annual figure.
- The 20% glide cap is gone. A founding client pays the rate fixed at its
  first invoice for months 1–12, then the standard band amount from month 13.
  One step, no compounding chain.
- Billing starts on the 1st of a month. `first_cycle_start` is normalised on
  read and write, so a mid-month date becomes the 1st and no proration exists.
- Failed payment: `billing.grace_days` (default 7) is added to the due date
  before the invoice becomes overdue. Data is never deleted.
- The monthly bands, Enterprise+ formula, founding amounts, founding cap and
  pilot credit are unchanged.

**Blocked on a decision — one subscription per branch.** The approved plan
says every branch is its own subscription. The `branch` table exists (id,
institute_id, name, address, created_at) but has **no billing anchor**:
`daycare_billing` and `daycare_invoice` are keyed by `institute_id`. Making
the branch the billable record is a data-model change, not a pricing change.
The target record and three edge cases are asked back on the issue before
this merges.

Not in this change:

- True read-only enforcement. The grace window is implemented; after it the
  existing billing block still disables the whole account at login. A
  read-only state needs a write gate across server actions.
- Cancellation at the end of the paid month. No cancellation record or UI
  exists yet.

## v2 implementation (18 Nov 2026)

## Founder gate

The 18:05Z founder direction said to implement per Noor's structure and not to
start until that structure arrived. It is already on the parent task
(KID-2434, document key `probe`): **"Pricing v2 implementation spec — edge
cases and test vectors"**, authored by Noor on 18 Nov 2026 and approved under
KID-2433. This implementation follows that document and the KID-2434 `plan`
document. No new rate card was invented.

## What changed

| Area | File | Change |
|---|---|---|
| Band pricing | `lib/billing.ts` (`cyclePricing`) | Selects the standard band from the cycle peak and bills the configured monthly amount. Enterprise+ = 2,500 + 20/child above 120; annual = 10x monthly; Enterprise+ annual is a quote and is never auto-generated. |
| Founding cohort | `lib/billing.ts` (`generateDueInvoices`) | Founding client keeps the band's `founding_monthly_egp` for the first 12 months (term 0). Each later 12-month review applies `min(standard, previous exact rate x 1.20)`. The cap never accelerates a band change and nothing is carried forward. |
| Pilot credit | `lib/billing.ts`, `lib/pricing.ts` | Configured pilot fee (350 EGP by default) credited on the first invoice when signed within `founding.pilot_credit_days` (14) of `pilot_end_date`. A smaller first invoice carries the remainder to the next invoice only; the balance never goes negative and is then expired. |
| Configuration | `pricing_band`, `pricing_config` | Every amount comes from the operator-editable rows. `updatePricingBand` and `updatePricingSettings` edits take effect on the next generated invoice. The configured founding cap is enforced when the flag is set. |
| Snapshot | `supabase/migrations/0047_kid2435_invoice_pricing_v2.sql`, `lib/sqlite-schema.ts` | Added `band_key`, `band_name`, `standard_monthly_egp`, `standard_amount_egp`, `applied_monthly_rate_exact`, `applied_monthly_rate`, `founding_applied`, `founding_term_index`, `glide_capped`, `pilot_credit_egp`. The KID-245 formula columns stay. |
| Operator surfaces | `/platform/pricing`, `/platform/daycares/[id]/billing`, `/platform/daycares/[id]/invoices` | Billing page preview uses the v2 band. Invoice list shows the frozen band, standard amount, founding/glide rate and pilot credit. The legacy flat/per-child inputs are marked as contract-only and no longer change an invoice. |
| Legacy plans | `lib/billing.ts` | The invoice engine no longer reads `monthly_rate_egp`, `per_child_rate_egp`, `free_child_threshold` or `annual_amount_egp`. `cycleAmountEgp` remains only for the historic KID-244 tests and old contract snapshots. |

## Decisions and edge cases

- **Peak snapshot (founder-confirmed).** The issue text says "cycle peak
  child count" and KID-245 already bills on the cycle's measured peak; the
  engine uses that same peak for band selection. The founder answered the
  saved `band_snapshot` question on 18 Nov 2026 with **cycle peak**, so the
  build is correct and no engine change was needed. Noor's section 1 wording
  ("active child count on the 1st") stays a documentation delta for Noor to
  correct; behaviour is unchanged.
- **Exact glide chain.** The 20% cap compounds on the unrounded rate and is
  rounded only when billed: 810 -> 972 -> 1,166.4 -> 1,399.68 -> billed 1,400,
  matching Noor's worked example and the "no invoice in months 1–12 exceeds
  the term rate" assertion.
- **Annual founding.** The year-1 rate uses 10x the founding monthly, keeping
  the annual rule. The Enterprise+ quote band is skipped with a loud
  `console.warn`; it never produces a zero or invented invoice.
- **Pilot credit scope.** The credit follows `pilot_end_date` and the signed
  date even when the daycare is not a founding client, matching the plan's
  pilot-to-paid path and the billing-page preview.
- **No silent failures.** The quote skip is logged; the existing best-effort
  invoice email keeps its explicit `console.error` path.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | pass |
| `npm run lint` | pass (existing `no-img-element` warnings only) |
| `env -u DATABASE_URL -u KIDDY_DATABASE_URL npm run db:verify-migrations` | all checks pass, including 0045 and 0047 on PGlite Postgres |
| `npx vitest run` — KID-2435 suite | 17/17 pass |
| `npx vitest run` — KID-2434, KID-244, KID-245, KID-246, KID-737, KID-1204, KID-203, KID-199, KID-746 | 139/140 pass; the one failure is pre-existing and unrelated (`kid199-platform-rework` expects 5 `roles.*` keys while `HEAD` already defines 7: `caregiver` and `teacher`). |

### Test coverage (Noor's vectors)

- Band boundaries: 1/15 -> 600; 16/30 -> 950; 31/50 -> 1,400; 51/80 -> 1,900;
  81/120 -> 2,500; 121 -> 2,520; 150 -> 3,100.
- Annual: 15 -> 6,000; 25 -> 9,500; 40 -> 14,000; 60 -> 19,000.
- Founding: 22 -> 810; review 1 -> 950. 45 -> 1,190; review 1 -> 1,400.
- Growth example: Core 810 at 24 children, grows to 35 in month 3, stays 810
  through month 12, then 972 -> 1,166 -> 1,400.
- Pilot: 950 - 350 = 600; Seed founding 510 - 350 = 160; remainder carry and
  never-negative.
- Snapshot: a later band edit leaves the issued invoice at its original
  amount.
- Founding cap: the configured cap is enforced in the data layer; a new
  founding flag past the cap is refused.

## Band snapshot decision (founder, 18 Nov 2026)

The saved question `band_snapshot` is answered: **cycle peak (current build)**.
The band is selected from the cycle peak child count used by the KID-245
snapshot, not from the active count at 00:00 on the 1st. This matches the
committed engine; there is no code change and the 17-test KID-2435 suite is
unchanged.

## Staging-first

The two KID-2435 commits were cherry-picked on top of `staging` (`cb8eae4`)
and pushed as `cb8eae4..a7cc0cf`, so Vercel's `kiddy-staging` project
auto-deploys them.

| Check | Result |
| --- | --- |
| `staging` tip after push | `a7cc0cf` (cherry-picked `76c87af` + the decision note) |
| `npx tsc --noEmit` on the staging tree | pass |
| `npm run lint` on the staging tree | pass (existing `no-img-element` warnings only) |
| `env -u DATABASE_URL -u KIDDY_DATABASE_URL npm run db:verify-migrations` | all checks pass (0045 and 0047 replayed on PGlite Postgres) |
| `npx vitest run` — KID-2435 + KID-2434 + KID-245 | 67/67 pass |
| Live deploy | `https://kiddy-staging-orcin.vercel.app/platform/pricing` moved from `404` (old build) to `307 -> /login` (new build) at 19:27Z |

Staging applies pending migrations through `lib/db.ts` on first database
access, so the founder's first login after the deploy applies `0045` and
`0047` to the staging Supabase project (`pjubkhhuccoqboypgpty`). Production
(`sfetmfmtoubtdyyeyudd`) is untouched; the production cut waits for the
founder's sign-off on staging.

## v3 follow-up: read-only after grace and end-of-month cancellation (19 Nov 2026)

`ff76fe4` shipped the monthly-only v3 scope. This follow-up adds the two
rules that were still missing and removes the hard billing disable:

- **Read-only after grace.** `applyOverdueEnforcement` no longer calls
  `setInstituteActive(false)`. An unpaid invoice past `due_date + grace_days`
  makes the account read-only (`isInstituteReadOnly`); login still works,
  every write is refused at the `authAccount()` boundary, and both layouts
  show the read-only banner. Self-service actions (language, password,
  payment proof, support ticket) stay available.
- **Cancellation at the end of the paid month.** `daycare_billing.cancel_at`
  stores the last paid day. `generateDueInvoices` bills no cycle that starts
  after it, and access becomes read-only the next day. Owners cancel or
  resume on `/portal/account-billing`; operators can set/clear the date on
  `/platform/daycares/[id]/billing`.
- **Migration `0049`** adds `institute.disabled_reason` so a manual disable
  is distinguishable from the old billing disable, re-enables rows the old
  sweep disabled, and adds `daycare_billing.cancel_at`.

Verification: `npx tsc --noEmit` pass; `npm run lint` pass (existing
`no-img-element` warnings); `npm run db:verify-migrations` all pass (0049
replays on PGlite Postgres); KID-2435 + KID-2434 + KID-244 + KID-245 +
KID-746 + KID-850 suites pass (96/96). The single earlier KID-245 run
recorded seven hook timeouts under parallel load; re-running that file alone
passes 27/27. No production or staging deploy.

## v3 follow-up: one subscription per branch (19 Nov 2026)

The founder answered the **Branch subscription record** card (`2d9a63f5`)
on 19 Nov 2026:

- the **branch** record holds the subscription;
- a branch with **no active children is billed 0**: it is not invoiced until
  its first active child;
- a new branch that joins a founding group uses **one new slot** and gets the
  founding rate for 12 months from its own start;
- a branch's first billed month starts on the **1st of the month after the
  branch is created** (the demo covers the gap).

What changed:

- **Migration `0050` + SQLite mirror.** New `branch_billing` table keyed by
  `branch_id` (institute_id retained for tenant scope) holds the plan, first
  cycle, founding flag/dates, pilot end, cancellation date and legacy amounts.
  Every branch is backfilled; the institute's first branch copies today's
  `daycare_billing` row, later branches start on the same plan with their own
  cycle. Institutes with no branch get a `Main` branch. `daycare_invoice` gains
  `branch_id`; the unique rule moves from `(institute_id, cycle_month)` to
  `(branch_id, cycle_month)`.
- **Engine per branch.** `generateDueInvoices` resolves the band from that
  branch's cycle peak and writes one invoice per branch. A zero-child branch
  is skipped entirely (no zero-value invoice) and is re-checked later. The
  institute's first branch also owns legacy children with no `branch_id`.
  Counts and snapshots keep the existing fields; `founding_term_index` is
  measured from the branch's own `founding_started_at`. The branch date shapes
  (Postgres `Date` objects and SQLite text) are normalised with `datePart`, so
  the staging-only "Thu Oct 01" bug cannot return through `branch_billing`.
- **Founding slots.** `countFoundingClients` counts `branch_billing` rows.
  A branch added to a founded group is enrolled automatically (one slot, own
  12-month start); a full cohort leaves it on the standard rate. The cap is
  enforced in both the per-branch and group writers.
- **Operator surface.** `/platform/daycares/[id]/billing` now renders one card
  per branch (plan, cycle, founding/pilot, cancellation) and saves through
  `updateBranchBillingAction`. The invoice list shows the branch column. The
  group row remains for the owner portal/create form and a group edit fans out
  to every branch.
- **Read-only.** Account read-only still starts with any overdue invoice. A
  cancellation makes the account read-only only when every billed branch is
  past its own paid month, so cancelling one branch does not lock the group.

Verification: `npx tsc --noEmit` pass; `npm run lint` pass (existing
`no-img-element` warnings); `npm run db:verify-migrations` all pass (0050
replays on PGlite Postgres); KID-2435 (including the new branch suite),
KID-2434, KID-244, KID-245, KID-246, KID-746 and KID-850 suites pass
(115/115). One KID-245 run recorded the known 10s hook timeout under load;
the file alone passes 27/27. Nothing deployed; production and staging are
untouched.

## Staging attempt blocked by the Vercel pipeline (19 Nov 2026)

The three v3 commits (`ff76fe4`, `c6dcaff`, `efe0cd4`) were cherry-picked onto
`staging` after resolving the date-shape conflict, and pushed as
`1330b0c..ffa7581`. The staging tree was verified before the push:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | pass |
| `npm run db:verify-migrations` | all pass (0050 on PGlite Postgres) |
| KID-2435 branch + engine, KID-244, KID-245, KID-2434, KID-246 | 93/93 pass |
| `next build` with a test `SESSION_SECRET` | pass |

The Vercel GitHub statuses for `ffa7581` report `failure` for
`kiddy-staging` (`dpl_7FrZSZBgsTAtftf4ZASZCzd3bppK`) and `kiddy`
(`dpl_BkEE8BYFneqZn5svwXXodZeCWjHE`). The same failure is already present on
the previous `staging` tip `1330b0c` (KID-2447), so it predates this change.
`https://kiddy-staging-orcin.vercel.app` still serves `e7e8241` (the v2
build): a signed-in visit to `/platform/daycares/[id]/billing` shows the old
single-daycare form, not the per-branch cards. Production is unchanged; the
failed production build never promoted.

## Pipeline root cause and fix (19 Nov 2026)

A Vercel token was available in this run, so the failed build was read from
the Vercel API. The failure is not a code or build error:

> Hobby accounts are limited to daily cron jobs. This cron expression
> (`* * * * *`) would run more than once per day. Upgrade to the Pro plan to
> unlock all Cron Jobs features on Vercel.

KID-2447 added a per-minute `crons` entry to `vercel.json`
(`/api/attendance/sweep`, `* * * * *`). The `kiddy2` team is on the Hobby
plan, so Vercel rejects the deployment before it builds. The same message is
returned for every failed deployment on both projects
(`dpl_7FrZSZBgsTAtftf4ZASZCzd3bppK` / `dpl_BkEE8BYFneqZn5svwXXodZeCWjHE` and
the later retries). The last successful production deployment is master
`a035c5e`; the every-minute cron has not deployed to either project.

Fix in this change: remove the `crons` block from `vercel.json`, leaving
`regions` as before. The sweep route, its `CRON_SECRET` gate and the
page-load sweep are untouched, so no behavior is lost relative to what was
actually deployed. A genuine every-minute schedule on this Vercel plan needs
one of:

- Pro Cron Jobs, or
- an external scheduler (Supabase `pg_cron`/`pg_net`, or any uptime job) that
  calls `GET /api/attendance/sweep` with `Authorization: Bearer $CRON_SECRET`.

The per-minute auto check-out at closing is therefore **not** active on
staging or production until one of those is set up; the sweep still runs when
attendance or the dashboard is opened, which is the documented staging test
path.

## Staging is live after the fix (19 Nov 2026)

Commit `527dcd9` (the cron removal) was cherry-picked from
`demo-video-teacher-finals`, and `staging` was pushed `ffa7581..527dcd9`.
Vercel deployment `dpl_E7uUMHRD7p6Z8vDKnGeTiGx6rAyC` reached `READY`
(`BUILDING` at 21:42:36Z, `READY` at 21:43:23Z) and
`kiddy-staging-orcin.vercel.app` was assigned to it. The previous staging
build was v2 `e7e8241`; this is the first staging deployment of the v3 branch
code.

Browser verification (Skyvern, staging superadmin
`founder.superadmin@staging.kiddy.test`):

| Step | Observation |
| --- | --- |
| `/login` → sign in | lands `/platform`, heading "Daycares" |
| `/platform/daycares/mwmk77e9-zxp7hwli/billing` | heading "Billing settings"; summary `Current plan: monthly`, `Bills now: 950 EGP`, `Enrolled children: 22`, `Pricing v2 band: Core (16-30)`, `Standard monthly: 950 EGP`, `Founding year-1 monthly: 810 EGP`, `Pilot credit: 350 EGP` |
| same page, branch section | **`Branch subscriptions: 1`** and **`Branch: Main (primary)`** with the same Core/950/810/350 values |
| same page, founding fields | Founding client, Founding start, Pilot end, Cancellation date and "Save billing settings" are present; the helper says the engine applies the founding rate for months 1–12 and the standard band from month 13 |
| `/platform/daycares/mwmk77e9-zxp7hwli/invoices` | heading "Invoices"; the row has a **Branch** column with **`Main`**, cycle `2026-10`, `Plan: monthly`, status `Paid` |
| Console | only the pre-existing `/favicon.ico` 404 |

Evidence artifacts are in the Skyvern run `tsk_598896783461327284`
(`html_scrape` captures of the billing and invoice pages, HAR and console
log). The fixture invoice was not modified.

Production Vercel project, production Supabase project and the production
deployment remain on their previous successful state; no production cut was
made.

## Operator page simplification (19 Nov 2026 feedback)

The founder rejected the “Test branch billing on staging” card with a UI
change request: show a short band reference at the top, choose demo or monthly
from a plan drop-down, ask for the band when monthly is selected, and remove
the bus-tracking and branded-app ticks (both always on).

Commit `d6ebc53` implements it; `staging` was pushed `18fa06f..6be8459`.

**What changed**

- **Band reference.** `app/platform/pricing-reference.tsx` renders band name,
  child range, standard monthly and founding year-1 at the top of
  `/platform/pricing`, the per-daycare billing page and the create-daycare
  form. Enterprise+ shows `2,500 EGP + 20 per child above 120` and “Quote”
  for the founding amount.
- **Plan and band pickers.** `billing-plan-fields.tsx` is a small client
  island: the plan drop-down offers Demo and Monthly; when Monthly is chosen
  the Band drop-down appears (with `Automatic (from child count)` as the
  default).
- **Selectable band.** Migration `0052_kid2435_band_selection.sql` adds
  `band_key` to `daycare_billing` and `branch_billing`. An empty value keeps
  the approved automatic cycle-peak band selection; a set value pins the
  subscription to that band. The create form and the per-branch form both
  write it, and the invoice engine (`cyclePricing`) honours it.
- **Always on.** The bus-tracking band tick and the demo branded-app / bus
  checkboxes are gone. The save actions force both on; migration `0052`
  normalises existing rows to the always-on state.

**Verification**

- `npx tsc --noEmit` pass.
- `npm run lint` pass (existing `no-img-element` warnings only).
- `npm run db:verify-migrations` pass, including `0052` on PGlite Postgres.
- `npm run build` pass.
- KID-2435 (engine + branch), KID-2434, KID-244, KID-245, KID-246, KID-746,
  KID-850: 118/118 pass, including three new band-selection tests.
- **Live staging HTML scrape** (Skyvern run `tsk_598920066479039144`):
  `/platform/pricing` shows `Bands — child counts and monthly prices` with all
  six rows and only one checkbox left (founding enabled). No
  `busTrackingIncluded`, `demoBrandedApp` or `demoBusTracking` field remains.
- **Create form** (Skyvern run `tsk_598922587624843040`): the reference table
  sits above the `Billing plan` drop-down; the legacy rate fields are gone.
- **Per-daycare billing page**, rendered from the same code against a fresh
  SQLite database: `Billing settings` shows the reference table first, then
  `Branch subscriptions: 1` / `Branch: Main (primary)`; with the branch on
  monthly, the `Band` drop-down lists Automatic plus all six bands.
