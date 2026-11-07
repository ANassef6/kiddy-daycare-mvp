# KID-489 item 2 (KID-491) — Instapay link in center settings and on parent invoices

## What changed in the repo

- `supabase/migrations/0033_instapay_payment_link.sql` (new) — idempotent
  `ALTER TABLE institute ADD COLUMN IF NOT EXISTS instapay_url TEXT` and
  `ALTER TABLE child_billing ADD COLUMN IF NOT EXISTS payment_link TEXT`.
  No NOT NULL/DEFAULT write: existing invoices and centers keep the exact
  shape they had (existing invoices render unchanged).
- `lib/sqlite-schema.ts` — the SQLite mirror gains both columns on the same
  tables, so the test engine matches production.
- `lib/instapay.ts` (new) — `parsePaymentLink()` is the single boundary
  validator: blank → `NULL` (no link), absolute `http`/`https` URLs accepted
  as given, everything else (`ftp:`, `javascript:`, relative text) rejected.
- `app/portal/settings/page.tsx` — Center details gains an "Instapay link
  (optional)" URL field (EN/AR label + hint) and reads `?error=instapay`
  into a localized rejection banner.
- `lib/actions.ts` —
  - `saveCenterDetailsAction` validates the Instapay URL before any write;
    an invalid value redirects to `/portal/settings?error=instapay`
    (nothing is stored), a valid one is saved (or cleared) and attributed in
    the center-profile audit metadata.
  - `addChildBillingAction` stores the invoice's own payment link; an
    invalid value refuses the whole create with
    `/portal/children/<id>/billing?error=paymentlink` — no half-written
    invoice.
- `lib/store.ts` — `createChildBilling` accepts `paymentLink` (blank/omitted
  → `NULL`).
- `app/portal/children/[id]/billing/page.tsx` — the "Add a billing record"
  form gains a "Payment link (Instapay, optional)" field prefilled from the
  center's saved Instapay URL (per-invoice override); the invoice table shows
  a "Pay" column with the same link so center staff can verify it.
- `app/child/[id]/page.tsx` — the parent-facing child surface gains an
  Invoices section (after the daily report): description/period, due date,
  amount + stored currency, status badge, and — only when the invoice has a
  stored link — a "Pay with Instapay" button opening the Instapay URL in a
  new tab. The section sits inside the existing KID-372 gate
  (`isChildVisibleToAccount`), which only authorizes an account's own
  `family_member` rows, so a parent can never render another family's child
  (and therefore payment link). Invoice statuses/behavior untouched.
- `lib/i18n.ts` — EN + AR keys: `settings.instapayLink{,Placeholder,Hint,Invalid}`,
  `profile.paymentLink{,Invalid}`, `child.invoicesTitle`, `child.payWithInstapay`,
  `child.invoiceDue`, `child.noInvoices`.
- `tests/unit/kid221-arabic-consistency.test.tsx` — the language-neutral
  token allowlist gains `instapay`, `http`, `https` (the payment brand and
  the protocol words stay untranslated inside the Arabic labels), and the
  settings-page render passes `searchParams` (new parameter surface).

## Acceptance evidence (focused suite `tests/unit/kid489-instapay-payment-link.test.tsx`, 17 tests on the isolated SQLite fixture)

- **Center admin saves a valid Instapay URL and sees it retained after
  reload** — "an admin saves a valid URL and it survives reload": the action
  persists `instapay_url` and the settings page re-renders the saved URL back
  into the Center details field.
- **Invalid/non-http URLs are rejected** — "an invalid value is rejected
  with the error banner and nothing is stored": `ftp://x` and `not-a-url`
  bounce to `/portal/settings?error=instapay`, the previously saved link is
  untouched, and the page renders the `settings.instapayLinkInvalid` banner.
- **New-invoice form prefills the center link** — "the form prefills the
  center's Instapay link" renders the center URL as the field's defaultValue.
- **Override + persistence** — an explicit per-invoice link overrides the
  center default and is stored; a *cleared* prefill stores an invoice
  WITHOUT a link (`payment_link IS NULL`), so the daycare controls each
  invoice individually.
- **Invalid link refuses the create** — `javascript:alert(1)` and unschemed
  text redirect to `/billing?error=paymentlink` and no "Bad link" invoice row
  exists.
- **Parent sees a working clickable payment link** — an invoice with a link
  renders `href="https://instapay.eg/pay/demo-daycare"` with
  `target="_blank"` and the localized "Pay with Instapay" label on the
  parent child surface.
- **Existing invoices without a link render unchanged** — the legacy invoice
  shows description/amount/status with NO `target="_blank"` (no button).
- **Tenant isolation** — an unrelated parent (no `family_member` row, the
  KID-372 rule) cannot render the child page at all
  (`NEXT_NOT_FOUND`), so another family's invoice/payment link is
  unreachable; the parent view itself reads invoices only after that gate.
- **Statuses intact** — no invoice status/behavior surface was modified in
  this item (status selects, update flows, overdue handling untouched).
- **EN + AR labels shipped** — pinned for `settings.*`, `profile.paymentLink`,
  `child.payWithInstapay` in both dictionaries.

## Local checks

- `npm test` — full suite green (769 tests; one first-run worker timeout
  under machine congestion was re-verified green standalone, and the final
  full-suite run is green).
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean (pre-existing `<img>` warnings only).
- `npm run db:verify-migrations` — PGlite run, "All migration checks passed".
- `npm run build` — Next.js production build succeeds.

## Merge + deployment

- PR #28 merged to master: merge commit `bf73186`
  (`Merge pull request #28 from ANassef6/kid489-instapay-payment-link`),
  branch `kid489-instapay-payment-link`, head `65eb5f7`.
- PR checks: Vercel + Vercel Preview Comments `pass`, Supabase Preview
  `skipping`.
- Production deployment of that merge: GitHub deployment `7614670780`
  (2026-11-07T01:25:38Z, vercel[bot], sha `bf73186…`), latest status
  `21627756718` = `success` ("Deployment has completed"), URL
  https://kiddy-9p0mw0396-kiddy2.vercel.app (master auto-deploys on Vercel).
- Post-deploy smoke on the production URL: `/` → **200**, `/login` → **200**;
  migration `0033` applies idempotently on the first request via
  `ensureSchema` (ledger-tracked, runs exactly once, no data rewrites).
