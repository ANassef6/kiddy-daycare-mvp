# KID-2435 — staging superadmin gate for the billing module

Date: 2026-11-18 (UTC)
Owner: Cody

## Why

The founder rejected the first staging confirmation card: the credentials he
had were the daycare owner/teacher/parent logins from KID-2440, so the only
portal he could open was the tenant admin portal. The pricing-v2 work lives in
the platform operator surface (`/platform`), which had **no operator account on
staging** — `/platform/pricing` redirected to `/login` and no allowlisted email
existed. He asked for the staging superadmin portal.

## What changed

| Change | Where |
| --- | --- |
| Staging operator allowlist + password (`PLATFORM_ADMIN_EMAIL`, `PLATFORM_OPERATOR_PASSWORD`) | Vercel project `kiddy-staging` (`prj_y7RmNSA2392TBFb4pDmhP6swmZdF`), all targets |
| Documented the operator portal, credentials and page URLs | `docs/STAGING.md` |
| Postgres DATE handling fix in `rowToBilling` (`datePart()` instead of `String().slice`) | `lib/billing.ts` |
| Regression tests for Date and text date shapes | `tests/unit/kid2435-invoice-pricing-v2.test.ts` |
| Billing fixture with a real v2 invoice | `scripts/seed-staging-billing-fixture.ts` |

### The DATE bug

`rowToBilling` read `first_cycle_start`, `founding_started_at` and
`pilot_end_date` with `String(value).slice(0, 10)`. The Supabase Postgres
driver returns DATE columns as `Date` objects, so the engine saw
`"Thu Oct 01"` instead of `"2026-10-01"` and skipped every billing calendar —
**no invoice was generated on staging at all**, and the first-invoice pilot
credit could never be evaluated. The SQLite tests never caught it because
they store text. `datePart()` already existed for exactly this engine
difference; the fix routes the three fields through it, and two new tests pin
both shapes.

## Staging operator

| Item | Value |
| --- | --- |
| Login | https://kiddy-staging-orcin.vercel.app/login |
| Email | `founder.superadmin@staging.kiddy.test` |
| Password | `12345678` (staging-only) |
| Lands on | `/platform` |

Pages for the KID-2435 review:

- `/platform` — daycare list
- `/platform/pricing` — bands, annual rule, demo plan, founding cohort
- `/platform/daycares/<id>/billing` — per-daycare plan, founding flag, pilot
  dates, band preview
- `/platform/daycares/<id>/invoices` — frozen v2 snapshot columns

## Billing fixture

`scripts/seed-staging-billing-fixture.ts` created **Billing Test Daycare**
(`billingtest`) in the staging DB (`pjubkhhuccoqboypgpty`):

- 22 active children enrolled Oct 2026 (cycle peak) → Core band
- founding client, signed 2026-10-01, pilot ended 2026-09-25 (inside 14 days)
- one issued invoice for cycle 2026-10, marked paid:

| Field | Value |
| --- | --- |
| Band | `core` (16–30) |
| Standard | 950 EGP |
| Applied founding rate (exact) | 810 |
| Pilot credit | 350 |
| Total | 460 EGP |
| Status | paid (so the overdue rule never disables the fixture) |

## Verification (staging tree)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | pass |
| `npm run lint` | pass (existing `no-img-element` warnings only) |
| `npx vitest run tests/unit/kid2435-invoice-pricing-v2.test.ts` | 19/19 pass (17 previous + 2 date-shape regressions) |
| Fixture run against staging Postgres | `generated: 1`, snapshot above |
| Browser login as `founder.superadmin@staging.kiddy.test` | lands `/platform` |
| `/platform/pricing` | 200, "Pricing configuration", 6 bands |
| `/platform/daycares` | 200, "Daycares" |
| `/platform/daycares/<id>/billing` | 200, "Billing settings", v2 band preview |
| `/platform/daycares/<id>/invoices` | 200, "Invoices", fixture invoice with v2 columns |
| Console errors | only the pre-existing `/favicon.ico` 404 |

Production Vercel project, production Supabase project
(`sfetmfmtoubtdyyeyudd`) and the production deployment were not touched.
