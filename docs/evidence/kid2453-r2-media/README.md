# KID-2453 — Media storage on Cloudflare R2 (private, presigned)

Status: **staging verified and signed off.** Live Cloudflare R2 uploads, signed
reads, expiry, cross-tenant refusal and the legacy migration all passed against
the staging project. The raw-REF hydration fix (commit `c6c3d92`) is live on
staging: the later `8ee1bae` push deployed successfully even though the explicit
redeploy attempt on the previous day hit `402 api-deployments-free-per-day`.
Production storage cutover remains gated on a founder approval card. Supabase
Storage stays readable (dual-read) until production cutover is verified.

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
| Upload actions | Child/staff/account photos, payment proofs (parent + daycare), contracts, drive files, newsfeed attachments, message attachments. The direct-upload path is checked **before** the multipart file check; the multipart file remains the fallback. Branding stays genuinely public. |
| Cache policy | Private objects are stored `private, max-age=0, no-store`; signed GET responses override with `private, max-age=<ttl>`, so no shared edge cache stores children's media. Branding objects use a one-year immutable public TTL. |
| Render paths | Drive, newsfeed (portal + parent + child detail), message threads, child/staff photos and the mobile child endpoint resolve refs to signed URLs server-side. The full child row is no longer passed to the observation modal picker, which previously exposed `photo_url` in the RSC payload. |
| Migration | `scripts/migrate-media-to-r2.ts` — Supabase Storage objects and inlined `data:` URIs move to R2 with a byte-length verification before the row is rewritten. Source copies are kept unless `--delete-source` is passed. |
| Fallback | If R2 is unset or a put fails, writes fall back to Supabase Storage (logged, never silent). If R2 signing fails, reads fall back to the Supabase copy at the same key. |
| Config | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`; optional `R2_ENDPOINT` (local test rig) and `R2_PUBLIC_BASE_URL` (branding only). Documented in `.env.local.example` and `.dev.vars.example`; no values in git. |

REF formats (both accepted forever):

- `r2-private:<key>` — new private objects.
- `kiddy-private:<path>` — legacy Supabase objects (migrated, then retired).
- Legacy public URLs and `data:` URIs pass through unchanged.

## R2 bucket setup (staging — done)

1. Private bucket `kiddy-media-staging` created in WEUR. No public access and
   no `r2.dev` public domain.
2. Bucket-scoped S3 API token created with Object Read + Object Write only.
   Stored as encrypted Vercel env vars on the `kiddy-staging` project
   (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`);
   never in git.
3. Bucket CORS allows `GET`, `PUT`, `HEAD` from the staging and local origins,
   with `content-type` and `cache-control` request headers and `ETag` exposed.
4. Branding only: optionally attach a public custom domain and set
   `R2_PUBLIC_BASE_URL`; never attach it to a bucket that holds child media.

## Local verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | App code clean; only the pre-existing KID-2450 test-file union-narrowing errors in `tests/unit/kid2450-media-compression.test.ts` remain (unchanged by this task). |
| `npx eslint` on all changed files | 0 errors; only pre-existing `<img>` / worker default-export warnings. |
| `npx next build` | Green (staging env + R2, dynamic routes + middleware compiled). |
| `npx vitest run tests/unit/kid2453-storage-r2.test.ts` | 9 passed — REF compatibility, signed-GET cache header, signed-PUT cache header, presign caps, forged-prefix and oversize rejection. |
| `npx vitest run tests/unit/kid2450-media-compression.test.ts tests/unit/kid489-payment-proof.test.tsx` | 46 passed with the KID-2453 suite (13 + 24 + 9). |

## Live R2 round trip (real Cloudflare bucket)

A real S3-compatible request run against `kiddy-media-staging`:

| Step | Result |
| --- | --- |
| Signed PUT (`text/plain`, `private, max-age=0, no-store`) | 200 |
| HEAD | 200, stored `cache-control: private, max-age=0, no-store` |
| Unsigned GET | 400 `InvalidArgument: Authorization` |
| Presigned GET (`X-Amz-Expires=120`) | 200, exact bytes, `Cache-Control: private, max-age=120` |
| GET with expiry params but no signature | 400 |
| Presigned PUT | 200 |
| Signed DELETE | 204 |
| HEAD after delete | 404 |

Signed-URL expiry was also checked with a one-second TTL: after three seconds
the GET returned `403 ExpiredRequest`.

## Staging verification (2026-11-20)

Deployment under test: `staging` at `79ecd2b` (Vercel production target, the
`kiddy-staging` project). Browser run: Chromium, 1366×900, owner login
`founder.owner@staging.kiddy.test`.

The staging media library was empty before this run (0 non-null values across all
11 migration target columns), so the real migration was a no-op. To prove the
migration and dual-read path, one synthetic legacy fixture was added and then
migrated:

1. Uploaded a PNG to `kiddy-private/child/mwmgz4gn-s71wfgue/legacy-photo.png`.
2. Set that child's `photo_url` to `kiddy-private:child/mwmgz4gn-s71wfgue/legacy-photo.png`.
3. The page rendered a Supabase **signed** URL (`/storage/v1/object/sign/kiddy-private/...`) — dual-read confirmed (`staging-child-photo-legacy.png`).
4. Ran `scripts/migrate-media-to-r2.ts`: `migrated=1 queued=1 already=1 failures=0`.
5. The row became `r2-private:child/mwmgz4gn-s71wfgue/legacy-photo.png`; a HEAD on R2 returned 21430 bytes, exactly the source length.
6. The page then rendered a signed R2 URL (`staging-child-photo-r2.png`).

| Check | Result |
| --- | --- |
| Presigned photo upload (child page) | `POST /api/media/presign` 200 → signed `PUT` to `kiddy-media-staging` 200 → row `r2-private:photos/...` → signed `GET` 200 rendered |
| Drive upload | signed `PUT` 200 → `drive_file.url` `r2-private:` → signed R2 link on the drive page |
| Newsfeed upload | signed `PUT` 200 → `newsfeed_post.media_url` `r2-private:` → signed R2 image on the newsfeed (`staging-newsfeed-r2.png`) |
| Message attachment | signed `PUT` 200 → `message_thread.attachment_url` `r2-private:` → signed R2 image in the thread (`staging-message-r2.png`) |
| Parent payment proof | upload 200 → `child_billing.payment_proof_url` `r2-private:payments/...`, reference `KID-2453-STAGING` stored → signed R2 link (`staging-payment-proof-r2.png`) |
| Legacy migration | 1 object migrated, byte length verified, row rewritten, R2 HEAD matched |
| Auth-negative: unauthenticated child page | redirected to `/login`, status 200 after redirect, no R2/Supabase media URL in the HTML |
| Auth-negative: cross-tenant child page | `404`, no media URL in the HTML |
| Auth-negative: unsigned R2 GET | 400 `InvalidArgument` |
| Auth-negative: expired signed GET | 403 `ExpiredRequest` |

Screenshots in this folder:

- `staging-child-photo-upload-r2.png` — child photo after the presigned R2 upload.
- `staging-child-photo-legacy.png` — the same surface while the row was still a Supabase `kiddy-private:` REF (dual-read).
- `staging-child-photo-r2.png` — the migrated fixture row rendering from R2 after `migrate-media-to-r2.ts`.
- `staging-newsfeed-r2.png` — newsfeed attachment served from R2.
- `staging-message-r2.png` — message attachment served from R2.
- `staging-payment-proof-r2.png` — parent payment proof stored in R2.

## Bugs found and fixed during staging verification

1. **Direct uploads were rejected before they were read.** Photo, account-photo
   and payment-proof actions checked `formData.get("file")` before calling
   `takeUploadedRef()`. A successful direct upload submits only `fileRef`, so
   the action redirected and the row was never updated. The REF is now checked
   first; the multipart file is validated only on the fallback path.
2. **The raw REF leaked into the RSC payload.** The observation modal received
   the full child row (`childChoices={[child]}`), so `photo_url` with the
   `r2-private:` REF appeared in the HTML. Both the child page and the learning
   page now pass only `{ id, first_name, last_name }`. Verified with a local
   production build (0 occurrences of `r2-private:` in the page HTML).
3. **The KID-2453 dependency install downgraded the toolchain.** The
   implementation commit rewrote `@types/node` to `20.17.6` and TypeScript to
   `5.8.2`, which made Vercel's `npm install` fail with an `ERESOLVE` conflict
   against Vite 8. The versions were restored and the lockfile regenerated.

## Staging redeploy of the raw-REF fix (2026-11-20, later)

The explicit redeploy attempt was refused by the Vercel daily limit, but the
next push to `staging` (the docs/evidence commit `8ee1bae`) built and deployed
normally. The live staging production deployment is
`dpl_2j8SdUKJ1BAwMWDADdHTdizv6MWB` (`kiddy-staging-orcin.vercel.app`, commit
`8ee1bae`), which contains the raw-REF fix `c6c3d92`. HEAD `36af047` differs
only by `verification.log`, so the deployed code matches the branch.

Live re-check as the staging owner (`founder.owner@staging.kiddy.test`):

| Check | Result |
| --- | --- |
| Child page `/portal/children/<id>` HTML | 0 occurrences of `r2-private:` |
| Child page media | 3 signed `r2.cloudflarestorage.com` URLs rendered |
| Learning page `/portal/learning` HTML | 0 occurrences of `r2-private:` |

The founder accepted the staging sign-off card, so the staging half is closed.

## Remaining

- Production cutover: create the separate private production bucket, set the
  production secrets, run the migration, repeat the positive/negative checks,
  and only then retire Supabase Storage. **Do not change production storage or
  production credentials until the founder approves the confirmation card.**
