# KID-2460 — production cut record (Arabic RTL portal sidebar/tabs)

Status: **complete — staging signed off, production cut finished.**

This record covers the production cut. The root-cause analysis, fix detail and
the staging screenshot matrix live on the `staging` branch at
`docs/evidence/kid2460-rtl-tabs/README.md`; the images below are served from
that branch.

## What shipped

| Area | Change |
| --- | --- |
| Language switch | `LanguageSettingsCard` posts natively to `POST /switch-app-lang`. The route validates the same-origin request, saves `account.language`, sets `kiddy_lang` and answers `303`, so the whole document (root `<html dir>`, portal shell, sidebar) re-resolves. The old `saveLanguageAction` server-action redirect is removed. |
| Cross-device locale | `components/LocaleGuard.tsx` on the portal/parent shells asks `GET /api/locale` on mount, focus, visibility and bfcache restore, and reloads once if the document language is stale. |
| RTL chevrons | `html[dir="rtl"] .portal-nav-toggle svg { transform: scaleX(-1) }` mirrors the collapsed group chevron. |
| Tests | `tests/unit/kid2460-rtl-tabs.test.tsx` — 14 cases. |

Scope is nav/tabs/RTL only; no unrelated fixes are bundled.

## Sign-off

The founder accepted the production confirmation card (`93bbe1a8`, KID-2460)
at 2026-11-23T01:06:28Z. That accepted card is the production approval; the
KID-2452 confirmation gate is independent and unchanged.

## Staging verification (source of the RTL screenshots)

Staging head `e3b6b24` (code `8c33789`, evidence `8d404c1`/`3bf841a`), captured
on https://kiddy-staging-orcin.vercel.app after an actual English → Arabic
switch in Account Settings.

| Locale | Surface | Image |
| --- | --- | --- |
| EN / LTR | Staff portal dashboard | https://raw.githubusercontent.com/ANassef6/kiddy-daycare-mvp/staging/docs/evidence/kid2460-rtl-tabs/en-portal-dashboard.png |
| AR / RTL | Staff portal dashboard after EN → AR switch | https://raw.githubusercontent.com/ANassef6/kiddy-daycare-mvp/staging/docs/evidence/kid2460-rtl-tabs/ar-portal-dashboard.png |
| EN / LTR | Parent portal header nav | https://raw.githubusercontent.com/ANassef6/kiddy-daycare-mvp/staging/docs/evidence/kid2460-rtl-tabs/en-parent-nav.png |
| AR / RTL | Parent portal header nav (settings) | https://raw.githubusercontent.com/ANassef6/kiddy-daycare-mvp/staging/docs/evidence/kid2460-rtl-tabs/ar-parent-settings-nav.png |
| AR / RTL | Staff portal child-profile tabs | https://raw.githubusercontent.com/ANassef6/kiddy-daycare-mvp/staging/docs/evidence/kid2460-rtl-tabs/ar-child-profile-tabs.png |

Verified on staging: full document reloads in Arabic with the sidebar on the
right and every group and nested label in Arabic; collapsed chevrons point
left; child-profile tabs render Arabic in RTL order; EN/LTR is unchanged.

## Production cut

| Item | Value |
| --- | --- |
| Pull request | #95 `kid2460-prod-cut` → `master` |
| Merge commit | `91080a5c2a8feedde5cdbb5a4c61c7de766a9e9b` (2026-11-23T01:22Z) |
| Cut method | Cherry-pick of `8c33789` onto `master` `e9e0244` → `07e94d4` (staging carries other unreviewed work, so no branch merge) |
| Vercel deployment | `dpl_4jZzdSXWrXcUhtnsqEyGqwkdCRRC` — READY, `production`, commit `91080a5`; alias `kiddyapp.net` and tenant hosts |
| Cloudflare Worker | `kiddy-web` version `dfd69a1b-3967-4105-b13a-824b57d8a095` (deployed 2026-11-23T01:31Z), `https://kiddy-web.trois4ever.workers.dev` |
| Previous worker version (rollback) | `7ab1072a-70d1-4898-8079-d92c366629aa` |

Production live traffic on `kiddyapp.net` is served by the Cloudflare Worker.
The Vercel production deployment is the warm rollback path, and it also carries
the new routes.

### Worker build inputs

The worker was built with the production public values already in use
(`NEXT_PUBLIC_SUPABASE_URL` = production Supabase project,
`NEXT_PUBLIC_CHATWOOT_BASE_URL`, `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`,
`PUBLIC_APEX_DOMAIN=kiddyapp.net`). Runtime secrets stay on the worker and were
not changed: only the script version changed.

### Gates on the cut branch

| Check | Result |
| --- | --- |
| `tests/unit/kid2460-rtl-tabs.test.tsx` | 14/14 pass |
| Related suites (`kid221`, `kid453`, `kid255`, `i18n`, `i18n-page-coverage`, `kid199-account-menu`, `kid2406`) | 68/68 pass |
| `tsc --noEmit` | clean |
| `next lint` | 0 errors; pre-existing `<img>` warnings only |
| `next build` | green, emits `/switch-app-lang` and `/api/locale` |
| PR #95 checks | `audit` pass, `Test + build + wrangler dry-run` pass, Vercel previews pass |

## Post-deploy probes (live, 2026-11-23T01:33Z)

| Probe | Result |
| --- | --- |
| `GET https://kiddyapp.net/login` | `200` (`server: cloudflare`, `x-opennext: 1`) |
| `GET https://kiddyapp.net/portal/messages` | `307` → `/login` |
| `GET https://kiddyapp.net/child/messages` | `307` → `/login` |
| `GET https://kiddyapp.net/api/attendance/sweep` (no secret) | `401` |
| `GET https://kiddyapp.net/api/locale` (no session) | `401` `application/json` (route exists, fail-closed) |
| `GET https://kiddyapp.net/switch-app-lang` | `405` (POST-only route exists) |
| `POST https://kiddyapp.net/switch-app-lang` `lang=ar` (no session) | `303` → `/login` (no 500) |
| `GET https://kiddyapp.net/?lang=ar` | `dir="rtl"` |
| `GET https://sunshine.kiddyapp.net/login` | `200` |
| `GET https://maple-grove.kiddyapp.net/login` | `200` |
| Spot-check `/`, `/features`, `/for-parents`, `/privacy` | all `200` |

Authenticated AR/LTR behaviour is proven by the founder staging sign-off and
the staging screenshot matrix above; production has no agent test login, so the
signed-in walk-through is not repeated here.

## Rollback

- Worker: `npx wrangler rollback --name kiddy-web` to version
  `7ab1072a-70d1-4898-8079-d92c366629aa` (or pick it in the dashboard).
- Vercel: the `production` deployment stays warm and can be restored by
  re-pointing the zone routes; no DNS record changed.
- No migration was added by this change, so there is no schema rollback.
