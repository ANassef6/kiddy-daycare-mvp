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
| Owner, newsfeed | **Everyone (whole center)** + **Classrooms** (both rooms) above the child search; the owner can pick one room | [`owner-newsfeed-en.png`](owner-newsfeed-en.png) |
| Teacher, newsfeed | **My classrooms** only; **Classrooms** shows only **Sunflowers**; only **Layla Founder**; staff hint; no **Everyone** | [`teacher-newsfeed-en.png`](teacher-newsfeed-en.png) |

The picker opened with no channel selected in every screenshot above, which is
the state the founder reported as "no rooms".

## Owner role (founder directive)

The founder asked that "even the owner should have the option to select specific
room". The owner login is already admin-equivalent in this path: the picker
(`role === "owner" || role === "admin"`), the server audience resolver
(`resolveRecipientAudience`), `canTargetWholeCenter`, `scopedRoomIds`, and the
shared `isAdminRole` helper all treat `owner` as an admin. There was no
owner-specific branch hiding rooms.

The missing-rooms report came from the pre-#151 build, where the classroom
checklist only rendered after a channel was picked. This page was captured on
`https://staging.kiddyapp.net/portal/newsfeed` on 2026-11-26 with the owner
fixture (`founder.owner@staging.kiddy.test`) through a real browser (Skyvern run
`tsk_601407050296683980`), with no channel selected:

- **Everyone (whole center)** radio
- **Classrooms** heading + hint, with **Little Stars** and **Sunflowers**
- **Search children…** input
- **Layla Founder (Sunflowers)** and **Omar Founder (Little Stars)**

The classroom checkboxes are above the child search and list. The
`KID-2482 owner has the admin audience` regression tests pin the owner render,
the owner Everyone audience, and the owner single-room audience.

## Events, Parent drive, Homework and Supplies (sign-off follow-up)

The founder rejected the first staging sign-off: "On events, parent drive and
homework, still no classrooms. On supplies, no recipient list at all." All four
composers now use the same classroom-aware picker as newsfeed/activities
([#157](https://github.com/ANassef6/kiddy-daycare-mvp/pull/157)).

Live verification on `https://staging.kiddyapp.net` as the owner fixture
(`founder.owner@staging.kiddy.test`) through a real browser, dropdown opened, no
form submitted:

| Surface | Result | Screenshot |
| --- | --- | --- |
| Events, add form | **Recipients** replaces the old single "Class (optional)" select; **Everyone (whole center)** + **Classrooms** (Little Stars, Sunflowers) + `Search children…` | [`owner-events-en.png`](owner-events-en.png) |
| Parent drive, share form | **Share with** uses the picker; **Everyone (whole center)** + **Classrooms** (both rooms) + child search | [`owner-drive-en.png`](owner-drive-en.png) |
| Homework, assign form | **Recipients** uses the picker; **Everyone (whole center)** + **Classrooms** (both rooms) + child search | [`owner-homework-en.png`](owner-homework-en.png) |
| Supplies, request form | New **Recipients** list; **Everyone (whole center)** + **Classrooms** (both rooms) + child search | [`owner-supplies-en.png`](owner-supplies-en.png) |

Server behaviour for the same four surfaces:

- The submitted audience resolves through the shared
  `resolveRecipientAudience` (owner = admin scope, staff = assigned rooms,
  forged/out-of-scope picks dropped).
- **Homeworks** and **drive files** write one row per child for a classroom
  pick; **Everyone** keeps the single all-children/centre-wide row.
- **Events** writes one event per picked classroom (or one centre-wide event),
  so KID-2480 classroom visibility stays scoped.
- **Supplies** tags the request newsfeed post to the picked audience; no pick
  keeps the old centre-wide broadcast.

## Staging URLs

`staging.kiddyapp.net` is the canonical host (KID-2495).
`kiddy-web-staging.trois4ever.workers.dev` remains a fallback, and
`kiddy-staging-orcin.vercel.app` is frozen/legacy with Vercel auto-deploys
disabled (KID-2491). Do not use the Vercel host for review.

## Checks

- `npx tsc --noEmit` clean.
- KID-2482 picker suite: 13/13 (includes rooms-before-children, teacher
  assigned-room scoping, the teacher/center channel guard, and the owner
  Everyone + single-room audience).
- KID-2482 surface actions: 5/5 (homework/drive one row per classroom child,
  centre-wide homework row, supplies newsfeed audience, event classroom).
- KID-2480 event page/actions: 39/39.
- KID-733 + KID-221 + i18n-page-coverage: 41/41.
- `npx next lint` has no errors (pre-existing `<img>` warnings only).
- Live screenshots captured with a real browser through the Skyvern REST API.
