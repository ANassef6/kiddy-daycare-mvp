# KID-2463 — allow the R2 media origin in the CSP

Status: **complete — staging and production verified (report-only).**

## Change

`next.config.mjs` defines the account-stable R2 S3 origin once:

```js
const R2_MEDIA_ORIGIN =
  "https://85c675833ff17bc65e8b5b5ae43455cd.r2.cloudflarestorage.com";
```

It is appended to `img-src` (signed media reads) and `connect-src` (presigned
direct uploads). `KIDDY_CSP_MODE` is unchanged: the header is still
`Content-Security-Policy-Report-Only`. Enforcement stays a separate decision.

The origin is a constant, not an env lookup, because the R2 secrets are
runtime-only (Worker secrets / Vercel env) and are not present when the
build-time CSP is rendered.

## Unit test

`tests/unit/kid1178-security-headers-csp.test.ts` adds
`allows the R2 media origin for signed reads and presigned uploads (KID-2463)`:

- the origin is a token in `img-src` and `connect-src`;
- it is absent from `script-src` and `frame-src`.

`npx vitest run tests/unit/kid1178-security-headers-csp.test.ts` → **13/13
passed**. ESLint on both changed files → 0 findings.

## Staging verification (report-only)

| Item | Value |
| --- | --- |
| URL | https://kiddy-staging-orcin.vercel.app |
| Branch | `staging` (PR #100 merge `100c10d`) |
| Browser | Chromium 1148, headless, 1366×900 |
| Account | `founder.owner@staging.kiddy.test` (staging fixture only) |

Shipped header (raw copy in `staging-csp-header.txt`):

```
content-security-policy-report-only: … img-src 'self' data: blob:
  https://pjubkhhuccoqboypgpty.supabase.co https://*.supabase.co
  https://*.supabase.in
  https://85c675833ff17bc65e8b5b5ae43455cd.r2.cloudflarestorage.com;
  … connect-src … https://fcm.googleapis.com
  https://85c675833ff17bc65e8b5b5ae43455cd.r2.cloudflarestorage.com; …
```

### Signed media reads

The browser collected `securitypolicyviolation` events through an init script
and every R2 response. Raw capture: `staging-pages-network.json`.

| Page | Signed R2 images | R2 GET status | CSP violations |
| --- | --- | --- | --- |
| `/portal/children` | 2 | 200, 200 | 0 |
| `/portal/newsfeed` | 1 | 200 | 0 |

Objects resolved from `kiddy-media-staging` (child photo, legacy child photo,
newsfeed attachment). Screenshots: `staging-children-r2.png`,
`staging-newsfeed-r2.png`.

### Presigned attachment upload (staff)

Thread `mwsq7di4-n6xees59`, message body `KID-2463 CSP check …`, 2×2 PNG
attachment. Raw capture: `staging-upload-network.json`.

| Step | Result |
| --- | --- |
| `POST /api/media/presign` | 200 |
| Signed `PUT` to `kiddy-media-staging/messages/…png` | 200 |
| Signed `GET` of the new object after send | 200 (image rendered) |
| `securitypolicyviolation` events | 0 |
| `POST /api/csp-report` | none |
| Message marker visible without reload | yes |

Screenshots: `staging-messages-before-upload.png`,
`staging-messages-after-upload.png`.

The upload request also appears once as `net::ERR_ABORTED` after its 200
response. This is the browser cancelling the unread response body after
`fetch()` resolved (`lib/media-upload-client.ts` checks `put.ok` and does not
consume the body); the object was stored and its signed GET returned 200. It is
not a CSP or upload failure.

## Production cut

The founder accepted the production confirmation card (`3a60c585`) on
KID-2463 at **2026-11-23T21:15:57Z**. That acceptance is the production
approval for this change; `KIDDY_CSP_MODE` was not touched.

| Item | Value |
| --- | --- |
| Pull request | #102 `kid2463-csp-r2` → `master` |
| Merge commit | `e86efa672dca322d5b28ae43e179d42ac734b1a7` (2026-11-23T21:16:27Z) |
| Worker | `kiddy-web` version `c143eb0b-4a07-4856-a043-78a9103733ef` (2026-11-23T21:24Z) |
| Previous worker version (rollback) | `07862329-ba7e-4c5e-a706-c2d3b4a68469` |
| Build inputs | production public values already in use: `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`, `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`, `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`, `KIDDY_CSP_MODE=report-only` |
| Deploy method | `opennextjs-cloudflare build` on `e86efa6`, then `wrangler deploy --message KID-2463-csp-r2-master-e86efa6` |

The deploy is additive: only the script version changed. Runtime Worker
secrets, Hyperdrive bindings, cron triggers and zone routes were not changed.

### Header after deploy

`https://sunshine.kiddyapp.net/login` (raw copy in `prod-csp-header.txt`)
serves `content-security-policy-report-only` with the R2 origin in both
directives:

```
… img-src 'self' data: blob: https://sfetmfmtoubtdyyeyudd.supabase.co
  https://*.supabase.co https://*.supabase.in https://chatwoot.kiddyapp.net
  https://85c675833ff17bc65e8b5b5ae43455cd.r2.cloudflarestorage.com; …
… connect-src … https://fcm.googleapis.com
  https://85c675833ff17bc65e8b5b5ae43455cd.r2.cloudflarestorage.com; …
```

The same header was confirmed on `kiddyapp.net` and `maple-grove.kiddyapp.net`.

### Production verification (2026-11-23T21:25Z)

Chromium 1148, headless, 1366×900, signed in as the Sunshine demo staff
account on https://sunshine.kiddyapp.net. Raw capture:
`prod-pages-network.json`; screenshots: `prod-children.png`,
`prod-newsfeed.png`.

| Page | Signed R2 reads | Status | CSP violations |
| --- | --- | --- | --- |
| `/portal/children` | 2 (`staff/…/photo`, `child/…/photo`) | 200, 200 | 0 R2 |
| `/portal/newsfeed` | 3 (`staff` photo, 2 legacy newsfeed attachments) | 200, 200, 200 | 0 R2 |

Presigned attachment upload as staff (`POST /api/media/presign` → signed R2
`PUT`), 2×2 PNG, purpose `message`:

| Step | Result |
| --- | --- |
| `POST /api/media/presign` | 200 |
| Signed `PUT` to `kiddy-media-prod/messages/…png` | 200 |
| `securitypolicyviolation` for the R2 origin | 0 |
| `POST /api/csp-report` naming the R2 origin | none |

The object was uploaded but deliberately not linked to a message row, so no
parent-visible message was created on production. Signed reads of existing R2
objects are proven by the six 200 GETs above.

The only `securitypolicyviolation` observed was the pre-existing, out-of-scope
`script-src-elem` block for
`https://static.cloudflareinsights.com/beacon.min.js/…`. The report-only
endpoint accepted three such reports with `204`. CSP stays report-only, so
nothing is blocked.

## Reproduce

```sh
# header + unit test
curl -sI https://sunshine.kiddyapp.net/login | grep -i content-security
npx vitest run tests/unit/kid1178-security-headers-csp.test.ts
```

The browser runs used a local Playwright script that signs in, records
`securitypolicyviolation`, and inspects every `r2.cloudflarestorage.com`
response. `prod-pages-network.json` is the raw capture from the production run.

## Rollback

- Worker: `npx wrangler rollback --name kiddy-web` to version
  `07862329-ba7e-4c5e-a706-c2d3b4a68469`.
- No migration was added by this change, so there is no schema rollback.
- Reverting the merge restores the previous report-only CSP without the R2
  origin; no runtime secret changes are needed.
