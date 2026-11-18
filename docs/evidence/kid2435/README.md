# KID-2435 — pricing v2 bands and founding cohort in the invoice engine

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

Per the standing rule this work is on the working branch only. It is not
deployed to staging or production by this run; the founder tests on staging
and signs off before the production cut.
