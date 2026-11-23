# KID-2459 — production cut record (mobile Messages single pane)

Status: **complete — staging signed off, production cut finished.**

This record covers the production cut. The fix detail, the mobile audit and the
staging screenshots live in `docs/evidence/kid2459/README.md`.

## What shipped

| Area | Change |
| --- | --- |
| Portal shell | `.shell-side` / `.shell-main` get `min-width: 0` and the phone shell track is `minmax(0, 1fr)`, so a wide child can no longer stretch the page. |
| Messages | `.messages-layout` is single-pane below **1024px**: the conversation list is the entry point, and a thread / 1:1 chat / composer replaces it with a localized back link. Desktop (>=1024px) keeps the two panes. |
| Tables and rows | Data tables scroll inside their card; long list rows wrap and break long text; the finance table scrolls inside `.table-scroll`. |
| Panels and modals | Smart Lists builder, observation goals modal and upload forms stack and shrink on phones. |
| Test | `tests/unit/kid2459-mobile-responsive.test.ts` guards the breakpoints. |

Scope is CSS plus the two page components and the observation modal. No DB,
auth, API, or Cloudflare route/DNS change.

## Sign-off

The founder accepted the production confirmation card (`0e718dfc`, KID-2459)
at 2026-11-23T02:05:58Z. That accepted card is the production approval. The
KID-2452 hosting confirmation gate is independent and unchanged.

## Staging verification (source of the phone screenshots)

Staging head `f7a2496` (PRs #89, #90, #91, #96), captured on
https://kiddy-staging-orcin.vercel.app.

| Locale | View | Image |
| --- | --- | --- |
| EN | Messages list, 390px | https://raw.githubusercontent.com/ANassef6/kiddy-daycare-mvp/staging/docs/evidence/kid2459/shots/KID-2459-messages-en-360-1-list.png |
| EN | Thread with composer, 390px | https://raw.githubusercontent.com/ANassef6/kiddy-daycare-mvp/staging/docs/evidence/kid2459/shots/KID-2459-messages-en-360-2-thread.png |
| AR | Messages list, 360px (RTL) | https://raw.githubusercontent.com/ANassef6/kiddy-daycare-mvp/staging/docs/evidence/kid2459/shots/KID-2459-messages-ar-360-1-list.png |
| AR | Thread with composer, 360px (RTL) | https://raw.githubusercontent.com/ANassef6/kiddy-daycare-mvp/staging/docs/evidence/kid2459/shots/KID-2459-messages-ar-360-2-thread.png |
| EN | Desktop control, 1280px two panes | https://raw.githubusercontent.com/ANassef6/kiddy-daycare-mvp/staging/docs/evidence/kid2459/shots/KID-2459-messages-desktop-1280.png |

Staging results: 44 staff routes + 15 parent routes at 360px and 414px in EN
and AR with 0 horizontal-overflow failures; Messages flow 25/25; tablet and
landscape widths 29/29 (single pane 390-960px, two panes 1024/1280px). A
message was typed and sent in an existing thread at 780px and appeared.

## Production cut

| Item | Value |
| --- | --- |
| Pull request | #98 `kid2459-prod-cut` -> `master` |
| Merge commit | `793219e37456181c990c2096c90dcfe1393f2e76` (2026-11-23T02:06:51Z) |
| Cut method | Cherry-pick of the KID-2459 commits onto `master`; staging carries other unreviewed work, so no branch merge |
| Vercel deployment | Vercel `kiddy` production build for `793219e` — success |
| Cloudflare Worker | `kiddy-web` version `d14ac463-0752-4fd5-9db1-35f0fefe84aa` (deployed 2026-11-23T02:15Z), `https://kiddy-web.trois4ever.workers.dev` |
| Previous worker version (rollback) | `dfd69a1b-3967-4105-b13a-824b57d8a095` |

Production live traffic on `kiddyapp.net` is served by the Cloudflare Worker.
The Vercel production deployment stays warm as the rollback path.

### Worker build inputs

The worker was built with the production public values already in use:

- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`

Runtime secrets stay on the worker and were not changed: only the script
version changed.

### Gates on the cut branch

| Check | Result |
| --- | --- |
| PR #98 `Test + build + wrangler dry-run` | pass |
| PR #98 `dependency-audit` | pass |
| PR #98 Vercel previews (`kiddy`, `kiddy-staging`) | pass |
| Staging unit suites (KID-2459 + KID-182 + KID-2455 + KID-472) | 41/41 pass |
| `tsc --noEmit` | clean |
| `next lint` | 0 errors; pre-existing `<img>` warnings only |
| `next build` (OpenNext Workers build) | green |

## Post-deploy probes (live, 2026-11-23T02:16Z)

| Probe | Result |
| --- | --- |
| `GET https://kiddyapp.net/login` | `200` (`server: cloudflare`, `x-opennext: 1`) |
| Production CSS `/_next/static/css/6a264a1946aef7f0.css` | `200`, contains `.messages-layout` and `@media (max-width:1023.98px){.messages-layout{grid-template-columns:minmax(0,1fr)!important}...}` |
| `GET https://kiddyapp.net/portal/messages` | `307` -> `/login` |
| `GET https://kiddyapp.net/child/messages` | `307` -> `/login` |
| `GET https://kiddyapp.net/api/attendance/sweep` (no secret) | `401` |
| `GET https://kiddyapp.net/api/locale` (no session) | `401` `application/json` |
| `GET https://kiddyapp.net/switch-app-lang` | `405` (POST-only route exists) |
| `GET https://kiddyapp.net/?lang=ar` | `dir="rtl"` |
| `GET https://sunshine.kiddyapp.net/login` | `200` |
| `GET https://maple-grove.kiddyapp.net/login` | `200` |
| Spot-check `/`, `/features`, `/for-parents`, `/privacy` | all `200` |

The founder phone screenshot in the original report is the pre-fix production
CSS, which had no `.messages-layout` rule. The rule is now in the CSS that
`kiddyapp.net` serves. The signed-in phone walk-through is covered by the
staging sign-off and the screenshot matrix above; production has no agent test
login, so it is not repeated here.

## Rollback

- Worker: `npx wrangler rollback --name kiddy-web` to version
  `dfd69a1b-3967-4105-b13a-824b57d8a095` (or pick it in the dashboard).
- Vercel: the `production` deployment stays warm and can be restored by
  re-pointing the zone routes; no DNS record changed.
- No migration was added by this change, so there is no schema rollback.
