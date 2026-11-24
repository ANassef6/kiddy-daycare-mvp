# KID-2466 — production cut record (event photo/video attachments)

Status: **complete — production cut finished and verified.**

The staging detail and screenshots live in `README.md`. This record covers the
production cut only.

## Approval

The founder accepted the human-only confirmation card `a71b939d-afe7-439e-951e-347d0d875801`
("Approve the KID-2466 production cut") on **2026-11-24T00:04:42Z**.

## What shipped

The per-event URL-paste control is replaced by the shared **MediaUploadForm** on
the presigned R2 pipeline, with an `event` upload purpose (photos/videos only,
4 MB, video ≤60 s), server-side HEAD verification of direct-upload REFs, tenant
checks on the target event, a visible **Add media / Close** control per event
card, and signed-URL rendering (with `<video controls>`) on the staff and parent
event pages and the parent video shelf.

| Item | Value |
| --- | --- |
| Pull request | #112 `kid2466-prod-cut` → `master` |
| Merge commit | `32a65f410e90279e0b5e47a2bb9007c418a122ba` (2026-11-24T00:18:15Z) |
| Branch content | cherry-picks of `de5b27d`, `2d09e9d`, `751ce81` onto `master` |
| Worker | `kiddy-web` version `6cad1a8a-57e2-4366-8428-d6921748c091` (2026-11-24T00:24Z) |
| Previous worker version (rollback) | `3f7287fc-0c74-441f-bea8-b0e3bb75dea0` (KID-2467 build, 2026-11-24T00:18:51Z) |
| Routes / DNS | unchanged |
| Migrations | none |

`master` also carried KID-2467 (PR #111, merged at `980e111` immediately before
#112). The first KID-2466 deploy (`df20d0a6`) was built from the PR branch before
that merge and therefore did not include KID-2467; it was replaced four minutes
later by `6cad1a8a`, built from the actual `master` tree (`32a65f4`) that
contains **both** changes. The Worker now serves both.

### Build inputs

Recreated from the values the previous production build inlined (KID-2463 /
KID-2465 records); the Chatwoot website token was read from the deployed
`layout-*.js` chunk, never written to the repo:

- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` — public value already in the live layout chunk
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`
- `KIDDY_CSP_MODE=report-only`
- `SESSION_SECRET` — build-only boot check; the Worker keeps its runtime secret
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` was **not** set at build time, matching the
  previous build (the literal `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY` stays
  in the client/template code and the runtime Worker binding supplies it)

Deploy method: `npx opennextjs-cloudflare build` on `32a65f4`, then
`npx opennextjs-cloudflare deploy --message KID-2466-events-attachments-master-32a65f4`.

The deploy is additive: only the script version and its static assets changed.
Worker secrets, the Hyperdrive binding, the cron trigger and zone routes were
not touched.

## Gates on the deployed tree (`32a65f4`)

| Gate | Result |
| --- | --- |
| `tests/unit/kid2466-events-attachments.test.ts` | 12/12 passed |
| `tests/unit/kid2467-drive-documents.test.ts` (merged sibling) | 11/11 passed |
| Related KID-221 / KID-368 / KID-2450 / KID-2453 suites | 54/54 passed |
| `tsc --noEmit` | clean |
| `next lint` | 0 errors (pre-existing `no-img-element` warnings only) |
| `opennextjs-cloudflare build` | green |

## Live verification (production, 2026-11-24T00:26–00:30Z)

Raw copy: `prod-verify.json`.

### Deployed bundle

| Check | Result |
| --- | --- |
| Served layout chunk | `layout-60f207383df14807.js` (build output of `32a65f4`) |
| Chatwoot token inlined in that chunk | yes |
| Worker bundle contains the `event` purpose and `eventMedia` rejections | yes (20 occurrences) |
| Worker bundle contains the KID-2467 document guards (sibling, no regression) | yes |

### Anonymous probes

| Probe | Result |
| --- | --- |
| `GET /` and `/login` | `200` |
| `GET /portal/events`, `/child/events` | `307 -> /login` |
| `GET /_next/static/chunks/app/layout-60f207383df14807.js` | `200`, 7,540 bytes |
| `GET /api/media/presign` (no session) | `405` (POST-only route) |
| CSP on `/login` (Sunshine) | `Content-Security-Policy-Report-Only` with the R2 origin; unchanged |
| `server` / `x-opennext` on an authenticated page | `cloudflare` / `1` |

### Authenticated parent checks

Production has no exposed staff test credential, so the staff upload flow was
verified end-to-end on staging on the same code (README) and production was
verified through the demo parent account (`parent@example.test`, Sunshine) via
`POST /api/mobile/login` → `kiddy_sess` cookie. This exercises the shared
signed-URL path that the new event pages use.

| Page | Status | Signed `X-Amz-Signature` URLs | Raw `r2-private:` | `<img>` | `<video>` |
| --- | --- | --- | --- | --- | --- |
| `/child` | `200` | 0 | 0 | 2 | 0 |
| `/child/newsfeed` | `200` | 6 | 0 | 4 | 0 |
| `/child/drive` (KID-2467) | `200` | 8 | 0 | 2 | 0 |
| `/child/events` | `200` | 0 (no media on the seeded events) | 0 | 2 | 0 |

The events page renders authenticated, is not the login page, and emits no raw
`r2-private:` REF. The signed-media pipeline renders live in production on the
parent newsfeed and parent drive, and the parent events page uses the same
`signedUrlsForRefs` helper.

## Rollback

```sh
npx wrangler rollback --name kiddy-web
```

That returns the Worker to the immediately previous version,
`3f7287fc-0c74-441f-bea8-b0e3bb75dea0`, which restores the KID-2467 build and
drops KID-2466 only. No route, DNS or migration change was made.
