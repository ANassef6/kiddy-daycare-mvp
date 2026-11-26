# KID-2495 — canonical Cloudflare staging URL

Date: 2026-11-26. Author: Cody.

## Problem

The founder tested `https://kiddy-staging-orcin.vercel.app/portal/consents`. That
Vercel project stopped auto-deploying on 2026-11-26 (KID-2491) and its last
build predates the KID-2477..2487 batch, so current work is invisible there.
The real staging environment is the `kiddy-web-staging` Cloudflare Worker.

## What changed

1. Redeployed `kiddy-web-staging` from `staging` head `716a5b6` (the merge of
   PR #146, which contains the full KID-2477..2487 batch).
2. Attached the Workers custom domain `staging.kiddyapp.net` to the staging
   Worker via `wrangler.jsonc` (`routes` + `custom_domain: true`). The
   workers.dev host stays enabled as a fallback.
3. Set the staging Worker secret `NEXT_PUBLIC_SITE_URL=https://staging.kiddyapp.net`
   so mail/reset links point at the canonical host.
4. Rewrote `docs/STAGING.md` to make the Cloudflare URL canonical and mark the
   Vercel staging URL FROZEN/legacy.

## Deploy evidence

| Item | Value |
| --- | --- |
| Worker | `kiddy-web-staging` |
| Source | `origin/staging` @ `716a5b6` |
| Deploy version (with custom domain) | `7e9cffce-1840-482b-95b0-f76bb67c73aa` |
| Current version (after secret write) | `a50e8301-69fd-46eb-bcaf-889dcd57b282` |
| Build | `npx opennextjs-cloudflare build` green; 48 assets uploaded |
| Cron | `*/5 * * * *` preserved |

The build's app-paths manifest contains the batch routes:
`/portal/consents`, `/portal/drive`, `/platform/daycares/[id]/settings`,
`/platform/daycares/[id]/settings/billing`, and
`/platform/daycares/[id]/settings/bulk-upload`.

Chunk-hash check (same route, different builds):

| Host | `/login` page chunk |
| --- | --- |
| `https://staging.kiddyapp.net` | `page-c789fe3462f4f32c.js` (matches the new local build) |
| `https://kiddy-staging-orcin.vercel.app` (frozen) | `page-ab487a3b5c1f6768.js` |

## Canonical host

```
$ curl -sI https://staging.kiddyapp.net/login
HTTP/2 200
server: cloudflare
```

- DNS: proxied `AAAA 100::` on the `kiddyapp.net` zone (Workers custom domain).
- Certificate: `cert_id 6e18d34f-6d14-4e5e-98c5-7e8b994ed781`, domain enabled.
- `https://kiddy-web-staging.trois4ever.workers.dev/login` still returns 200.

## Founder login verification

Skyvern run `tsk_601383230408059920` (engine `skyvern-1.0`, real Chromium):

- Started at `https://staging.kiddyapp.net/login`.
- Signed in as `founder.owner@staging.kiddy.test` (staging DB fixture).
- Final page: title `Founder Test Daycare — childcare, in your pocket`,
  heading `Dashboard`.
- HAR: `POST https://staging.kiddyapp.net/login` → `303` →
  `GET /portal/dashboard` → `200`; 45 requests to `staging.kiddyapp.net`,
  zero 4xx/5xx.
- Screenshot: `staging-founder-dashboard.png` (Founder Test Owner, 2 children,
  3 staff, 2 rooms; Pending consents, incidents, demo requests, parent drive).

The login works on the canonical host with the unchanged staging database, so
the founder's existing credentials carry over.
