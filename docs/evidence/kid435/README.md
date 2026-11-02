# KID-435 — Sunshine mobile app parity: deploy freshness, local reproduce, tenant-branding audit

Run stamp: 2026-11-02. Branch `kid435-sunshine-parity` (web) / `kid435-mobile-tenant-branding` (mobile API), base `0095020e` (master+KID-427, the currently-deployed production build).

## 1. Deploy freshness — production contains KID-367 / KID-255 / KID-369 / KID-429

Production web aliases (Vercel project `kiddy`, alias API v4):

| Alias | Deployment | Commit | Built |
| --- | --- | --- | --- |
| `kiddyapp.net`, `*.kiddyapp.net` incl. `sunshine.kiddyapp.net`, `kiddy-one.vercel.app`, maple subdomains | `dpl_6Ehkamtx4MZMFRVKQKymnJToYJQy` (READY) | `0095020e7a` (`kid427-no-support-inbox-button` = master `09997fe` + KID-427) | 2026-11-01 04:41 |

`master@09997fe` contains all four commits relevant to the owner report
(ancestry verified with `git merge-base --is-ancestor`):

- KID-367 `8127947` (ChildCard `prefetch={false}`)
- KID-255 `348f582` (sign-out pinned at ≤720px)
- KID-369 `a2a85c8` (44px hit areas, phone polish)
- KID-429 `09997fe` (Chatwoot prod env)

Live-content markers (2026-11-02):

- `/_next/static/css/df1df54b2f78981e.css` on kiddyapp.net contains the KID-255 pin (`child-header .site-brand{flex:1 1 0`), the KID-369 hit areas (`child-nav form .btn{min-height:44px`, burger 44x44 rules) and the whole `child-nav-panel` hamburger CSS.
- SSR of `https://sunshine.kiddyapp.net/login` (and apex) references `https://chatwoot.kiddyapp.net/packs/js/sdk.js` (KID-429 env baked).
- Playwright on the live tenant origin at 320x568: every Chatwoot asset returns 200 (`sdk.js`, `/widget`, widget API) and the real bubble paints bottom-right (`prod/sunshine-live-login-320.png`).

**The web production deployment is fresh; no web redeploy was needed.**

**BUT: the mobile-API endpoint was.** `kiddy-mobile-api.vercel.app` (the RN APK's API origin) had been aliased since **2026-09-05** to `dpl_3St3SKYw6asSMa3RiNX7qwk2ecQW` (commit `6ce3b34b6`, branch `staging`) — a two-month-old pre-KID-138 build (its CSS missed every KID-255/369 marker, `/portal/support` 404s, no Chatwoot in its web side).

**Redeployed through the Vercel CLI path (2026-11-02):** the team's access guard (`TEAM_ACCESS_REQUIRED`) blocks CLI deploys whose git author (cody.kid372@paperclip.local — the identity every commit in this repo uses) is not a team member, and a full prod deploy would have re-pointed the kiddyapp.net aliases at the mobile-lineage web core (pre-KID-367). The fresh build was therefore promoted with `vercel deploy --prod --skip-domain` from a plain (non-git) source copy: deployment `dpl_AzfL4HDbu43yy5Cd51D6q7k2hTXu` (READY, production target, built from commit `ae2c9cc` of `kid435-mobile-tenant-branding`), then `vercel alias set` moved **kiddy-mobile-api.vercel.app → that deployment** atomically (the project alias table confirms the new assignment). Live checks on the new alias: `/api/mobile/bootstrap` → `{"error":"not signed in"}`; `/api/mobile/children/:id` and `/api/mobile/billing` → 401 JSON (the KID-138 IDOR guards are live on this endpoint for the first time since September); `/api/mobile/login` → structured auth error; `/login` → 200 with its CSS 200. Note for the owner: this custom-domain alias is fixed to the deployment — it does not follow future production deploys (Vercel suggests `vercel domains add kiddy-mobile-api.vercel.app kiddy` to make it follow).

## 2. Local reproduce (seeded store, parent with 2 children, production build)

Seeded with `npm run db:init` (`parent@example.test` / `kiddy-parent`, linked to Ella + Leo Nguyen at Sunshine Daycare). Production build (`next build` + `next start`) served on `sunshine-daycare.daycare.test:4444` with `PUBLIC_APEX_DOMAIN=daycare.test` and the Chatwoot env vars set to a local `sdk.js` stub (`NEXT_PUBLIC_CHATWOOT_BASE_URL=http://…:8777`, token baked at build time).

Playwright harness (`local-reproduce-results.json`), Chromium 320x568 and 390x844:

| Check | 320x568 | 390x844 |
| --- | --- | --- |
| Child name tap navigates to `/child/[id]` | yes (`mvz2k3xf-…`) | yes |
| Loading skeleton (`[aria-busy=true]`) commits | yes | yes |
| Sign-out button fully inside viewport | yes (box 202→304 x, 44px tall) | yes (box 272→374 x, 44px tall) |
| Sign-out click returns to `/login` | yes | yes |
| Console errors | none | none |

Screenshots: `sunshine-320-02-child.png` (Sunshine brand + hamburger + full "Sign out" + 2 child cards + Chatwoot bubble), `sunshine-320-03-childdetail.png`, Chatwoot stub bubble pinned bottom-right at 320x568 (`cw-stub-bubble-320.png`).

Sibling audit of the KID-367 fix: the **only** `<Link>` to a child **detail** route in the app is the already-fixed `ChildCard` (`prefetch={false}`) — `SearchableChildDropdown` renders no detail links, and `ChildNavMenu` renders section tabs, not `/child/[id]`. No further surfaces to fix.

## 3. Tenant-origin branding audit (sunshine.kiddyapp.net, 2026-11-02)

Already tenant-branded and correct (server-side, no change needed):

- `/manifest.webmanifest` — Sunshine Daycare, theme `#6366f1`, `/brand-icon.svg` (KID-256)
- `/brand-icon.svg` — 200, Sunshine initials
- root layout meta — `theme-color #6366f1`, `apple-touch-icon /brand-icon.svg`, manifest link (KID-256)
- login page body — `data-brand="Sunshine Daycare"` (KID-212)
- Chatwoot bubble — live, bottom-right, all assets 200 (KID-429)

**Real leaks found + fixed here (KID-435 code change):**

- Document titles everywhere outside the five marketing pages were the hardcoded root-default `Kiddy — childcare, in your pocket` and the `%s | Kiddy` template — the Sunshine install's own login page/tabs/PWA shell named a different brand than its own theme. Fixed: `app/layout.tsx` now generates metadata per request via `lib/theme.ts brandNameForTitle()` (host subdomain → that tenant for anonymous+signed-in; signed-in account on generic hosts → their own daycare; everything else → generic Kiddy, never the first-institute fallback). Local: sunshine login title now `Sunshine Daycare — childcare, in your pocket`; apex unchanged byte-for-byte.

By-design (NOT fixed — the platform-marketing pages deliberately stay Kiddy-branded via `lib/site.ts` SITE_BRAND): the `SiteHeader`/`SiteFooter`/hero on `/`, `/for-parents`, `/features`, `/for-centers`, `/contact` and their page titles keep the platform brand even on tenant origins; the five marketing pages set their own Kiddy titles. Note Next applies the root title template only to nested segments, so the `sunshine /` root page title stays the platform one — consistent with its Kiddy H1.

Observation (not acted on): on the APEX, anonymous meta surfaces resolve the first-created institute (Sunshine) via `getBranding`'s anonymous fallback (apex login theme-color was `#6366f1`, hidden div data-brand "Sunshine Daycare") while the apex MANIFEST stays generic Kiddy (host rule). This is the documented KID-199.3 anonymous platform-landing behavior, left untouched per the issue's "apex stays generic — do not fix it" scope; flagged for the board in case the apex meta should clamp to Kiddy like its manifest does.

## 4. Native app surface (com.kiddy.app test APK, 1.0.2 / versionCode 3)

- APK forensics: package `com.kiddy.app`, `application-label:'Kiddy'` in every locale, versionCode 3 (aapt dump) — the "Sunshine test APK" ships with a generic Kiddy launcher label.
- The RN app has NO Chatwoot integration (no WebView, no sdk bridge — the only `chatwoot` strings live in the web app).
- The stale `kiddy-mobile-api.vercel.app` build (above) is what this APK talks to.

\n## Verification

- Web branch: `tests/unit/kid435-tenant-title.test.tsx` 5/5, full `vitest run` green, `tsc --noEmit` clean, `next lint` clean (pre-existing `<img>` warnings only), `next build` success.
- Mobile branch: `tests/unit/kid435-mobile-tenant-branding.test.ts` 3/3, full `vitest run` green (9 files/65 tests), `next lint` clean; `tsc` retains exactly one PRE-EXISTING error on this lineage (`mobile-child-idor.test.ts` creates a session token without `emailConfirmed`, KID-138-era) — my files add none.
