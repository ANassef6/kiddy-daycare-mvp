# KID-2487 — production cut record (newsfeed likers + child tagging)

Status: **complete — the production Worker is cut, deployed and verified.**
Production runs on Cloudflare Worker `kiddy-web` behind `kiddyapp.net` and the
tenant hosts. The staging browser evidence for the feature lives in
`README.md`; this record covers the production cut only.

## Approval

The founder accepted the human-only confirmation card
`673cd844-2ea8-4813-a894-f159b36e14a2` ("Sign off KID-2487 on staging") on
**2026-11-26T21:00:27Z**. Accept meant "prepare the production cut".

## What shipped

Cherry-picked from `staging` (staging is not a strict superset of `master`, so
a batch fast-forward is not safe — the same per-item method as KID-2482):

| Commit | Content |
| --- | --- |
| `ba3bee6` | show post likers and tag children on post photos (likers disclosure, media viewer/tagger, `media.post_id`, audience + KID-2480 room guards, EN/AR) |
| `0a2ba61` | keep existing cross-classroom tags on save |
| `ba46b71` | detect post photo kind from its stored ref |
| `046e394` | classify post photos from the media ref name |
| `40af2b5` | tag and render post videos in child media; `media-src` CSP |
| `5ef01ce`, `65baf64`, `b5b432c` | staging and local EN/AR evidence |

Only conflict: the staging `lib/sqlite-schema.ts` hunk also carried an
unrelated KID-2481 `room.photo_url` backfill. That hunk was dropped; KID-2481 is
not part of this cut.

Not included: KID-2481, KID-2484, KID-2494, KID-2502..KID-2509 and the rest of
the staging-only batch. They remain pending their own sign-offs.

| Item | Value |
| --- | --- |
| Pull request | #168 `kid2487-prod-cut` → `master` |
| Merge commit | `eaf2615` (2026-11-26T21:18:09Z) |
| Worker | `kiddy-web` version `77530d45-6d3e-4385-b4fe-f2b4afebe9f9` (2026-11-26T21:21:02Z) |
| Deploy message | `KID-2487-likers-tags-master-eaf2615` |
| Previous worker version (rollback) | `eb62997f-f9ea-4d3d-bd57-5fb700c4623a` (KID-2482 build, 2026-11-26T20:43:40Z) |
| Routes / DNS | unchanged |
| Migrations | `0058_kid2487_media_post_link.sql` (idempotent, additive) |
| Env / secrets | none changed |

The deploy is additive: only the Worker script version changed. Worker secrets,
the Hyperdrive binding, the cron trigger and the zone routes were not touched.

### Build inputs

The same public values as the previous production build:

- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` — the same public value already present
  in the live layout chunk
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`
- `KIDDY_CSP_MODE=report-only`
- `SESSION_SECRET` — build-only boot check; the Worker keeps its runtime secret

`NEXT_PUBLIC_SUPABASE_ANON_KEY` was not set at build time, matching the live
build's `app/reset-password` chunk, which reads it at runtime from the Worker
secret.

Deploy method: `npx opennextjs-cloudflare build` on `eaf2615`, then
`npx wrangler deploy --env="" --message KID-2487-likers-tags-master-eaf2615`
(top-level Worker environment).

## Migration

`0058_kid2487_media_post_link.sql` was applied to the production Postgres
through the Supabase Management API in one transaction, and its filename was
recorded in `public.schema_migrations`. Applied at
`2026-11-26 21:14:56.631735+00`. Verified after the fact:

| Check | Result |
| --- | --- |
| `media.post_id` column | present, `text`, nullable |
| `idx_media_post` index | present on `media (post_id)` |
| `idx_media_child` index | present on `media (institute_id, child_id)` |
| `schema_migrations` row for the file | 1 |

Pre-existing ledger observation (not part of this cut):
`0057_kid2485_survey_audience.sql` is not in the production ledger and its
`form_template.audience_*` columns are absent. The cut tree contains no code
that reads or writes those columns, so nothing is broken by the gap today. It
is recorded here so the owning task can decide.

## Verification on the cut tree

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| KID-2487 + i18n page coverage + newsfeed batching + parent notifications + mobile child IDOR + CSP + KID-2480 suites | 9 files / 72 tests pass |
| `node supabase/verify-migrations.mjs` | all migration checks pass (PGlite) |
| `opennextjs-cloudflare build` | green |
| `wrangler deploy --dry-run` | 281 assets, 2.78 MiB gzip, prod bindings intact |
| CI on PR #168 (`Test + build + wrangler dry-run`) | pass |
| CI on PR #168 (`audit`) | pass |

## Live production verification (2026-11-26T21:23Z)

### HTTP smoke

| URL | Result |
| --- | --- |
| `/`, `/features`, `/for-parents`, `/for-centers`, `/contact` | `200` |
| `/login` | `200`, `x-opennext: 1`, `server: cloudflare` |
| `/manifest.webmanifest`, `/sw.js` | `200` |
| `/?lang=ar` | `200`, `<html lang="ar" dir="rtl">` |
| `/platform`, `/child` | `307 → /login` |
| `/portal/newsfeed`, `/child/newsfeed`, `/portal/children` | `307 → /login` |
| `sunshine.kiddyapp.net/login`, `maple-grove.kiddyapp.net/login` | `200` (tenant routes intact) |
| `kiddy-web.trois4ever.workers.dev/login` | `200` (fallback intact) |

### Served bundle matches the cut

| Check | Result |
| --- | --- |
| Live layout chunk | `layout-45ef9613e15dbb93.js` — SHA-256 `08e4016c…2a31`, byte-identical to the local build of `eaf2615` |
| Shared app chunk with the KID-2487 UI copy | `9082-8002a76c41101b41.js` — SHA-256 `0c8c7a7f…abba`, byte-identical to the local build and contains the KID-2487 copy |
| CSP header | `media-src` allows `'self'`, `data:`, `blob:`, the production Supabase host and the R2 host |

### Signed-in limitation

Production founder/operator credentials are not available in this workspace, so
no signed-in production write was made. The liker disclosure, photo/video
tagging, pre-checked tags and parent media sections are covered by the real
browser staging evidence in `README.md` and by the 11-test KID-2487 suite. The
production database now carries the `media.post_id` column the code reads and
writes.

## Rollback

```sh
npx wrangler rollback --name kiddy-web
```

That returns the Worker to `eb62997f-f9ea-4d3d-bd57-5fb700c4623a` (the KID-2482
build already live before this cut). `0058_kid2487_media_post_link.sql` is
additive and can stay; the older build does not read the new column. No route,
DNS or secret rollback is required.
