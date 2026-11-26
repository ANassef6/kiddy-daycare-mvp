# KID-2482 — recipients picker: classroom checklist on first open

Date: 2026-11-26. Author: Cody.

## Problem

Founder review on staging (KID-215 comment `82bf5c14`): the newsfeed picker
showed **Everyone (whole center)**, the child search and the children, but no
classroom section. The classroom checkboxes only rendered after a channel had
been selected, so they were invisible on first open. The dropdown also ended in
the middle of the child list.

## Change

- The **Classrooms** section now renders as soon as the picker opens, above the
  child search and the child list, with a heading and a one-line hint.
- Admin: every room (same set as before). Teacher/caregiver: assigned rooms only
  (KID-2480 rules).
- The single admin bulk channel **Everyone (whole center)** is unchanged; there
  is no `All classrooms` duplicate.
- Staff get a staff-specific hint so they are not pointed at the admin-only
  Everyone channel.
- A teacher checking all their assigned rooms stays on the `rooms` channel. The
  old code switched to `center`, which the server rejects.
- EN + AR copy for the new labels.

Code: [#151](https://github.com/ANassef6/kiddy-daycare-mvp/pull/151) and
[#152](https://github.com/ANassef6/kiddy-daycare-mvp/pull/152), merged to
`staging`.

## Live staging verification

Host: `https://staging.kiddyapp.net` (canonical Cloudflare staging host).
Deployed from staging head `7fb1b26` as Worker version
`b0e44fd1-a3da-4f60-90d7-c98770c8d541`. Later merges (KID-2494, KID-2496) were
deployed by their owners; the served picker chunk still contains both new hint
strings.

| Role / surface | Result | Screenshot |
| --- | --- | --- |
| Admin, newsfeed | **Classrooms** heading + hint; **Little Stars** and **Sunflowers** above `Search children…` and the child list | [`admin-newsfeed-en.png`](admin-newsfeed-en.png) |
| Admin, newsfeed, Arabic | RTL shell; `الفصول` + Arabic hint; same rooms above `ابحث في الأطفال…` | [`admin-newsfeed-ar.png`](admin-newsfeed-ar.png) |
| Admin, activities | Same picker: **Everyone (whole center)** + **Classrooms** (both rooms) above the child search | [`admin-activities-en.png`](admin-activities-en.png) |
| Teacher, newsfeed | **My classrooms** only; **Classrooms** shows only **Sunflowers**; only **Layla Founder**; staff hint; no **Everyone** | [`teacher-newsfeed-en.png`](teacher-newsfeed-en.png) |

The picker opened with no channel selected in every screenshot above, which is
the state the founder reported as "no rooms".

## Staging URLs

`staging.kiddyapp.net` is the canonical host (KID-2495).
`kiddy-web-staging.trois4ever.workers.dev` remains a fallback, and
`kiddy-staging-orcin.vercel.app` is frozen/legacy with Vercel auto-deploys
disabled (KID-2491). Do not use the Vercel host for review.

## Checks

- `npx tsc --noEmit` clean.
- KID-2482 picker suite: 10/10 (includes rooms-before-children, teacher
  assigned-room scoping, and the teacher/center channel guard).
- KID-733 + KID-221 + i18n-page-coverage: 41/41.
- `npx next lint` has no errors (pre-existing `<img>` warnings only).
- Live screenshots captured with a real browser through the Skyvern REST API.
