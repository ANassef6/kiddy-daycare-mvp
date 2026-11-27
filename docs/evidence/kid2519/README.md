# KID-2519 — November 2026 batch production release

Status: **shipped to production on 2026-11-27.** Founder approval:
confirmation `a329ae2f` accepted on KID-2517 at 2026-11-27T12:27Z. See
[`prod-cut.md`](prod-cut.md) for the cut, migration, Worker/Vercel and live
check record.

## Nine items

| # | Item | Task |
| --- | --- | --- |
| 1 | Clearer children status filters | KID-2498 |
| 2 | Green checked-in dot on child photos | KID-2505 |
| 3 | Staff check-in/out notifications for owners and admins | KID-2502 |
| 4 | Staff schedule tools restricted to admins | KID-2502 |
| 5 | Geofenced check-in/out (150/300/600 m, admin override) | KID-2503 |
| 6 | Check-in/check-out accuracy fixes | KID-2504 |
| 7 | 30 MB / 5 minute video uploads on newsfeed and events | KID-2509 + KID-2511 |
| 8 | Support help articles for upload limits (EN/AR) | KID-2512 |
| 9 | Database migration clean-up | KID-2506 |

## Cut

| Item | Value |
| --- | --- |
| Batch PR / merge commit | #173 / `0967ab7` |
| Hotfix PR / merge commit | #175 / `ba32208` (geolocation policy) |
| Cloudflare Worker | `kiddy-web` version `a305add2-1e42-45e3-9137-3f121c34e43a` |
| Worker deploy message | `KID-2519-geolocation-policy-master-ba32208` |
| Vercel production | `dpl_13q1rr33nWShxim61xcBbpXW4E3B` (`kiddy-one.vercel.app` alias) |
| Migrations | `0060_kid2503_premises_geofence.sql`, `0062_kid2483_staff_schedule_date_rooms.sql` |
| Rollback Worker version | `b6edf96a-bdfe-4b58-9f38-1dd69c86d958` |
