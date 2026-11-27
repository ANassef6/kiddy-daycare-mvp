# KID-2524 — production cut: KID-2481 / 2484 / 2494 / 2496

Status: **shipped to production on 2026-11-27.**

## Approval

| Item | Value |
| --- | --- |
| Founder direction | KID-215 comment `ca4f4c02-c331-4a40-8e89-e5d86b27492c`, 2026-11-27T16:39Z: "Just move them right away. Let's make sure that the production is up to date." |
| Scoped task | KID-2524 |
| Staging-first rule | All four items were already implemented on `staging`; KID-2494 was re-verified on staging in this run before inclusion. |

## What shipped

`master` and `staging` have diverged, so this followed the per-item cherry-pick
method used by KID-2487, KID-2511 and KID-2519 — not a staging fast-forward.

| # | Item | Commits | Migration |
| --- | --- | --- | --- |
| 1 | KID-2481 room photos (upload/remove) and child photo removal | `889e7e0` | `0061_kid2481_room_photo.sql` (renumbered from `0055`) |
| 2 | KID-2484 working hours: Expected vs Actual + date filter + export | `a6fcfd8`, `e90bde8`, `30b69e7` | `0063_kid2484_staff_schedule_index.sql` (renumbered from `0056`) |
| 3 | KID-2494 consents: classroom targeting + per-recipient tracking | `368527a`, `5fb326d`, `227bed5`, `6433af8`, `5c63e39` | `0059_kid2494_consent_response_tracking.sql` |
| 4 | KID-2496 center-local timestamps on every surface | `c586a3c` | none |

The migration files were renumbered to the next free versions on `master`
(`0059`, `0061`, `0063`); their bodies are unchanged and guarded.

## KID-2494 staging verification (inclusion gate)

Verified live on `https://kiddy-web-staging.trois4ever.workers.dev` with the
seeded owner (`founder.owner@staging.kiddy.test`) and a real classroom send:

| Check | Result |
| --- | --- |
| Composer offers All/general + classroom checkboxes, no child picker | Pass — panel read `All / general`, `Classrooms`, `Little Stars`, `Sunflowers`; zero child selectors |
| Owner can target rooms | Pass — owner checked both classrooms; the send succeeded and the request appeared in the list |
| Detail lists every targeted child grouped by room with response state and responder | Pass — group headings `Little Stars` and `Sunflowers`; columns `Child / Parent / Response / Answered by`; rows for Omar and Layla |
| Responder tracking | Pass — after the parent approved Layla, the owner's view showed `Approved`, the Cairo timestamp `27 Nov 2026, 19:23` and responder `Mona Founder`; Omar stayed `Pending` |

Screenshots: `staging-consents-composer.png`,
`staging-consent-detail-owner.png`, `staging-consent-detail-after-parent.png`.

The Postgres list-crash fix (`5c63e39`) is included; no page errors were raised
on either the list or the detail page.

## Cut

| Item | Value |
| --- | --- |
| Pull request | #177 `KID-2524: cut KID-2481/2484/2494/2496 to production` |
| Merge commit | `add1271` (tree `502f8a26e436c8103cf69e1aaf23ee741dd68652`) |
| CI | Test + build + wrangler dry-run pass (3m01s); dependency audit pass (1m00s) |
| Build | `npx opennextjs-cloudflare build` exit 0 on the merged tree |
| Deploy | `npx wrangler deploy --env="" --message KID-2524-production-cut-master-add1271` |
| Deployed Worker version | `7e1b4b8c-d858-4593-bf80-1e8d7b21bdbf` (2026-11-27T17:29:43Z) |
| Rollback target (defined before deploy) | `a305add2-1e42-45e3-9137-3f121c34e43a` (KID-2519 hotfix) |

### Build inputs

The same public values as the live Worker:

- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` — the existing public website-inbox token (read from the live layout chunk; not recorded here)
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`
- `KIDDY_CSP_MODE=report-only`

## Database migrations (production Postgres `sfetmfmtoubtdyyeyudd`)

Applied in one transaction through the Supabase Management API at
`2026-11-27T17:28:05.913066Z`; all three filenames were recorded in
`public.schema_migrations`.

| Check | Before | After |
| --- | --- | --- |
| `room.photo_url` | absent | present, `text`, nullable |
| `consent_request.batch_id / responded_at / responded_by_account_id` | absent | present; `responded_at` is `timestamptz`, the account column references `account(id)` |
| `staff_schedule` index `idx_staff_schedule_staff_day` | absent | present |
| `consent_request` rows | 4 (2 general, 1 distinct child) | 4 (unchanged); `batch_id` backfilled, 0 NULL |
| `room` rows | 6 | 6 (unchanged) |
| `staff_schedule` rows | 0 | 0 (unchanged) |

## Vercel production deployment

| Item | Value |
| --- | --- |
| Deployment | `dpl_B7GqjBS84EuskKfbxERZNeSgVF63` |
| URL | `https://kiddy-39jqc9gq3-kiddy2.vercel.app` |
| State | `READY`, production target (2026-11-27T17:30:49Z) |
| Aliases | `kiddyapp.net`, `*.kiddyapp.net`, `kiddy-one.vercel.app`, tenant hosts |
| `https://kiddy-one.vercel.app/login` | `200` |
| Vercel client chunk contains KID-2484 `hoursSingleDay` | yes |

## Live production checks (anonymous)

| Check | Result |
| --- | --- |
| `/`, `/login` | `200` |
| `/portal/rooms`, `/portal/rooms/:id`, `/portal/staff/hours`, `/portal/staff/schedule`, `/portal/consents`, `/portal/consents/:id`, `/portal/attendance`, `/portal/newsfeed`, `/portal/dashboard`, `/child` | `307 -> /login` (route exists, auth gate intact) |
| `/login` headers | `server: cloudflare`, `x-opennext: 1`, `permissions-policy: geolocation=(self)` |
| Served layout chunk | `layout-2409afc7b78f0362.js` (new build) |
| Chatwoot | `https://chatwoot.kiddyapp.net/` `200` |
| Staging | untouched — Worker `kiddy-web-staging` still version `3bdc458a-64df-4aac-bac8-e81588b0506e` (2026-11-27T06:31Z) |

### Deployed Worker script contains the cut

Fetched `GET /accounts/…/workers/scripts/kiddy-web` and checked the strings the
four items introduce:

| Check | Result |
| --- | --- |
| `room_photo_url` (KID-2481) | present (6) |
| `Remove photo` (KID-2481) | present (12) |
| `hoursSingleDay`, `hoursSourceNote`, `expectedHours`, `actualHours` (KID-2484) | present (14 each) |
| `idx_staff_schedule_staff_day` (KID-2484 migration) | present (4) |
| `recipientRoomIds`, `consents.recipients`, `consents.respondedByColumn` (KID-2494) | present (16 / 2 / 2) |
| `responded_by_account_id` (KID-2494) | present (20) |
| `formatZonedValue`, `fmtDateTimeFor` (KID-2496) | present (21 / 76) |
| Prior release still present: `31457280` (30 MB), `geolocation=(self)` | present (8 / 4) |

## Production authenticated checks — limitation

Production owner/admin credentials are not available in this workspace, so no
signed-in write was made against a real production tenant. This is the same
production-evidence method recorded for KID-2487, KID-2511 and KID-2519:

- the four item paths were verified on staging with a real owner session (and,
  for KID-2494, a real parent response) in this run or the item tasks;
- the production database now has every column/index those paths read or write;
- the production Worker script contains the item code and the anonymous routes
  exist behind the auth gate.

## Rollback

The rollback target defined before the deploy was Worker version
`a305add2-1e42-45e3-9137-3f121c34e43a` (KID-2519 hotfix). To roll back:

```sh
npx wrangler rollback --name kiddy-web
```

The migrations are additive/idempotent and can stay; the older build ignores the
new columns. The Vercel alias serves the same tree, so redeploy the previous
Vercel deployment `dpl_13q1rr33nWShxim61xcBbpXW4E3B` (KID-2519) if the Vercel
path must match the rollback.
