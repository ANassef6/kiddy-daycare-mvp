# KID-2453 — Media storage on Cloudflare R2 (private, presigned)

Status: **complete — staging verified and production cut over.** Live cloudflare
R2 uploads, signed reads, expiry, cross-tenant refusal and the legacy migration
passed on staging and again on production. The raw-REF hydration fix (commit
`c6c3d92`) is live on both environments. Production cutover ran after the founder
accepted approval card `623c8fb1` (2026-11-20T16:39:52Z). Supabase Storage copies
are deliberately kept (dual-read) until the retirement step is approved.

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

## Production cutover (2026-11-20)

Founder sign-off: approval card `623c8fb1` accepted at 2026-11-20T16:39:52Z
("Approve the production media cutover to Cloudflare R2").

| Item | Value |
| --- | --- |
| Pull request | #74 `kid2453-prod-cut` → `master` |
| Merge commit | `f943afa` |
| Cut branch base | `origin/master` `e096b1f` |
| Cherry-picked commits | `4bbf9b1`, `86ec0c7`, `00441fa`, `79ecd2b`, `c6c3d92` |
| Production deployment | `dpl_FgYPTapUh7RoBZ1WsCDojZQrmq1e` — READY, `master` |
| Production bucket | `kiddy-media-prod` (WEUR, private, no public domain) |
| Bucket CORS | `GET`/`PUT`/`HEAD` from `kiddyapp.net`, `*.kiddyapp.net`, `kiddy-one.vercel.app` |
| Secrets | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — encrypted, `production` target only |

The cut is a cherry-pick, not a branch merge: `master` did not carry the
unrelated KID-2449/KID-2451 commits below KID-2453 on `staging`. Gates on the
cut branch: `tsc` clean, ESLint 0 errors, 65 targeted tests passed (KID-2453,
KID-2450, KID-489, KID-1177), production build green. The PR's audit and both
Vercel checks passed before merge.

### Live bucket check (production credentials)

The R2 S3 secret is the SHA-256 hash of the Cloudflare API token value (the
token `id` is the access key id), as documented by Cloudflare. With the
production credentials:

| Step | Result |
| --- | --- |
| Signed PUT | 200 |
| HEAD | object present, exact size |
| Unsigned GET | 400 `InvalidArgument` |
| Presigned GET (`X-Amz-Expires=120`) | 200, exact bytes, `Cache-Control: private, max-age=120` |
| Expired signed GET (1 s TTL, 3 s wait) | 403 `ExpiredRequest` |
| Presigned PUT | 200 |
| DELETE and HEAD after delete | 204, then 404 |

CORS preflight from `https://sunshine.kiddyapp.net` and `https://kiddyapp.net`
returns 204 with `Access-Control-Allow-Methods: GET, PUT, HEAD`, so browser
direct uploads pass preflight. Raw log: `prod-r2-verify.log`.

### Existing media migration

The production library was small: 2 child photos, 2 staff photos, 2 payment
proofs, 2 drive files and 2 newsfeed attachments — 10 objects, 6 of them still
on pre-KID-1177 public Supabase URLs and 4 inline `data:` URIs. The database
connection string is a write-only Vercel secret, so the migration used the
Supabase service role through PostgREST with the same source/key/verification
rules as `scripts/migrate-media-to-r2.ts`:

| Source kind | Rows | Destination |
| --- | --- | --- |
| Public Supabase Storage URL (`kiddy-public`) | 6 | same object path under `r2-private:` |
| Inline `data:` URI | 4 | `legacy/<table>/<id>/<uuid>.<ext>` |
| **Total** | **10** | **migrated=10, failures=0** |

Each object was PUT to R2, HEADed for the exact byte length, and only then did
the row change to `r2-private:<key>`. The Supabase copies were kept. Raw log:
`prod-migration.log`.

### Live production checks

Authenticated through the real operator login and the audited "Enter as admin"
flow for Sunshine Daycare (production), then read the pages:

| Check | Result |
| --- | --- |
| Child page `/portal/children/mud3euq6-j2xfy0jt` | 200; **0** `r2-private:` strings; **3** signed R2 URLs |
| Child photo bytes | signed GET 200, `1,885,611` bytes, `image/jpeg` — exact source size |
| Newsfeed `/portal/newsfeed` | **0** raw REFs; **6** signed R2 URLs |
| Drive `/portal/drive` | **0** raw REFs; **8** signed R2 URLs |
| Child billing `/portal/children/<id>/billing` | **0** raw REFs; **2** signed R2 URLs |
| Child detail page (admin) | **0** raw REFs; **3** signed R2 URLs |
| Cross-tenant child page | `404`, no media URL |
| Unauthenticated child page | redirect to `/login`, no media URL |
| Unsigned R2 GET | 400 |
| Expired signed GET | 403 |

Screenshots: `prod-platform.png`, `prod-child-photo.png`, `prod-newsfeed.png`,
`prod-drive.png`, `prod-billing.png`, `prod-child-detail.png`,
`prod-auth-negative-login.png`. HTML snapshots: `prod-child.html`,
`prod-newsfeed.html`, `prod-drive.html`, `prod-billing.html`. Run log:
`prod-verification.log`.

The direct-upload endpoint correctly refuses the operator-view session (`No
daycare is selected for this upload`): that session is bound to the host but is
not a tenant account. The upload path itself (presign → PUT → finalize cap
re-check) was verified end-to-end on staging with the same code; production
bucket signing, CORS and expiry were verified with the live credentials above.

### Pre-existing pricing migration ledger repair (not caused by KID-2453)

The first authenticated production render after the cut exposed a **pre-existing**
database state problem: `/platform` returned the generic error page because the
migration runner replayed `0045_pricing_v2.sql`, whose `pricing_band` INSERT names
`annual_egp`, a column that `0048` had already dropped. `schema_migrations` was
missing rows `0045`, `0047`, `0048`, `0049` and `0050`, although their effects
were present (verified column by column); `0052` had genuinely not applied.

Repair, after verifying each effect:

1. Recorded the five already-applied files in `schema_migrations`.
2. Let the next cold start apply the one genuinely pending migration, `0052`
   (`daycare_billing.band_key`, `branch_billing.band_key`, band index).
3. Re-ran the operator flow: `/platform` renders, Sunshine Daycare "Enter as
   admin" works, and the media checks above pass.

This is a KID-2435 migration-runner robustness issue (multi-statement files are
not transactional, so a timed-out cold start can apply statements without
recording the ledger row). It is independent of R2. Recommended follow-up: run
each migration file in one transaction together with its ledger insert.

## Remaining

- Retire the Supabase Storage copies (dual-read fallback) only after the
  founder confirms production is good; pass `--delete-source` per the migration
  policy.
- Fix the KID-2435 migration runner so a migration and its ledger row commit
  atomically.
