# KID-489 item 1 (KID-490) — EGP option and center default currency dropdown

## What changed in the repo

- `lib/currency.ts` (new) — the one central supported-currency list
  (`EGP, AED, USD, CAD, GBP, EUR, SAR`), `DEFAULT_CURRENCY = "EGP"`, and
  `normalizeCurrency()` (trims/uppercases, clamps out-of-list values to a
  fallback). Every currency selector and display fallback now reads from here.
- `supabase/migrations/0032_center_default_currency.sql` (new) — idempotent
  `ALTER TABLE institute ADD COLUMN IF NOT EXISTS default_currency TEXT NOT NULL
  DEFAULT 'EGP'`. Existing invoice rows are never rewritten.
- `lib/sqlite-schema.ts` — the SQLite mirror gains the same
  `default_currency TEXT NOT NULL DEFAULT 'EGP'` column on `institute`.
- `app/portal/settings/page.tsx` — Center details gains a
  "Default currency" select (central list, current center value preselected).
- `lib/actions.ts` — `saveCenterDetailsAction` persists `default_currency`
  (normalized; only when the field is present) and attributes the change in the
  audit metadata. `addChildBillingAction` now falls back to the center default
  currency (previously hardcoded `CAD`) when the form's currency is blank, and
  normalizes any explicit choice against the central list.
- `lib/store.ts` — `createChildBilling` falls back to the central platform
  default (EGP) instead of a hardcoded `CAD` when a caller omits the currency.
- `app/portal/children/[id]/billing/page.tsx` — the Currency select renders the
  central list and defaults to the center's currency; the outstanding-balance
  fallback follows the center default; the "Amount (CAD)" label is neutral.
- `app/portal/finance/page.tsx` — no hardcoded AED anywhere: per-invoice rows
  show their own stored currency with the center default as fallback; status
  cards, outstanding/all totals, payer totals and the subtitle follow the
  center default.
- `app/portal/children/[id]/page.tsx` — the child-profile invoice tab uses each
  invoice's stored currency (center default for the mixed summary), not
  hardcoded AED.
- `app/api/export/route.ts` — the billing CSV export falls back to the center
  default currency instead of hardcoded AED.
- `lib/i18n.ts` — `settings.defaultCurrency` label shipped in EN
  ("Default currency") and AR ("العملة الافتراضية").
- `tests/unit/kid221-arabic-consistency.test.tsx` — the Arabic-shell guard's
  language-neutral token allowlist now also carries the ISO currency codes
  (`aed/usd/gbp/eur/sar`, joining `egp/cad`) that the central list renders as
  `<option>` text on the Arabic settings page.
- `tests/unit/kid489-egp-default-currency.test.ts` (new) — 11 focused tests.

## Acceptance evidence (local, isolated SQLite fixture)

- **EGP appears in every currency selector and finance display path** —
  `kid489-egp-default-currency.test.ts` pins the central list; the finance
  page, child billing select, child-profile invoice tab, and billing CSV export
  all read it (`grep -rn '"AED"' app` and `grep -n 'CAD' lib/actions.ts`
  return no hardcoded display/insert fallbacks; only `lib/billing.ts` platform
  amounts keep EGP, which is the platform's own operating currency).
- **Admin can set the center default currency and it survives reload** —
  test "an owner saves the default currency, reloads, and sees it retained":
  `saveCenterDetailsAction` with `defaultCurrency: USD` → the row reads
  `default_currency = 'USD'` after the action; the settings select renders
  `defaultValue` from the stored column on reload. An out-of-list value
  (`BTC`) clamps to `EGP` instead of being stored raw.
- **A new invoice created after changing the default uses the new currency** —
  tested for both EGP (center default EGP → new invoice `EGP`) and USD (center
  default switched to USD → next invoice `USD`), via `addChildBillingAction`
  with a blank/absent currency field. An explicit per-invoice choice still
  wins (`GBP` test).
- **Existing invoices keep their original currency** — test "an existing
  invoice keeps its stored currency when the default changes": a stored `CAD`
  invoice is untouched after the default changes and a new `EGP` invoice lands.
- **Migration mirrored in SQLite** — `npm run db:verify-migrations` applies the
  whole Postgres chain (including `0032`) on PGlite Postgres 17: "All migration
  checks passed." The SQLite mirror is exercised for real by the fixture (a
  fresh seeded center reads `default_currency = 'EGP'`).
- **Focused tests** — `tests/unit/kid489-egp-default-currency.test.ts`: 11/11.
- **Full suite** — 73 test files / 751 tests: zero failures
  (`Test Files 72 passed (73)`, `Tests 738 passed (751)`, no failed tests; the
  73rd file, `kid171-parent-contact-and-messaging.test.tsx`, had its result
  reporting eaten by a vitest-worker RPC timeout on this shared machine and
  passes 13/13 in isolation — re-run verified). Includes the updated kid221
  Arabic-shell guard.
- `npx tsc --noEmit`: clean. `npm run lint`: clean (pre-existing `<img>`
  warnings only). `npm run build`: clean (Next.js production build).

## Rendered-UI evidence

Captured against the isolated fixture (the kid221 harness pattern:
`renderToStaticMarkup` with an injected owner session):

- `/portal/settings` Center details renders the new select (fresh fixture,
  EGP preselected):

  ```html
  <select class="select" name="defaultCurrency">
    <option value="EGP" selected="">EGP</option>
    <option value="AED">AED</option>
    <option value="USD">USD</option>
    <option value="CAD">CAD</option>
    <option value="GBP">GBP</option>
    <option value="EUR">EUR</option>
    <option value="SAR">SAR</option>
  </select>
  ```

- Saving `USD` through the real action stores
  `{"default_currency":"USD"}` and the re-rendered select keeps USD
  preselected after reload:

  ```html
  <select class="select" name="defaultCurrency">
    <option value="EGP">EGP</option>
    <option value="AED">AED</option>
    <option value="USD" selected="">USD</option>
    ...
  </select>
  ```

- `addChildBillingAction` with a blank currency field for that center stores
  the center default on the new `child_billing` row:
  `{"currency":"USD","amount_cents":12345}`.

## Merge + deployment

- PR to `master` recorded here after checks pass; master auto-deploys on
  Vercel. Merge commit and deployment status are appended below.

(merge/deployment evidence appended after merge)
