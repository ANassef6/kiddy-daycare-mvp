# KID-2406 — public navigation latency: edge cache, no DB on render, Frankfurt region

Branch: `kid2406-nav-perf` (based on `origin/master` @ `c9d32ee`)
Commits: `79acd42`, `5e04d81`, `4d46c5a`, `7c6907b`
Preview: https://kiddy-nl8y6lsm0-kiddy2.vercel.app — deployment `dpl_DGLKW4YCoXHY4cXWLnC7bHZLgKJ1`
Inspector: https://vercel.com/kiddy2/kiddy/DGLKW4YCoXHY4cXWLnC7bHZLgKJ1
Production: `master` fast-forward `c9d32ee..7c6907b` (board approval `e21822a7`,
2026-11-14), deployed to `kiddyapp.net` — deployment
`H84obz24gVQMUeUmkmVy5goD4iiy`. Post-cut numbers are in
[Production cut](#production-cut-2026-11-14) below.

The preview carries Vercel Authentication. Verification used the existing
automation bypass created for KID-2072's review
(`x-vercel-protection-bypass: hMkfx9tfy…`, project `prj_LmRn4uWkd9XY4ykXey9SCXG2442M`).
**Do not revoke it from this run** — it belongs to KID-2072's gate. Production
(`kiddyapp.net`) has no deployment protection.

## What changed

1. **No DB work and no bootstrap on the public render path.**
   - Removed `export const dynamic = "force-dynamic"` and `ensureSeeded()` from
     `app/layout.tsx`.
   - `ensureSeededSafe()` now runs from the four authenticated layouts
     (`login`, `portal`, `child`, `platform`), where it is still a once-per-process
     no-op after the first call.
   - Public pages use `getHostBranding()` (host header only; 30 s subdomain cache,
     zero DB for the apex) instead of session branding. Cached HTML can therefore
     never carry a signed-in account's daycare brand. A signed-in visitor on the
     apex sees generic Kiddy chrome on marketing pages by design.
2. **Edge caching with a URL-based locale key.**
   - The CDN cache key is the URL, so Arabic lives at `?lang=ar` and English on
     the clean path. A stored Arabic cookie normalises the clean URL with a 307.
   - An explicit `?lang` always wins (`?lang=en` still renders English for an
     Arabic-cookie visitor).
   - No `Set-Cookie` on marketing HTML (it makes Next force `private, no-store`);
     the switcher persists the choice through `/switch-lang`.
   - `CDN-Cache-Control` + `Vercel-CDN-Cache-Control` carry
     `public, s-maxage=300, stale-while-revalidate=86400`. This matters because
     Next overwrites `Cache-Control` with its dynamic default on these routes;
     Vercel documents CDN-specific headers as taking precedence, and Cloudflare
     (which fronts `kiddyapp.net`) honours `CDN-Cache-Control`.
3. **Links stay on the cacheable URL.** `withLang()` is applied to the internal
   marketing links in header, footer and the five pages, and `/switch-lang`
   redirects straight to `?lang=ar`.
4. **Chatwoot is off the critical path.** `next/script` uses `lazyOnload` and the
   identity fetch / bubble scheduling only run after the SDK loads.
5. **Region.** `vercel.json` pins functions to `fra1` (Frankfurt).
   `browserslist` now targets Chrome/Edge/Firefox ≥ 111 and Safari ≥ 16.4.

## Deployed measurements (preview, 2026-11-14)

Same requests, same runner (routed via the Paris edge POP). Warm function.

| | Production `kiddyapp.net` (master `c9d32ee`) | Preview `4d46c5a` |
|---|---|---|
| Function region (`x-vercel-id`) | `cdg1::iad1` (US East) | `fra1::fra1` (Frankfurt) |
| Cache | `private, no-cache, no-store`, `x-vercel-cache: MISS` | `x-vercel-cache: HIT` (after first request), `age` 1–5 s |
| TTFB warm (5–6 samples) | 0.37–0.43 s (first request 3.30 s cold start) | 0.21–0.24 s (cold render 0.24–0.28 s) |
| Arabic | cookie-driven, uncached | `/?lang=ar` → 200, `<html lang="ar" dir="rtl">`, `x-vercel-cache: HIT` |

Header proof (second request to the same preview URL):

```
cache-control: private, no-cache, no-store, max-age=0, must-revalidate
cdn-cache-control: public, s-maxage=300, stale-while-revalidate=86400
x-vercel-cache: HIT
age: 2
x-vercel-id: fra1::fra1::…
```

The private browser `Cache-Control` is Next's dynamic default and is left as-is:
browsers revalidate, the edge does the caching.

## Local production build (`next start`)

All five marketing routes, both variants:

| URL | `<html lang dir>` | `cdn-cache-control` |
|---|---|---|
| `/` | `en` / `ltr` | public, s-maxage=300, SWR 86400 |
| `/?lang=ar` | `ar` / `rtl` | public, s-maxage=300, SWR 86400 |
| `/features`, `/for-parents`, `/for-centers`, `/contact` | `en` / `ltr` | public, s-maxage=300, SWR 86400 |
| same paths `?lang=ar` | `ar` / `rtl` | public, s-maxage=300, SWR 86400 |

Other verified behaviour:

- `GET /features?utm=1` + `kiddy_site_lang=ar` → `307 /features?utm=1&lang=ar`.
- `GET /features?lang=en` + `kiddy_site_lang=ar` → `200`, English (explicit wins).
- `GET /switch-lang?lang=ar&next=/contact?a=1` → `303 /contact?a=1&lang=ar`
  + `Set-Cookie: kiddy_site_lang=ar` and `kiddy_lang=ar`.
- **Zero DB queries** on `/`, `/?lang=ar` and `/features` with
  `KIDDY_PERF_LOG=1` (0 `[sql]` lines).
- Arabic copy is real, e.g. `/for-centers?lang=ar` title
  `للحضانات — أديروا اليوم من مكان واحد | Kiddy`.

## Production cut (2026-11-14)

Board approval `e21822a7-4810-41c6-ae6b-006d876b1563` was approved and the cut
was `git push origin kid2406-nav-perf:master` — a clean fast-forward
`c9d32ee..7c6907b` (no merge commit). The Vercel GitHub status for
`Vercel – kiddy` reported `success` on `7c6907b`, and production
`https://kiddyapp.net/` started serving the new deployment.

Same runner as the preview table, requests through Cloudflare to the Paris edge
POP. `x-vercel-id` now ends `::fra1` (previously `cdg1::iad1`).

| | Production before (master `c9d32ee`) | Production after (`7c6907b`) |
|---|---|---|
| Function region | `cdg1::iad1` (US East) | `cdg1::fra1` (Frankfurt) |
| HTML cache | `x-vercel-cache: MISS` every time, `cf-cache-status: DYNAMIC` | `MISS -> HIT`, `age` 1–37 s (then `STALE`/SWR after 300 s) |
| `cdn-cache-control` | absent | `public, s-maxage=300, stale-while-revalidate=86400` |
| Warm TTFB `/` (10 samples) | 0.37–0.43 s | **min 0.241 s, median 0.254 s, max 0.293 s** |
| First request `/` | 3.30 s (cold start) | 0.45 s (cache MISS) |

All five marketing routes cache: `/features`, `/for-centers`, `/for-parents`,
`/contact` each returned `x-vercel-cache: MISS` on the first request and `HIT`
(warm TTFB 0.24–0.29 s) on the second. `/?lang=ar` returns `200`,
`<html lang="ar" dir="rtl">`, `cdn-cache-control` present, `MISS -> HIT`.

Behaviour re-checked against production, identical to local/preview:

- `GET /features?utm=1` + `kiddy_site_lang=ar` → `307 /features?utm=1&lang=ar`.
- `GET /?lang=en` + `kiddy_site_lang=ar` → `200`, `<html lang="en" dir="ltr">`.
- `GET /switch-lang?lang=ar` → `303 /?lang=ar` + both `Set-Cookie` values.
- `/` with no cookie → `<html lang="en" dir="ltr">`.
- The `polyfills-*.js` script tag is still emitted with `noModule`; production
  modern-chunk download total is 369,547 B across 7 scripts (the same tree as
  the preview table, measured through the live CDN).

**TTFB target note.** The `< 200 ms` acceptance target was not reached from this
runner: an empty 404 on a Vercel alias measures 0.243 s and a Cloudflare-cached
static CSS asset measures 0.21–0.27 s, so ~0.21 s is this vantage's network floor.
The warm HTML TTFB (0.24–0.25 s median) is therefore essentially at the floor; the
edge-cache + Frankfurt move removed the origin render/DB cost, not the
runner→edge RTT. A vantage closer to the edge (or Egypt/mobile field data
post-launch) is the better way to confirm the user-visible improvement.

**Cloudflare.** `cf-cache-status: DYNAMIC` on HTML in production: the Cloudflare
zone still does not cache the marketing HTML, so only Vercel's edge cache is in
play (`x-vercel-cache: HIT`). This matches the risk recorded on the approval. A
Cloudflare Cache Rule for the five paths (Cache Eligible, respect
`CDN-Cache-Control`) is the optional next step; it was not changed here.

## JavaScript

Landing page, production build, scripts parsed from the served HTML:

| | Raw | gzip | Notes |
|---|---|---|---|
| Modern scripts (7) | **369,040 B** | **110,446 B** | React DOM 173,019 B + router 174,094 B + app 22 KB |
| `polyfills-*.js` | 112,594 B | — | emitted with `noModule`; modern browsers never fetch it |

Baseline was 481,883 B raw including the same `noModule` polyfill file; Next
"First Load JS" stays at 103 kB because the floor is the framework chunks.

**Acceptance caveat:** the literal "no legacy polyfill chunk / < 30 KB" and
"< 350 KB raw" targets are not met. Next 15.5.29 unconditionally copies the
`polyfill-nomodule` chunk (`next/dist/build/webpack-config.js:1713`); browserslist
cannot remove it. The chunk is `noModule` (not downloaded by any browser that can
run the app) and PSI/Lighthouse transfer-based audits do not request it. Modern
transfer is ~108 KB gzip. Getting under 350 KB raw would require changing the
framework itself, not app code. Recommend the board accepts the transfer-size
reality or treats the threshold as gzip-based.

## Supabase region

`db.sfetmfmtoubtdyyeyudd.supabase.co` resolves to `2a05:d014:913:8602:…` — AWS
`eu-central-1` (Frankfurt) address space. The production pooler hostname comes
from Vercel env (`KIDDY_DATABASE_URL`); local dev is SQLite. `fra1` therefore
moves the function next to the database instead of querying Frankfurt from
`iad1`. The direct `db.` endpoint is strong evidence of the project region, not
the exact pooler region.

## Gates

- `npm run build`: green (three times, including the final `4d46c5a` tree).
- `npm run lint`: 0 errors (pre-existing `<img>` warnings only).
- Tests (affected areas; 17 files, 153 tests, all green):
  - 8-file batch: `kid1178-branding-csp-report`, `kid1178-security-headers-csp`,
    `kid238-contact-inbox`, `kid239-login-no-demo-credentials`,
    `kid240-landing-links`, `kid368-def004-ar-i18n`, `kid437-auth-brand-header`,
    `kid452-privacy-policy-route` — 57 passed.
  - 4-file batch: `kid2406-nav-perf`, `kid2072-site-language-switch`,
    `kid306-chatwoot-widget`, `kid435-tenant-title` — 52 passed.
  - Branding/bootstrap set (5 files) — 44 passed.
- Full `vitest run` was attempted twice but the shared machine was running two
  other suites (load average 9.4); it produced no progress for 25 minutes and
  was stopped. No failures were observed.

## Not done / follow-ups

- PSI was still unavailable after the cut (`429` daily quota for the shared
  keyless project) and Lighthouse could not launch (Playwright Chromium is missing
  `libglib-2.0`), so the evidence above is raw TTFB + header/cache state. Run PSI
  from the board side (or with a keyed project) when the quota resets.
- Auth pages (`/login`, `/register`, password pages) remain dynamic: they read
  the session and their language toggle is cookie-based. They still benefit from
  the region move and the no-bootstrap/no-DB changes, but are not edge-cached.
- Cloudflare does not cache the marketing HTML (`cf-cache-status: DYNAMIC`). To
  add a second cache layer, create a Cloudflare Cache Rule for the five paths that
  respects `CDN-Cache-Control`. Vercel's edge cache is already serving `HIT`.
- Revoke the KID-2077/KID-2072 automation bypass at KID-2072's gate (not here).

## Rollback

Redeploy the pre-cut production deployment `c9d32ee` (the approval note records its
production deployment id `7764919093`). No schema or data change is involved.
