# KID-2400 evidence — full Arabic localization render verification

Verification of commit `01754e3` (branch `kid2400-full-arabic-localization`), run against a
local server on port 3123.

## What was verified

### 1. Automated HTML verification (no browser needed)

- `verify-ar.mts` run: every Phase 1 portal route fetched with a minted `kiddy_sess`
  cookie for `arabic-admin@example.test` (`account.language = "ar"`) plus `kiddy_lang=ar`.
  Each page's Arabic heading/labels asserted in the HTML, and `dir="rtl"` /
  `<html lang="ar">` asserted on every 200 response. The three pure-redirect routes
  (`/portal/inquiries`, `/portal/reports`, `/portal/children/development`) were asserted
  to 307-redirect to their localized targets. **Result: 23/23 OK** (`ar-render-results.json`
  in the task scratch dir).
- `verify-en.mts` run: same routes with `account.language = "en"`; English headings
  asserted, no unexpected `dir="rtl"`. **Result: 15/15 OK** (EN regression pass).
- `verify-public-ar.mts` run: `/login`, `/register`, `/forgot-password`, `/reset-password`,
  `/unknown-daycare`, `/` fetched anonymously with `kiddy_lang=ar`; Arabic strings +
  `dir="rtl"` asserted. **Result: all OK.**

### 2. CI gates

- `npx vitest run` (full suite): **110 files / 1213 tests passed**, including the new
  `tests/unit/i18n-page-coverage.test.ts` (page dictionary-coverage guard + ar/en
  divergence guard) and `tests/unit/i18n.test.ts` (EN/AR parity).
- `npm run lint`: clean (one pre-existing `<img>` warning in portal newsfeed, untouched).
- `npm run build`: green.
- `npx tsc --noEmit`: clean.

### 3. Screenshots (this directory)

`ar/` and `en/` each contain 18 PNGs captured through Skyvern browser automation against
the local server: the 15 reachable Phase 1 portal pages (plus dashboard), and the
/login, /register, /forgot-password flows. Screenshots were paired to steps by
Skyvern `step_id`, and each PNG was selected only when the step's HTML snapshot contained
a content-unique marker for the target page; ambiguous candidates were checked visually.
Spot-verified by eye: ar dashboard, attendance, children, finance, drive, forms
(inquiries view), register, calendar, incidents; en attendance.

Notes:
- AR portal sessions ran as `arabic-admin@example.test` (`account.language = "ar"`),
  EN sessions as the seeded owner (`language = "en"`).
- `ar/portal-forms.png` shows the `/portal/inquiries` view, which is
  `app/portal/forms/page.tsx` rendering `?view=inquiries` (the inquiries tab of the same
  localized page; the standalone forms view was covered by the same page's HTML checks).
- The local server ran with `NODE_ENV=development` (`next dev`) because the production
  session cookie is `Secure` and cannot be set over plain HTTP — browser-only constraint,
  no product change.

## Tooling notes (for future runs)

- Skyvern browser sessions pin their first task in this build; per-task runs were used.
- The middleware `?lang=` override persists the language cookie only on the five
  marketing paths, so an anonymous `/login?lang=ar` first hit renders English;
  visiting `/?lang=ar` first (or sending the cookie directly) renders Arabic.
