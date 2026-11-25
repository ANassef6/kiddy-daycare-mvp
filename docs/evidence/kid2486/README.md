# KID-2486 — center settings cleanup (staging verification)

## Environment

- Staging: https://kiddy-staging-orcin.vercel.app
- Branch: `staging` after PR #124 (`8a59a11`, which merges KID-2486 `796c7c1`
  on top of KID-2477 `b56ad75`).
- Accounts: `founder.owner@staging.kiddy.test` (center admin) and
  `founder.superadmin@staging.kiddy.test` (platform operator).
- Capture: Playwright Chromium headless, viewport 1440×1000, full page.
- The owner account was switched to English and then Arabic through the
  account-level language switch (`POST /switch-app-lang`) before each capture.
  The superadmin account was restored to English after the run.

## What changed

- Center Settings no longer mounts `LanguageSettingsCard`. Account-level
  switching stays on Account settings (and the parent settings page).
- `Center name` is rendered read-only and dimmed on Center Settings with a
  "set by the platform team" hint. `saveCenterDetailsAction` never writes
  `institute.name`, so a tampered form field cannot rename the center.
- The Branding card no longer carries a second `Daycare name` field.
  `saveBrandingAction` writes only the colors and font.
- The platform `/platform` daycare table carries a per-row `Center name`
  rename form through `updateDaycareNameAction` (platform-operator only,
  audited, branding cache purged).
- Every branding surface keeps reading `institute.name` through
  `brandingFromInstitute` (login page, brand-banner alt text, `/api/branding`).

## Live verification matrix

| Locale | Surface | Result |
| --- | --- | --- |
| EN / LTR | `/portal/settings` | 1 name field, `readonly`, dimmed; no App language card; no Daycare name field; locked hint present |
| AR / RTL | `/portal/settings` | `lang="ar" dir="rtl"`; 1 name field, `readonly`; no App language card; no Daycare name field; Arabic locked hint present |
| EN / LTR | `/platform` | 4 per-daycare rename inputs (one per tenant row) and `Save name` buttons |
| AR / RTL | `/platform` | `lang="ar" dir="rtl"`; 4 rename inputs and Arabic `حفظ الاسم` buttons |

## Screenshot matrix

| Locale | Surface | File |
| --- | --- | --- |
| EN / LTR | Center settings | `en-center-settings.png` |
| AR / RTL | Center settings | `ar-center-settings.png` |
| EN / LTR | Platform daycare table rename | `en-platform-center-name.png` |
| AR / RTL | Platform daycare table rename | `ar-platform-center-name.png` |

Observed on the EN center-settings capture: the name input is visibly dimmed
and carries the platform hint; the branding card shows only Primary color /
Accent color / Font / Save branding. The AR capture shows the same layout
mirrored, with the Arabic hint.

## Automated checks

- `npx tsc --noEmit`
- `npx eslint` on the changed files
- `npx vitest run tests/unit/kid2486-center-settings.test.tsx tests/unit/kid489-instapay-payment-link.test.tsx` — 28 passed
- `npx vitest run tests/unit/kid2477-platform-settings.test.tsx tests/unit/kid2486-center-settings.test.tsx` on the integrated staging tree — 19 passed
- GitHub: `Cloudflare Workers verify` and `dependency-audit` passed on PR #124.

## Gates

Production cut is **not** performed. It stays gated on founder sign-off on
staging, per the issue acceptance criteria.
