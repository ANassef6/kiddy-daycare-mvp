# KID-2072 — EN/AR switcher no-op on the public site: fix evidence (preview)

Branch: `master` · Commit: `9fc20e2` (based on `master` @ `ac81542`)

**Preview:** https://kiddy-5klmfnssz-kiddy2.vercel.app — Vercel SSO deployment
protection blocks anonymous access; a temporary **Protection Bypass for
Automation** secret was created for this review (note "KID-2072 preview review -
temporary", created 2026-11-12):

- Pass it as a header: `x-vercel-protection-bypass: LkwwlEXZxMUw7Tp03pc4tQBGN4pBzJlC`
  (recommended), or as `?x-vercel-protection-bypass=…` for tools that cannot set
  headers.
- Verified: `200` with the header / `302` Vercel SSO redirect without it.
- **Limitation on the preview only:** the no-JS form round trip starts at
  `/switch-lang` (no bypass query survives the form submit), so a real-browser
  click-through of the switch lands on the SSO wall on protected previews. The
  switch itself is verified below via the local production build and the
  preview's raw HTTP responses; the real-browser click-through belongs to the
  post-cut QA on production.
- **Revoked 2026-11-12 13:41Z after board review** (approval `bd00bae1`,
  approved 13:35Z): the same `PATCH
  /v1/projects/prj_LmRn4uWkd9XY4ykXey9SCXG2442M/protection-bypass` with
  `{"revoke":{"secret":"…","regenerate":false}}` returned the empty bypass list,
  and the KID-2077 secret was revoked in the same pass.

## Root cause (KID-215: "when I click on Arabic on the landing page, it do nothing")

1. **Client-JS-only switch.** `SiteLangToggle` wrote the `kiddy_lang` device
   cookie via `document.cookie` and called `window.location.reload()`. With
   JavaScript disabled/blocked, or in a tab whose old HTML/JS predated
   hydration, the click was a silent no-op.
2. **First-duplicate cookie shadowing.** The server read the FIRST
   `kiddy_lang` value from the Cookie header, so a stale same-name duplicate
   (host-only + `Domain=.kiddyapp.net`, or different paths) shadowed the
   newest explicit choice.

## The fix (matches the plan's acceptance criteria)

1. **Server-handled switch, works without JS.** The switcher is now a plain
   server component rendering a GET form to the new `GET /switch-lang` route
   handler (`app/switch-lang/route.ts`), which sets the cookies server-side and
   answers **303 See Other** back to the exact current path + query.
2. **Dedicated site cookie, last-explicit-choice wins.** `kiddy_site_lang`
   (lib/site-lang.ts) is read **last-duplicate-wins** from the raw Cookie
   header (`lastCookieValue`), so no `kiddy_lang` duplicate can shadow the
   site choice. `kiddy_lang` keeps working for the app unchanged.
3. **Same-origin `next` only.** `safeNextPath` accepts absolute paths,
   preserves path + query, and refuses external / protocol-relative / scheme /
   backslash-normalized / control-character / double-encoded targets (falls
   back to `/`).
4. **Apex + tenants, desktop + mobile.** The switcher markup keeps the exact
   `.site-lang-toggle` / `.site-lang-btn` classes and button attributes
   (`aria-pressed`, per-button `lang`/`dir`, `role="group"` + `aria-label`) —
   CSS untouched, so the shipped KID-1653/KID-1960 responsive + contrast
   behavior carries over. Host-independence is structural: the middleware
   matcher and `resolveSiteLocale` never branch on host.
5. **Cookie-less fallback.** Middleware promotes a valid `?lang=ar` to the
   `x-kiddy-lang-override` request header → Arabic renders for that request
   even when cookies are unavailable (persistence best-effort). It also
   carries the current path (with `?lang` stripped) as
   `x-kiddy-public-path` so the switcher's hidden `next` returns the visitor
   exactly where they were.
6. **Tests.** 24 pins in `tests/unit/kid2072-site-language-switch.test.tsx`:
   JS-disabled switch form, duplicate-cookie precedence, `?lang` override
   precedence, open-redirect guard matrix, middleware plumbing (real
   `NextRequest`), 303 + cookie behavior on the route handler. Existing i18n
   suites stay green: `i18n.test.ts`, `language.test.ts`, `kid214`,
   `kid368`, `kid443`, `kid240` all pass; full suite 109/109 files (6 files
   flaked with 10s hook timeouts under machine load — all pass on a quiet
   re-run).
7. **App surfaces unchanged.** `/login` and the app keep
   `resolveRequestLocale` (account.language canonical, OBS-001);
   `kiddy_site_lang` never decides app/portal/auth pages.

## Verification record

### Local production build (`next build` + `next start` @ 9fc20e2)

- `GET /switch-lang?lang=ar&next=%2Fcontact%3Futm%3D1` → `303`,
  `location: /contact?utm=1`,
  `set-cookie: kiddy_site_lang=ar` + `set-cookie: kiddy_lang=ar` (both
  `Path=/; Max-Age=31536000; SameSite=lax`).
- `GET /` with `Cookie: kiddy_site_lang=ar` → `<html lang="ar" dir="rtl">`,
  Arabic H1.
- `GET /?lang=ar` **without any cookie** → `<html lang="ar" dir="rtl">`.
- Duplicate precedence: `kiddy_lang=en; kiddy_site_lang=ar; kiddy_site_lang=en`
  → English (last site value wins); `kiddy_site_lang=ar; kiddy_lang=en` →
  Arabic (the app cookie can no longer shadow the site choice).
- `next=//evil.com`, `next=https://evil.com` → `303`, `location: /` (open
  redirect refused).
- `/login` with `kiddy_site_lang=ar` → English; with `kiddy_lang=ar` →
  Arabic. App semantics intact.
- Switcher markup: `<form class="site-lang-toggle" role="group"
  aria-label="Site language" action="/switch-lang" method="get">` with two
  `type=submit` buttons `name="lang" value="en|ar"`, `aria-pressed`,
  `lang`, `dir` intact.
- `tsc` clean; `next lint` 0 errors (pre-existing img warnings);
  `next build` green, `/switch-lang` registered.

### Preview deployment (`dpl` for commit 9fc20e2, via protection bypass)

Identical results on https://kiddy-5klmfnssz-kiddy2.vercel.app:

| Check | Result |
|---|---|
| `GET /` | form `action="/switch-lang" method="get"`, `aria-pressed`/`lang`/`dir` intact |
| `GET /switch-lang?lang=ar&next=/contact?utm=1` | `303` → `/contact?utm=1`, both cookies set |
| `kiddy_site_lang=ar` | `<html lang="ar" dir="rtl">`, Arabic H1 |
| `?lang=ar` (no cookies) | `<html lang="ar" dir="rtl">` |
| `kiddy_lang=en; kiddy_site_lang=ar; kiddy_site_lang=en` | `<html lang="en" dir="ltr">` (last site value wins) |
| `kiddy_site_lang=ar; kiddy_lang=en` | `<html lang="ar" dir="rtl">` |
| `next=//evil.com`, `next=https://evil.com` | `303` → `/` |
| `/login` + `kiddy_site_lang=ar` | `<html lang="en" dir="ltr">` (app ignores the site cookie) |
| `/login` + `kiddy_lang=ar` | `<html lang="ar" dir="rtl">` |
| `next=/features?x=1` | `303` → `/features?x=1` (path + query preserved) |

## No production change yet

Production cut only after board approval of this preview. Rollback reference:
current production `dpl_D4MEdrFVX2ZoDzZMxfDVhvPHtQkC` @ `c5e73c8`.

**Deploy mechanics:** production deploys are driven by GitHub pushes to
`master`. Commit `9fc20e2` is committed locally only — the branch is ahead of
`origin/master` by 1 and MUST NOT be pushed until the board approves. The
approved production cut is then `git push origin master` (plus the bypass
revocation above).

## Production cut (2026-11-12) — DONE

Board approval `bd00bae1` approved at 13:35:59Z (decided by a board user).
`git push origin master` landed `2f2eb32` (the remote had already accepted
`ac81542` — KID-2077's motion work shipped under its own accepted confirmation
`76af4db7`, production `dpl_3iQycMmc4jCPbfyMgWZgVXF13Q4w`). Vercel built
production `dpl_GNmMWRKC8vEuisRBPJN9zqhVpPU6` for `2f2eb32` — READY at
13:40:52Z. Rollback target stays `dpl_D4MEdrFVX2ZoDzZMxfDVhvPHtQkC` @ `c5e73c8`.

Post-cut QA on https://kiddyapp.net (curl HTTP probes) — all green:

| Check | Result |
|---|---|
| `GET /` | form `action="/switch-lang" method="get"`, `aria-pressed` present, `<html lang="en" dir="ltr">` |
| `GET /switch-lang?lang=ar&next=/contact%3Futm%3D1` | `303` → `/contact?utm=1`, `Set-Cookie` for `kiddy_site_lang=ar` + `kiddy_lang=ar` (1y, SameSite=lax) |
| `kiddy_site_lang=ar` | `<html lang="ar" dir="rtl">`, Arabic H1 (تطبيق واحد ليوم الحضانة بأكمله.) |
| `kiddy_lang=en; kiddy_site_lang=ar; kiddy_site_lang=en` | `<html lang="en" dir="ltr">` (last site duplicate wins) |
| `?lang=ar` (no cookies) | `<html lang="ar" dir="rtl">` |
| `next=//evil.com`, `next=https://evil.com` | `303` → `/` |
| `/login` + `kiddy_site_lang=ar` | `<html lang="en" dir="ltr">` (app ignores the site cookie) |
| `/login` + `kiddy_lang=ar` | `<html lang="ar" dir="rtl">` |

Tenant subdomain https://sunshine.kiddyapp.net — form action, `303` →
`/features?x=1`, `kiddy_site_lang=ar` renders `<html lang="ar" dir="rtl">`,
open-redirect guard returns `/`. All green.

Real-browser click-through (Skyvern, Chromium, production): click العربية →
full reload with Arabic state, click English → back to English; the run's own
report: "The actions show successful clicks on both Arabic and English language
buttons, with the page reloading and switching languages appropriately… The
user goal has been completely achieved." (Run `tsk_596174646704296656` ended
"failed" only because it hit the step cap on the completion call — reporting
artifact, not an action failure.)

Both temporary Vercel automation-bypass secrets (KID-2072 + KID-2077) were
revoked at 13:41Z before these probes; production QA required no bypass.
