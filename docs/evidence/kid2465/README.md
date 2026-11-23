# KID-2465 — restore the Chatwoot support widget on the Cloudflare Worker

Status: **staging verified; production cut waiting on founder approval.**

## Root cause (confirmed)

`NEXT_PUBLIC_*` values are inlined by `next build`. The Worker build that was
deployed on 2026-11-23 21:23Z had the Chatwoot base URL in the environment but
not the website token, so the client bundle contained
`l.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` (an empty browser lookup) while
`https://chatwoot.kiddyapp.net` was a literal. `components/ChatwootWidget.tsx`
renders nothing without a token, so every page lost the launcher.

The token is present on the Vercel `kiddy` production project and matches the
literal in the old Vercel production layout chunk; the Chatwoot server is
healthy (`/packs/js/sdk.js` → 200). Setting the value with `wrangler secret put`
alone cannot fix it: Worker runtime secrets are not visible to the browser.

## Fix

| Change | File |
| --- | --- |
| Build fails (production) when exactly one Chatwoot `NEXT_PUBLIC_*` value is set; development/test only warns | `next.config.mjs` |
| Tests for the both-set / both-unset / half-set cases | `tests/unit/kid2465-chatwoot-build-env.test.ts` |
| Staging CI deploy fails before building when either Chatwoot secret is missing | `.github/workflows/cloudflare-verify.yml` |
| Build-time vs runtime env documented; post-build inline check added | `docs/CLOUDFLARE_MIGRATION.md` |
| Worker-build warning added to the widget runbook | `docs/CHATWOOT_WIDGET.md` |
| Example env leaves both values off by default | `.env.local.example` |

Both staging GitHub Actions secrets now exist:
`STAGING_NEXT_PUBLIC_CHATWOOT_BASE_URL`,
`STAGING_NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` (value never written to the repo).

## Staging deployment

| Item | Value |
| --- | --- |
| Branch | `kid2465-chatwoot-token` (cut from `origin/master` `3135f10`) |
| Worker | `kiddy-web-staging` |
| Version | `da0c8cfc-4964-4a74-ac16-1cef0bb28f15` |
| URL | https://kiddy-web-staging.trois4ever.workers.dev |
| Previous version (rollback) | `64114c01-79a0-4d4b-a8ce-792668df30ff` (deployment `e9ed276f-40e9-4c53-aa8c-5ac2c5d8825c`) |
| Build env | staging Supabase public values, `NEXT_PUBLIC_SITE_URL` = staging worker, base URL `https://chatwoot.kiddyapp.net`, production website token, build-only session secret |

The built/live root layout chunk contains the website token as a literal and
no `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` runtime lookup:

```sh
grep -rl "$NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN" \
  .open-next/assets/_next/static/chunks/app
# layout-2e4a3803f714e702.js
```

## Live verification (staging, 2026-11-23)

Signed in as `founder.parent@staging.kiddy.test` (staging-only fixture).

| Check | Result |
| --- | --- |
| SDK loads (`chatwoot.kiddyapp.net/packs/js/sdk.js`) | 200 |
| Widget iframe `#chatwoot_live_chat_widget` mounts | present |
| Launcher bubble visible on `/` EN desktop 1366×900 | yes, 64×64 bottom-right (`kid2465-stg-en-desktop.png`) |
| Launcher bubble visible on `/?lang=ar` desktop | yes (`kid2465-stg-ar-desktop.png`) |
| Launcher bubble visible on `/` EN mobile 390×844 | yes (`kid2465-stg-en-mobile.png`) |
| Launcher bubble visible on `/?lang=ar` mobile | yes (`kid2465-stg-ar-mobile.png`) |
| Launcher visible on `/portal` and `/child` | yes (`kid2465-stg-portal-auth.png`, `kid2465-stg-child-auth.png`) |
| Launcher hidden on `/portal/messages` | yes — `__kiddyChatwootBubbleHidden = true`, bubble box 0×0 (`kid2465-stg-portal-messages-auth.png`) |
| Launcher hidden on `/child/messages` | yes — `__kiddyChatwootBubbleHidden = true`, bubble box 0×0 (`kid2465-stg-child-messages-auth.png`) |
| CSP | `script-src`/`connect-src`/`frame-src` include `https://chatwoot.kiddyapp.net`; no violation reported |
| Signed-in identity | `/api/chatwoot/identity` → 200 with identifier/name; `$chatwoot.setUser` present and `__kiddyChatwootIdentified` set |
| Console | only the pre-existing `/favicon.ico` 404; no page errors |

`/favicon.ico` returning 404 is pre-existing and unrelated to the widget.

## Production rollback reference (not yet cut)

| Item | Value |
| --- | --- |
| Current production version | `c143eb0b-4a07-4856-a043-78a9103733ef` |
| Current deployment | `a668366c-b694-48cb-9290-66c3e178cab1` |
| Message | `KID-2463-csp-r2-master-e86efa6` |

Rollback is a version rollback on the `kiddy-web` Worker; no route or DNS
change is needed.

## Production cut (gated)

Rebuild from the merged fix with the production public values exported (the
token from the Vercel production env, never committed), deploy the same way as
staging, then repeat the checks above on `https://kiddyapp.net` in EN and AR
and confirm the two messaging routes stay hidden.
