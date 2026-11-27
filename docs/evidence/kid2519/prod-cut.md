# KID-2519 — production cut: November 2026 batch

Status: **shipped to production on 2026-11-27.** The batch cut at 13:03Z was
followed by a geolocation-policy hotfix (PR #175) at 13:17Z, because the
production `Permissions-Policy` still denied device geolocation. Production is
the Cloudflare Worker `kiddy-web` behind `kiddyapp.net`; the Vercel `kiddy`
production deployment (which owns `kiddy-one.vercel.app`) was refreshed from the
same tree. The founder approved the release on KID-2517 at 2026-11-27T12:27Z
(confirmation `a329ae2f`).

## What shipped

| # | Item | Commit / source |
| --- | --- | --- |
| 1 | Clearer children status filters | `85806b0` (KID-2498) |
| 2 | Green checked-in dot on child photos | `6ed3f97` (KID-2505) |
| 3 | Owner/admin staff check-in/out notifications | `e7abcd9` (KID-2502) |
| 4 | Staff schedule + working-hours tools admin-only | `e7abcd9` (KID-2502) |
| 5 | Geofenced check-in/out (150/300/600 m, admin override) | `513283a` (KID-2503), migration `0060` |
| 6 | Check-in/out accuracy fixes | `7a031c8` (KID-2504) |
| 7 | 30 MB / 5 minute video uploads | already live from KID-2511 (`118717d`) |
| 8 | Help articles for upload limits (EN/AR) | KID-2512, Chatwoot help centre (published) |
| 9 | Database migration clean-up | `21a0f26` (KID-2506) |

Per-item cherry-picks from `staging`; staging is not a strict superset of
`master`, so this followed the same method as KID-2487 and KID-2511. The 30 MB
cap was already cut in #171. KID-2481, KID-2484, KID-2494 and KID-2496 were not
included.

One adaptation in the cut tree: the staff attendance notification payload now
carries the centre IANA `timeZone`, and `FeedCopy.dateTimeIn` renders it, so the
approved "local time" copy is correct without pulling the wider staged
timestamp sweep into this release (`lib/i18n.ts`, `lib/store.ts`).

## Cut

| Item | Value |
| --- | --- |
| Batch PR | #173 `KID-2519: deploy the November 2026 batch to production` |
| Batch merge commit | `0967ab7` (tree `791c1786fc0a32985bdf7dae8abc86c20243491c`) |
| Hotfix PR / merge commit | #175 / `ba32208` (tree `58b936575190971947f3215f00e3e32fa334d66f`) |
| Merge method | merge commits into `master` |
| CI | batch: verify pass 2m26s, audit pass 51s; hotfix: verify pass 2m22s, audit pass 1m19s |
| Build | `npx opennextjs-cloudflare build` exit 0 |
| Deploy | `npx wrangler deploy --env="" --message KID-2519-geolocation-policy-master-ba32208` |
| Deployed version | `a305add2-1e42-45e3-9137-3f121c34e43a` (2026-11-27T13:16:55Z) |
| Rollback target | `b6edf96a-bdfe-4b58-9f38-1dd69c86d958` (KID-2511 build) |
| Deployed script | 38,416,769 bytes, sha256 `f52be3f0f1528e9a8c59f874c6a071f42928e8aec4bbd12598da1e8b160ecf40` |

### Geolocation policy hotfix

The batch cut kept `Permissions-Policy: geolocation=()`, which makes
`navigator.geolocation.getCurrentPosition()` fail with `PERMISSION_DENIED`.
KID-2503 had verified the server gate with mobile-API coordinates, but its
browser leg only ever showed the blocked-location guidance, so the staff and
parent geofence controls could not capture a position as shipped.

PR #175 changed the header to `geolocation=(self)` (camera, microphone and the
other capabilities stay denied) and updated the KID-1178 header test. The live
header on `https://kiddyapp.net/login` now reads:

```
permissions-policy: camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()
```

Staging was not touched and keeps its frozen worker.

### Build inputs

The same public values as the live Worker:

- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` — the existing public website-inbox token
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`
- `KIDDY_CSP_MODE=report-only`

After the build: the Chatwoot token is in the root layout chunk, the production
Supabase URL is in the client chunks, and `localhost:3000` appears in zero
client chunks.

## Database migrations (live Postgres `sfetmfmtoubtdyyeyudd`)

Applied in one transaction through the Supabase Management API at
`2026-11-27T12:52:37Z`; both file names were recorded in
`public.schema_migrations`:

| File | Result |
| --- | --- |
| `0060_kid2503_premises_geofence.sql` | `institute.premises_lat/premises_lng/geofence_radius_m` present; `staff_status` and `check_in` `lat/lng/accuracy_m/geofence_override` present |
| `0062_kid2483_staff_schedule_date_rooms.sql` | renamed from `0056_kid2483...`; body unchanged and guarded; `staff_schedule_room` table present; no rows changed |

Verified after apply:

| Check | Result |
| --- | --- |
| `institute.geofence_radius_m` | `integer NOT NULL DEFAULT 150` |
| `check_in.lat/lng/accuracy_m` | `double precision`, nullable |
| `staff_status.lat/lng/accuracy_m` | `double precision`, nullable |
| `check_in.geofence_override`, `staff_status.geofence_override` | `smallint NOT NULL DEFAULT 0` |
| `public.schema_migrations` rows | both files present |
| `staff_schedule_room` | table exists; 0 rows (no data deleted) |

## Live production checks (anonymous)

| Check | Result |
| --- | --- |
| `/`, `/login`, `/features`, `/contact` | `200` |
| `/?lang=ar` | `200` |
| `/portal/children`, `/portal/attendance`, `/portal/staff/schedule`, `/portal/staff/hours`, `/portal/newsfeed`, `/child`, `/platform` | `307 → /login` (route exists, auth gate intact) |
| Host headers | `server: cloudflare`, `x-opennext: 1` |
| CSP | `content-security-policy-report-only`, Chatwoot allowed |
| Served layout chunk | `layout-af4503acb2fdd802.js` (batch build; unchanged by the hotfix) |

### Deployed script contains the batch

Fetched `GET /accounts/…/workers/scripts/kiddy-web` and checked strings:

| Check | Result |
| --- | --- |
| `premises_lat` / `geofence_radius_m` / `geofence_override` | present (30 / 26 / 46) |
| `staff_checkin` / `staff_checkout` | present (24 / 20) |
| `31457280` (30 MB) | present (8) |
| `geolocation=(self)` | present (4) |
| old `geolocation=()` | absent (0) |
| EN `Not withdrawn` / `Everyone` | present (6 / 110) |
| `avatar-checked-dot` | present (2) |
| EN `Staff check-in:` / `Staff check-out:` | present (6 / 6) |
| AR `غير المنسحبين` / `الجميع` | present (3 / 30, unicode-escaped) |
| AR `تسجيل حضور` / `حاضر` | present (15 / 18, unicode-escaped) |
| AR `حتى 30 ميجابايت` | present (6, unicode-escaped) |

## Vercel production (rollback project)

Deployed the same merged tree to the `kiddy` Vercel project so
`kiddy-one.vercel.app` serves the batch as well.

| Item | Value |
| --- | --- |
| Deployment | `dpl_13q1rr33nWShxim61xcBbpXW4E3B` |
| URL | `https://kiddy-msii9o9he-kiddy2.vercel.app` |
| State | `READY`, production target, `aliasAssigned: true` |
| Ready at | `2026-11-27T13:19:51Z` |
| Aliases | `kiddyapp.net`, `*.kiddyapp.net`, `kiddy-one.vercel.app`, the tenant hosts |
| `https://kiddy-one.vercel.app/login` | `200` |
| Vercel CSS contains `avatar-checked-dot` | yes |
| Vercel root layout contains the Chatwoot token | yes |
| `https://kiddy-one.vercel.app/login` `permissions-policy` | `geolocation=(self)` |

Cloudflare still serves every `kiddyapp.net` host (the Vercel deployment is
behind the Worker routes). Because the Vercel alias now points at the same
batch, a regression rollback must use the Worker version
`b6edf96a-bdfe-4b58-9f38-1dd69c86d958`, not a Vercel alias rollback.

## Support help articles (no deploy dependency)

| Article | Status |
| --- | --- |
| EN [Check upload limits and supported file formats](https://chatwoot.kiddyapp.net/hc/help-center/articles/1795760702-check-upload-limits-and-supported-file-formats) | `200`, contains "30 MB" (2) |
| AR [معرفة حدود الرفع وصيغ الملفات المدعومة](https://chatwoot.kiddyapp.net/hc/help-center/articles/1795760707-check-upload-limits-and-supported-file-formats) | `200`, contains "30 ميجابايت" (2), `lang="ar"` |

## Authenticated production checks — limitation

Production owner/admin credentials are not available in this workspace, so no
signed-in write was made against a real production tenant. The same code paths
were verified on staging with a real authenticated owner session in the item
tasks (KID-2502, KID-2503, KID-2504, KID-2505), the production database now has
every column/table those paths read/write, and the deployed Worker script
contains the batch code. This is the same production-evidence method recorded
for the earlier cuts (KID-2487, KID-2511).

## Rollback

```sh
npx wrangler rollback --name kiddy-web
```

Returns the Worker to `b6edf96a-bdfe-4b58-9f38-1dd69c86d958` (KID-2511). The
migrations are additive/idempotent and can stay; the older build ignores the
new columns. The Vercel alias currently serves the batch, so it is not a
previous-batch rollback target.
