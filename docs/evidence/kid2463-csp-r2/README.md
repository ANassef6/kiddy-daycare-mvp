# KID-2463 — allow the R2 media origin in the CSP

Status: **staging verified (report-only). Production deploy is gated on the
normal approval card and has not run.**

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

## Production

Not deployed. The production Worker still serves the report-only CSP without
the R2 origin, and every signed read/upload continues to log a report-only
violation. After the founder accepts the production approval card:

1. Cherry-pick this commit onto `master`.
2. Deploy the `kiddy-web` Worker (normal production path).
3. Repeat the checks on https://sunshine.kiddyapp.net: signed R2 image 200,
   presigned upload 200, zero R2 CSP violations, then update this record.

## Reproduce

```sh
# header + unit test
curl -sI https://kiddy-staging-orcin.vercel.app/login | grep -i content-security
npx vitest run tests/unit/kid1178-security-headers-csp.test.ts
```

The browser runs used a local Playwright script that logs in with the staging
fixture, records `securitypolicyviolation`, and inspects every
`r2.cloudflarestorage.com` response. Captures are committed beside this file.
