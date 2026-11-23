# KID-2460 — Arabic portal sidebar/tabs and RTL behavior

## Environment

- Staging: https://kiddy-staging-orcin.vercel.app
- Branch under test: `staging` at the KID-2460 merge (`0ba63ce`), deployed as
  `8c33789` (`kid2460-rtl-tabs`) and promoted to the staging alias.
- Accounts: `founder.owner@staging.kiddy.test` (staff/owner portal),
  `founder.parent@staging.kiddy.test` (parent portal).
- Capture: Skyvern 1.0 against the staging URL, viewport 1920x1140 (portal) and
  1600x1200 (child profile).

## Root cause

The sidebar labels were never hardcoded and no AR dictionary key was missing.
The English sidebar was a **stale layout**: the Account Settings language
switch submitted a server action, and a server-action redirect is a client-side
navigation. The App Router keeps already-mounted layouts, so the page segment
re-rendered with the Arabic dictionary while the root `<html lang dir>` and the
portal layout kept their old English/LTR props. The founder screenshot is that
exact mixed state: Arabic dashboard content inside an English, LTR shell.

Two secondary defects were visible on the same shell:

- the collapsed group chevron always pointed inline-end (`>`), so in RTL it
  pointed back toward the label;
- a locale change made in another tab/device left this tab's shell stale until
  a manual reload.

## Fix

- `LanguageSettingsCard` now posts natively to `POST /switch-app-lang`. The
  route validates the same-origin request, saves `account.language`, sets the
  `kiddy_lang` cookie and answers `303` (a full document navigation). Every
  layout, direction and nav label re-resolves from the saved account language.
  The old `saveLanguageAction` was removed.
- `components/LocaleGuard.tsx` is mounted on the portal and parent shells. On
  mount, focus, visibility and bfcache restore it asks `GET /api/locale` for
  the account's current locale and reloads once if the document is stale. This
  covers a language change made in another tab/device.
- `html[dir="rtl"] .portal-nav-toggle svg { transform: scaleX(-1) }` mirrors
  the collapsed chevron; the expanded (up) chevron is unchanged.

## Verification on staging

1. Signed in as the owner, opened Account Settings, switched English → Arabic,
   saved, and loaded the dashboard. The full document reloaded in Arabic:
   sidebar on the right, group labels in Arabic, nested links in Arabic.
2. Repeated the same flow in reverse (Arabic → English): sidebar on the left,
   all labels English.
3. Opened a child profile: the tab bar renders Arabic labels in RTL order.
4. Signed in as the parent, switched to English and then Arabic, and reloaded
   `/child/settings` after each switch: every header nav label follows the
   selected language on the same shell.

## Screenshot matrix

| Locale | Surface | File |
| --- | --- | --- |
| EN / LTR | Staff portal dashboard (owner) | `en-portal-dashboard.png` |
| AR / RTL | Staff portal dashboard after English → Arabic switch | `ar-portal-dashboard.png` |
| EN / LTR | Parent portal header nav | `en-parent-nav.png` |
| AR / RTL | Parent portal header nav (settings page) | `ar-parent-settings-nav.png` |
| AR / RTL | Staff portal child profile tabs | `ar-child-profile-tabs.png` |

In `ar-portal-dashboard.png` the collapsed group chevrons point left (`‹`) and
the sidebar is on the right; in `en-portal-dashboard.png` they point right and
the sidebar is on the left. The child-profile tabs start from the right in
Arabic.

## Automated checks

- `tests/unit/kid2460-rtl-tabs.test.tsx` — 14/14 green: AR/EN sidebar label
  trees, RTL chevron rule, native POST card, `POST /switch-app-lang` (save,
  invalid locale, external `next`, cross-origin, unauthenticated) and
  `GET /api/locale`.
- Related suites green: `kid221-arabic-consistency`, `kid453-rtl-shell-grid`,
  `kid255-child-nav`, `i18n`, `i18n-page-coverage`, `kid199-account-menu`,
  `kid472-parent-support-nav`, `kid2406-nav-perf` (81 tests).
- `tsc --noEmit` clean; `next lint` reports only the pre-existing `<img>`
  warnings; `next build` green with `/switch-app-lang` and `/api/locale`.
- Known pre-existing failure on the staging baseline:
  `tests/unit/parent-account-enhancements.test.ts` (KID-144 classroom-thread
  scope) fails identically with the KID-2460 change stashed. It is unrelated to
  nav/i18n and is not introduced here.

## Production

Staging only. The production cut stays gated on founder sign-off and
coordination with Mika.
