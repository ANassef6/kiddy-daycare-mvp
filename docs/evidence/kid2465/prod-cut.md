# KID-2465 — production cut record (Chatwoot widget restored)

Status: **complete — production cut finished and verified.**

This record covers the production cut. The root cause, fix detail and staging
screenshots live in `docs/evidence/kid2465/README.md`.

## What shipped

The production Worker bundle is now built with both Chatwoot public values in
the build environment, so `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` is inlined into
the root layout chunk and the browser can mount the widget. The half-set
production build guard from PR #104 ships with it.

| Item | Value |
| --- | --- |
| Pull request | #104 `kid2465-chatwoot-token` -> `master` |
| Merge commit | `97da72ea474ccf448ea2382ebf8da38b5221e1bc` (2026-11-23T23:07:38Z) |
| Cloudflare Worker | `kiddy-web` version `b02ff0f0-83e1-4f75-814a-e73be305066a` (deployed 2026-11-23T23:10Z) |
| Deployment message | `KID-2465-chatwoot-token-master-97da72e` |
| Previous worker version (rollback) | `c143eb0b-4a07-4856-a043-78a9103733ef` (deployment `a668366c-b694-48cb-9290-66c3e178cab1`) |
| Routes / DNS | unchanged |
| Migrations | none |

The build and the staging Worker (`da0c8cfc`, KID-2465 staging verification)
produce the same root layout chunk `layout-2e4a3803f714e702.js`, which is what
`kiddyapp.net` now serves.

### Worker build inputs

The production public values already in use, plus the website token:

- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` — the website-inbox token, read from the
  existing Vercel production value / staging bundle; never written to the repo
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`
- `SESSION_SECRET` — build-only check; the Worker keeps its runtime secret
- `KIDDY_CSP_MODE=report-only` (same mode the Worker served before this cut)

`SUPABASE_*`, `CRON_SECRET`, VAPID and Chatwoot server secrets stay on the
Worker and were not changed; only the script version changed.

Post-build inline check:

```sh
grep -rl "$NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN" \
  .open-next/assets/_next/static/chunks/app
# layout-2e4a3803f714e702.js
grep -rl "NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN" .open-next/assets/_next/static/chunks
# (no output: no runtime lookup is left in the browser bundle)
```

## Live verification (production, 2026-11-23T23:12Z)

Captured with Chromium headless against `https://kiddyapp.net`; the launcher is
the Chatwoot SDK bubble rendered bottom-right.

| Check | Result |
| --- | --- |
| Launcher visible on `/` EN desktop 1366×900 | yes, `woot-widget-bubble` 64×64 visible (`prod/kid2465-prod-en-desktop.png`) |
| Launcher visible on `/?lang=ar` desktop | yes, 64×64, page `lang=ar dir=rtl` (`prod/kid2465-prod-ar-desktop.png`) |
| Launcher visible on `/` EN mobile 390×844 | yes, 64×64 (`prod/kid2465-prod-en-mobile.png`) |
| Launcher visible on `/?lang=ar` mobile | yes, 64×64 (`prod/kid2465-prod-ar-mobile.png`) |
| Launcher visible on `/login` desktop | yes, 64×64 |
| SDK ran | `window.__kiddyChatwootRan === true`, `$chatwoot` present, `sdk.js` 200 |
| Widget iframe mounts | `#chatwoot_live_chat_widget`, `src=https://chatwoot.kiddyapp.net/widget?website_token=…` |
| Bubble-hide flag on non-messages pages | `__kiddyChatwootBubbleHidden === false` |
| Page errors / failed requests | none |
| Console | only a report-only CSP notice for the zone-injected Cloudflare Insights beacon (see below) |
| `/api/chatwoot/identity` (anonymous) | `200 {"identity":null}` — endpoint healthy; signed-in `setUser` was verified on staging with the same build |

### Hidden messaging routes

`/portal/messages` and `/child/messages` return `307 -> /login` for an
anonymous browser, so the launcher is not rendered there. Production has no
agent test login; the signed-in KID-475 hide path (`__kiddyChatwootBubbleHidden
= true`, bubble 0×0) was verified on staging against the identical layout chunk
and is unchanged by this cut.

## Post-deploy probes

| Probe | Result |
| --- | --- |
| `GET https://kiddyapp.net/`, `/features`, `/for-parents`, `/privacy` | `200` |
| `GET https://kiddyapp.net/login` | `200`, `x-opennext: 1`, `server: cloudflare` |
| `GET https://kiddyapp.net/?lang=ar` | `<html lang="ar" dir="rtl">` |
| `GET https://kiddyapp.net/portal/messages`, `/child/messages` | `307 -> /login` |
| `GET https://kiddyapp.net/api/attendance/sweep` (no secret) | `401` |
| `GET https://kiddyapp.net/api/locale` (no session) | `401` |
| `GET https://sunshine.kiddyapp.net/login`, `https://maple-grove.kiddyapp.net/login` | `200` |
| CSP header on `/login` | report-only, `script-src`/`connect-src`/`frame-src` include `https://chatwoot.kiddyapp.net` |
| Cron trigger | `*/5 * * * *` still attached to `kiddy-web` |

The report-only CSP notice in the console is the zone's Cloudflare Insights
`beacon.min.js`, which the existing policy does not allow. It is report-only,
unrelated to the Chatwoot widget, and unchanged by this cut.

## Rollback

- Worker: `npx wrangler rollback --name kiddy-web` to version
  `c143eb0b-4a07-4856-a043-78a9103733ef` (deployment
  `a668366c-b694-48cb-9290-66c3e178cab1`).
- No route or DNS change was made, so the Vercel origin stays available.
- No migration was added, so there is no schema rollback.
