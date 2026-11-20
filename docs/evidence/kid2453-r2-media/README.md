# KID-2453 — Media storage on Cloudflare R2 (private, presigned)

Status: **implementation complete, staging deployment pending Cloudflare/R2
credentials.** Production storage cutover remains gated on a founder approval
card. Supabase Storage stays readable (dual-read) until staging verification
passes.

## Decision

Founder decision (KID-215 comments `8fdc1f26` / `45e6127f`, 2026-11-20): move
media to Cloudflare R2 **now**, before real daycares onboard, because Supabase
egress is the cost spike ($0.09/GB uncached) and migrating a live library later
is the expensive part. This is the media half of the Cloudflare window; KID-2452
is the hosting half. The KID-2452 note that "R2 is deferred" refers only to its
**incremental cache**, not to media.

Hard privacy rule: children's media is never public. Every R2 object lives in
a private bucket and is read through a short-lived presigned GET minted on the
server in an authorized render context.

## What changed

| Area | Change |
| --- | --- |
| Provider contract | `lib/storage/types.ts` — one private-object interface (`put`, `head`, `remove`, signed GET/PUT). |
| R2 provider | `lib/storage/r2.ts` — S3-compatible SigV4 via `aws4fetch` (runs in Node and Workers). Bucket is private; no public object URLs. |
| Supabase provider | `lib/storage/supabase.ts` — the previous `lib/storage.ts` internals, kept as the dual-read/fallback provider. |
| Facade | `lib/storage.ts` — provider selection, REF compatibility, signed GET/PUT, batch resolution. |
| Presigned uploads | `app/api/media/presign/route.ts` + `lib/media-upload.ts` + `lib/media-upload-client.ts`. The browser requests a 15-minute PUT ticket, uploads after compression (KID-2450), then submits the REF. |
| Finalize guard | `takeUploadedRef()` re-checks tenant/purpose prefix, HEADs the object, re-applies the size/MIME cap, and deletes invalid objects. The presigned URL is not a cap bypass. |
| Upload paths | Child/staff/account photos, payment proofs (parent + daycare), contracts, drive files, newsfeed attachments, message attachments. Branding stays genuinely public (R2 public host when configured, Supabase public bucket otherwise). |
| Render paths | Drive, newsfeed (portal + parent + child detail), message threads and the mobile child endpoint resolve refs to signed URLs server-side. The raw REF never reaches the browser. |
| Migration | `scripts/migrate-media-to-r2.ts` — Supabase Storage objects and inlined `data:` URIs move to R2 with a byte-length verification before the row is rewritten. Source copies are kept unless `--delete-source` is passed. |
| Fallback | If R2 is unset or a put fails, writes fall back to Supabase Storage (logged, never silent). If R2 signing fails, reads fall back to the Supabase copy at the same key. |
| Config | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`; optional `R2_ENDPOINT` (local test rig) and `R2_PUBLIC_BASE_URL` (branding only). Documented in `.env.local.example` and `.dev.vars.example`; no values in git. |

REF formats (both accepted forever):

- `r2-private:<key>` — new private objects.
- `kiddy-private:<path>` — legacy Supabase objects (migrated, then retired).
- Legacy public URLs and `data:` URIs pass through unchanged.

## R2 bucket setup (staging first)

1. Create one **private** bucket per environment, e.g. `kiddy-media-staging`
   and `kiddy-media-production`. No public access, no `r2.dev` public domain on
   the media bucket.
2. Create an S3 API token scoped to that bucket (Object Read + Write). Store
   the id/secret as worker/Vercel secrets; never in `wrangler.jsonc`.
3. Add a bucket CORS rule for the app origins (presigned PUT is a cross-origin
   browser request):

```json
[
  {
    "AllowedOrigins": [
      "https://kiddy-staging-orcin.vercel.app",
      "https://staging.kiddyapp.net"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

4. Set the runtime secrets on the staging worker and the staging Vercel env.
   Branding only: optionally attach a public custom domain and set
   `R2_PUBLIC_BASE_URL`; never attach it to a bucket that holds child media.

## Local verification (this change)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | App code clean; only the pre-existing KID-2450 test-file union-narrowing errors in `tests/unit/kid2450-media-compression.test.ts` remain (unchanged by this task). |
| `npx eslint` on all changed files | 0 errors; only pre-existing `<img>` / worker default-export warnings. |
| `npx next build` | Green (dynamic routes + middleware compiled). |
| `npx vitest run tests/unit/kid2453-storage-r2.test.ts` | 9 passed — REF compatibility, R2 signing/upload, presign caps, forged-prefix and oversize rejection. |
| `npx vitest run tests/unit/kid1177-rls-storage.test.ts` | 19 passed (allowlist updated for the split provider module). |
| `npx vitest run tests/unit/kid2450-media-compression.test.ts` | 13 passed. |
| `npx vitest run tests/unit/kid489-payment-proof.test.tsx` | 24 passed. |
| `npx vitest run tests/unit/kid737,745,746,850` | 66 passed. |

These pin the local contract. They do **not** prove a live R2 round trip.

## Staging verification checklist (pending credentials)

- [ ] Create the staging bucket + token + CORS; set the six R2 secrets.
- [ ] Run the migration in dry-run, then for real; confirm `migrated` equals
      the expected small library and `failures=0`.
- [ ] Auth-positive: a signed-in staff member opens a child photo, a drive
      file, a newsfeed image, and a payment proof → all render from signed R2
      URLs; the URL expires (TTL 1h) and the REF is never in the HTML.
- [ ] Auth-negative: copy a signed URL, wait past expiry → 403; request the
      object key without signature → 403; unauthenticated page render → no
      media URL is emitted. Cross-tenant child/photo/ref is refused.
- [ ] Mobile + web upload: photo, video, PDF and drive file; confirm the
      presigned PUT path is used (network shows the R2 host) and the file
      appears after reload. Confirm an oversized/blocked type falls back to the
      friendly error, not a broken row.
- [ ] Compression intact: upload a large phone photo; the stored object is the
      compressed size (KID-2450).
- [ ] Dual-read: a row still on `kiddy-private:` renders while its R2 copy
      exists; then run `--delete-source` only after the two above pass.
- [ ] Founder spot-check on staging.

## Production cutover (gated)

Do **not** change production storage or production credentials until the
founder approves a confirmation card. After approval: create the production
bucket (separate from staging), set production secrets, run the migration
against production, repeat the positive/negative checks, and only then retire
Supabase Storage objects.
