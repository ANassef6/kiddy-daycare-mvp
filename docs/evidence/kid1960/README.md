# KID-1960 — WCAG 2AA color-contrast fixes on the public marketing pages (KID-1947 defects 1–3)

Branch: `kid1960-wcag-aa-contrast` · Commit: `d3e87aab00fe4869dd81070e78c5af293b9c459c` (based on `master` @ `051aaf4`)

Preview: https://kiddy-m61jeu6k5-kiddy2.vercel.app (`dpl_D2f1Z2sU617B15JibUHnHqj9rGfy`, commit `d3e87aa`) — Vercel SSO deployment protection blocks anonymous access; per the issue no bypass was created, so the local production-build evidence below is the verification record.

## Defects fixed

| # | Selector / page | Before | After | Where |
|---|---|---|---|---|
| 1 | `.site-nav a.active` pill (+ identical hover pair `.site-nav a:hover`, `.site-nav .site-nav-signin:hover`) | white 14px on raw `--brand-primary`: **3.68:1** (apex `#3b82f6`), **4.47:1** (tenant `#6366f1`) — QA measured 3.67 / 4.46 | white on `--brand-deep` fill: **10.82:1** (apex deep `#1e3c71`), **11.57:1** (tenant deep `#2c3370`) | `app/globals.css`, marketing nav selectors only |
| 2 | `.subtitle`, `.subtitle.center`, `.muted` on `/`, `/features`, `/for-parents`, `/for-centers`, `/contact` | `--color-muted` `#64748b` on canvas `#f2f5fa`: **4.35:1** at 14px/16px | `--ink-soft` `#43536e` inside `<main id="main">`: **7.11:1** on the canvas, **7.77:1** on white | `app/globals.css`; the shared `--color-muted` token itself is untouched for product surfaces (it still clears AA on `#f8fafc` = 4.55:1 and white = 4.76:1 — that is why QA only flagged marketing, where sections sit on `--canvas`) |
| 3 | contact page submit `.btn-primary` | white 15px on raw primary: **3.68:1** (apex) / **4.47:1** (tenant) | `.btn-deep` (same class as the page's other CTAs): white on deep = **10.82:1 / 11.57:1** | `app/contact/ContactForm.tsx` (one className) |

The `--brand-deep` token (35% primary mixed into ink, from KID-1653) is AA-safe **by construction for any tenant primary**: worst case (a white tenant primary) still measures 5.57:1 for white text on the fill.

## Methodology (local production build, KID-1640 pattern)

- `next build` + `next start`, isolated local SQLite DB seeded (`lib/seed.ts`), `PUBLIC_APEX_DOMAIN=local.test` so a real tenant host is resolved: apex `local.test` (token default `#3b82f6`) and tenant `sunshine.local.test` (Sunshine Daycare re-pointed to the QA sample primary `#6366f1`).
- axe-core 4.13.0, `runOnly: wcag2a + wcag2aa`, run in a real Chromium against every rendered page.
- **20 combinations scanned** (2 hosts × 2 locales (`kiddy_lang` cookie) × 5 public routes): **0 violations total — 0 color-contrast, 0 serious, 0 critical**. No new violations anywhere.
- Computed styles probed in-browser on every combination (see `results/scan-report.json`): the nav pill fills, contact button fill, and muted/subtitle foregrounds all resolve to the new AA-safe values; `dir`/`lang` resolve `ltr`/`rtl` and `en`/`ar` correctly.
- Screenshots: full-page, EN + AR, widths 360/768/1280/1440, all five public pages, apex + tenant → 80 PNGs (`kid1960-screenshots.tar.gz`, attached to the task).

## Regression checks against the accepted KID-1826 refresh

- `.brand-banner` absent on all five public routes (probed `banner:false` on all 20 combos); tenant `/login` banner path untouched — locally Sunshine has no brand image, so the banner is image-gated absent there exactly as the unchanged code dictates (`app/layout.tsx` renders `BrandBanner` only with `brandImageUrl`); production Sunshine (which has an image) keeps it.
- Inline brand lockup in the site header untouched; CLS unchanged (color-only changes — no geometry, no new boxes).
- Reduced-motion behavior unchanged (`prefers-reduced-motion` block untouched; the contact submit now shares `.btn-deep`'s 1px hover lift that is already transition-neutral under reduced motion).
- EN/AR switcher and `kiddy_lang` persistence untouched; Arabic font stack and RTL mirroring untouched (RTL probes verified live).
- Diff scope: `app/globals.css` (marketing nav selectors + `#main` muted/subtitle override) and `app/contact/ContactForm.tsx` (submit button className). No auth, portal, API, middleware, migration, or env changes. No new dependencies (axe-core 4.13.0 was already present in `node_modules`; scan ran on the local build, not the repo's test pipeline).

## Gates

- `tsc --noEmit` clean
- `next lint`: 0 errors (pre-existing `<img>` warnings only)
- `next build` green
- Unit suites: kid240-landing-links, kid368-def004-ar-i18n, kid489-branding green (24/24) — full-suite log on the task

## Production gate

Production deploy of this commit requires board approval (pending). Rollback reference unchanged: `dpl_Fu7gVPrcUqF6Y9Yrr6SwGMBxheim` @ `8582b8e`; current production stays `dpl_FcMZdoFG6wRv2fByZ1umH7Q4fwUx` @ `051aaf4` until an approved replacement ships.
