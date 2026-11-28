# KID-2526 — production cut: KID-2482 / 2485 / 2487 / 2525

Status: **shipped and verified on production, 2026-11-28.**

## Approval

| Item | Value |
| --- | --- |
| Founder authorization | KID-215 comment `d32afba7-9939-43e0-8a4f-51614af3a420`, 2026-11-28T10:50Z: "Perfect, finalize everything and push production. Let me know when done to ask the testers to give it a try on production." |
| Scoped task | KID-2526 |
| Validation model | Founder sign-off given up front; tester validation happens on production instead of a separate founder staging pass. |
| Out of scope | KID-2479 (supplies on child profile; unmerged and not implemented). KID-2476 / 2465 / 2457 production items. |

## State at task start

The four items were already present on production from earlier
founder-approved cuts. This task verified each item, re-deployed the
production Worker from `master`, refreshed the Vercel production alias, and
closed the one remaining gap: the Vercel alias was still serving the KID-2524
build and did not include KID-2525.

| Item | Earlier cut | Production proof before this run |
| --- | --- | --- |
| KID-2525 | PR #182, master `8cfdbb7`, Worker `ec5adb96` (2026-11-28T08:53Z) | Worker script contained `/api/notifications/open`, `attendance_check_out`, `consent_created`, `incident_created` |
| KID-2482 | PR #165, master `6ddf047`, Worker `eb62997f` (2026-11-26T20:43Z) | Worker script contained `Everyone (whole center)`, picker strings; migration `0057` applied |
| KID-2485 | shipped inside the KID-2482 cut (`207ac81`, `8cdf950`) | `form_template.audience_channel` / `audience_room_ids` / `audience_child_ids` present; `0057` in the ledger |
| KID-2487 | PR #168, master `eaf2615`, Worker `77530d45` (2026-11-26T21:21Z) | `media.post_id`, `idx_media_post`, `idx_media_child` present; `0058` in the ledger |

`master` and `staging` have diverged, so the earlier cuts used per-item
cherry-picks. No new cherry-pick was required in this run: `master` already
carried all four items at the task start.

## What this run changed

| Item | Value |
| --- | --- |
| Source tree | `origin/master` @ `5b71216` (application code identical to the deployed KID-2525 cut `8cfdbb7`) |
| Worker deploy | `npx opennextjs-cloudflare build`, then `npx wrangler deploy --env="" --message KID-2526-production-cut-master-5b71216` |
| Deployed Worker version | `5a6b5576-c58d-42d7-9a44-1f703f82d273` (2026-11-28T11:12:24Z) |
| Worker rollback target (defined before deploy) | `ec5adb96-bf64-4230-9275-514fdc1bf900` (KID-2525 cut) |
| Vercel deployment | `dpl_96WHwLiLYH5mrJvhtaqH8JLehSZy`, state `READY`, target `production` |
| Vercel URL | `https://kiddy-3o0gu1fpy-kiddy2.vercel.app` |
| Vercel aliases | `kiddyapp.net`, `*.kiddyapp.net`, `kiddy-one.vercel.app`, `sunshine.kiddyapp.net`, `maple-grove.kiddyapp.net`, `maple-grove-daycare.kiddyapp.net`, `maple-grove-daycare-2.kiddyapp.net` |
| Vercel rollback target | `dpl_B7GqjBS84EuskKfbxERZNeSgVF63` (KID-2524 build, aliased before this run) |
| Staging | untouched — `kiddy-web-staging` still `9e081270-7a40-41b1-88f5-e95e4c6736fd` (2026-11-28T08:30Z) |

The Worker deploy is additive: only the script version changed. Worker
secrets, the Hyperdrive binding, the cron trigger and the zone routes were not
touched.

## Database

No production migration was pending. The ledger already contains both
migrations the four items need, applied in one transaction by their earlier
cuts:

| File | Applied | Added by |
| --- | --- | --- |
| `0057_kid2485_survey_audience.sql` | 2026-11-27T13:01:48.02693Z | KID-2519 batch (KID-2485 columns) |
| `0058_kid2487_media_post_link.sql` | 2026-11-26T21:14:56.631735Z | KID-2487 cut |

Verified on production Postgres `sfetmfmtoubtdyyeyudd` during this run:

| Check | Result |
| --- | --- |
| `form_template.audience_channel` | present, `text`, nullable (legacy `NULL` = centre-wide) |
| `form_template.audience_room_ids` / `audience_child_ids` | present, `text`, nullable |
| `media.post_id` | present, `text`, nullable |
| `idx_media_post` / `idx_media_child` | present |
| `form_template` rows | 4 |
| `media` rows | 1 |
| `consent_request` rows | 10 |
| `room` rows | 6 |
| `staff_schedule` rows | 0 |
| `newsfeed_post` rows | 17 |

Data is unchanged by this run. The migrations are additive and idempotent.

## CI / local gates on the cut tree

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| KID-2525 routes + KID-2482 picker/surfaces + KID-2485 surveys + KID-2487 likes/tags + KID-472/KID-684 notifications | 8 files / 101 tests pass |
| `node scripts/audit-gate.mjs` | PASS — no unresolved critical/high vulnerabilities |
| `npx opennextjs-cloudflare build` | green |
| `npx wrangler deploy --env="" --dry-run` | 285 assets, 2.81 MiB gzip, production bindings intact |

## Staging re-verification

Current staging Worker `9e081270` was checked with a real owner session
(`founder.owner@staging.kiddy.test`) through the Skyvern REST API after the
KID-2525 redeploy.

| Surface | Result | Screenshot |
| --- | --- | --- |
| `/portal/newsfeed`, new-post composer, Recipients open | **Everyone (whole center)**, **Classrooms** with **Little Stars** and **Sunflowers**, `Search children…`, Layla and Omar; form not submitted | `staging-newsfeed-recipients.png` |
| `/portal/surveys`, create-survey Recipients open | **Everyone (whole center)**, **Classrooms** with **Little Stars** and **Sunflowers**, `Search children…`, Layla and Omar; survey not created | `staging-surveys-recipients.png` |
| `/portal/newsfeed` tags | Existing posts render `for Layla Founder` and `for Omar Founder` (KID-2487 tagging) | `staging-newsfeed-recipients.png` |

Skyvern runs: `tsk_602069969908886682`, `tsk_602071022175874562`.
The picker screenshots above come from the second run (2026-11-28T11:10Z).

KID-2525 was verified on staging in its own task; the production mapping and
open route are covered again below. KID-2487 likers and media viewer have the
real-browser staging evidence in `docs/evidence/kid2487/README.md`.

## Production verification

### Served bundle matches the cut

| Check | Result |
| --- | --- |
| Live layout chunk | `layout-279783cc7ee5f320.js` — SHA-256 `fc3dc341…d5c075`, byte-identical to the local build of `5b71216` |
| Shared app chunk | `9082-eb6126910ee44516.js` — contains `Tag children`, `Photo tags saved`, `Everyone (whole center)` |
| Vercel `kiddy-one.vercel.app` chunk | same `9082-eb6126910ee44516.js`, so Worker and Vercel serve the same app chunk |
| Worker script strings | `/api/notifications/open` (56), `attendance_check_out` (14), `consent_created` (14), `incident_created` (14), `newsfeed_post` (144), `audience_channel` (16), `audience_room_ids` (16), `audience_child_ids` (16), `post_id` (202), `Tag children` (6), `Photo tags saved` (6), `Everyone (whole center)` (12) |

### Per-item production result

| Item | Result | Evidence |
| --- | --- | --- |
| KID-2525 notification topic routing | Pass. `/api/notifications/open?id=test` returns `307 -> /login` on both hosts; `/child/notifications`, `/child/newsfeed`, `/child/consents`, `/child/incidents` exist behind the auth gate; the Worker script carries the full mapping and open handler. | HTTP probes + Worker script |
| KID-2482 recipients picker | Pass. Production DB has the audience columns; the served app chunk carries the picker copy; current staging re-verification shows the picker on newsfeed with the classroom checklist before any channel is selected. | Screenshot, bundle, DB |
| KID-2485 survey recipient selection | Pass. `0057` applied; production `form_template` has all three audience columns; current staging re-verification shows the picker on `/portal/surveys` with Everyone, Classrooms, child search and children. | Screenshot, DB |
| KID-2487 newsfeed likers + child tagging | Pass. `0058` applied; `media.post_id` and both indexes present; served app chunk carries the tag UI; staging posts show per-child tags. | DB, bundle, staging screenshot |

Production parent/owner credentials are not available in this workspace, so no
signed-in production click was made. This is the same production-evidence
method recorded for KID-2487, KID-2511, KID-2519, KID-2524 and KID-2525: the
behaviour was verified with a real session on staging, the production database
has every column/index the paths read, and the production Worker and Vercel
bundles contain the cut code. Testers validate the signed-in production flow.

## Health checks

### Cloudflare Worker (`https://kiddyapp.net`)

| URL | Result |
| --- | --- |
| `/`, `/login`, `/features`, `/for-parents`, `/for-centers`, `/contact` | `200` |
| `/manifest.webmanifest`, `/sw.js`, `/?lang=ar` | `200` |
| `/child`, `/portal/newsfeed`, `/portal/surveys`, `/portal/forms`, `/portal/consents`, `/portal/attendance`, `/child/notifications` | `307 -> /login` |
| `/api/notifications/open?id=test` | `307 -> /login` (no open redirect) |
| `sunshine.kiddyapp.net/login`, `maple-grove.kiddyapp.net/login` | `200` |
| `https://chatwoot.kiddyapp.net/` | `200` |
| `/login` headers | `server: cloudflare`, `x-opennext: 1`, `permissions-policy: geolocation=(self)` |
| Staging Worker | untouched at `9e081270` |

### Vercel production alias (`https://kiddy-one.vercel.app`)

Same route table as above: marketing and `/login` `200`; app and child routes
`307 -> /login`; `/api/notifications/open?id=test` `307 -> /login`.

## Rollback

Worker:

```sh
npx wrangler rollback --env="" --version-id ec5adb96-bf64-4230-9275-514fdc1bf900
```

That returns to the KID-2525 cut. Vercel: promote
`dpl_B7GqjBS84EuskKfbxERZNeSgVF63` (the KID-2524 build) back to the production
aliases. No database rollback is needed; both migrations are additive and the
older builds ignore the new columns.

## Notes

- KID-2485 had no separate production cut record; its commits shipped inside
  the KID-2482 cut and its migration was applied by the KID-2519 batch. This
  record closes that documentation gap.
- KID-2479 is not included. Its PR is unmerged and the item is not implemented.
