# KID-2487 — newsfeed likers + tagging children on post photos and videos

## What changed

- The like count is a tappable disclosure on the staff newsfeed, the parent
  newsfeed and the parent child page. Opening it lists each liker's avatar,
  name and role (EN + AR).
- Staff media viewer on `/portal/newsfeed`: opening a post photo or video opens
  a lightbox with a searchable child checklist. Tag/untag multiple children and
  save. Photos render as images and videos as playable video.
- Tagging writes one `media` row per child that points at the post's existing
  `media_url`/REF. One physical object, multiple child links. Untagging deletes
  only that link; the post photo is untouched.
- A server-side audience guard refuses a child when any parent account linked
  to that child is outside the post's tagged audience, so a tagged photo can
  never reach an audience smaller than the child's own parents.
- Staff permission mirrors KID-2480: owners/admins manage any visible post;
  teachers/caregivers manage only posts and children in their assigned rooms.
  Another classroom's existing tag is preserved when a scoped teacher saves.
- The parent child page (`/child/<id>`) now renders the child's media section,
  so the tagged photo is visible to the child's parents. Videos render as
  video, not as a broken image.

## Data

`supabase/migrations/0058_kid2487_media_post_link.sql`:

- `media.post_id TEXT REFERENCES newsfeed_post(id) ON DELETE CASCADE`
- `idx_media_post (post_id)`
- `idx_media_child (institute_id, child_id)`

`lib/sqlite-schema.ts` mirrors the column, backfill ALTER and both indexes for
existing local databases.

## Branches / PRs

| Item | Value |
| --- | --- |
| Integration branch | `staging` |
| PR #134 | likers, viewer/tagger, media links, audience + room guards, EN/AR |
| PR #137 | classify a post photo from its stored REF (staging follow-up) |
| PR #140 | `mediaRefName` helper + R2/legacy/data-URI classification pins |
| PR #144 | photo + video media viewer, video media-section rendering, `media-src` CSP |
| KID-2487 merge | `9bddb92` (PR #144) |
| Public staging | https://staging.kiddyapp.net (Cloudflare Worker `kiddy-web-staging`) |
| Deployed Worker version | `eca45c3c-847d-4b2e-a465-be62c4e9236e` (source `origin/staging` @ `94e4ee2`, 2026-11-26 17:09 UTC) |
| Production cut | not performed; gated on founder sign-off |

## Staging deployment status

The earlier blocker is resolved. Vercel staging
(`kiddy-staging-orcin.vercel.app`) is now frozen/legacy (KID-2491) and must not
be used for review. Staging moved to the Cloudflare Worker
`kiddy-web-staging` behind https://staging.kiddyapp.net (KID-2495).

The Worker version `eca45c3c` was deployed from `origin/staging` @ `94e4ee2`,
which contains the KID-2487 application code (merged at `9bddb92`). The current
`staging` head (`c04f8c7`) differs only by evidence documents (PRs #161–#163),
so the deployed application code is the reviewed tree.

## Automated checks

- `npx tsc --noEmit`
- `npx vitest run tests/unit/kid2487-newsfeed-likes-tags.test.ts` — 11 passed
  (re-run on 2026-11-26 against the staging tree)
- `npx vitest run tests/unit/kid2487-newsfeed-likes-tags.test.ts tests/unit/i18n-page-coverage.test.ts tests/unit/kid472-newsfeed-batching.test.ts tests/unit/kid2481-room-child-photo.test.ts tests/unit/mobile-child-idor.test.ts tests/unit/kid472-parent-notifications.test.ts` — all passed
- `node supabase/verify-migrations.mjs` — all migration checks passed
- `next lint` — only the pre-existing `<img>` warnings
- GitHub `Cloudflare Workers verify` and `dependency-audit` passed on PR #134,
  PR #137 and PR #140

The new suite covers:

- likers in `listNewsfeed` / `newsfeedForChild` with name + role;
- EN/AR rendering of the liker disclosure;
- same-object tagging with no duplicated file;
- untag removes one child link and keeps the post photo;
- audience refusal when a child's parent is outside the audience;
- center-wide posts allow tagging;
- KID-2480 room scope for viewing and tagging;
- another classroom's tag is preserved on save;
- R2, legacy private-ref, video and data-URI classification;
- a tagged video keeps `kind=video` and the same stored object per child.

## Live staging browser evidence

Accounts: `founder.owner@staging.kiddy.test` (owner) and
`founder.parent@staging.kiddy.test` (parent). Captured with Playwright Chromium
headless at 1440×1000 on https://staging.kiddyapp.net, Worker version
`eca45c3c`, on 2026-11-26.

The test post was created through the real staff composer. A 6-second WebM
video (`960×540`) and a PNG photo were uploaded; the photo was tagged to Layla
and Omar, the video to Layla.

| Locale | Surface | Result | File |
| --- | --- | --- | --- |
| EN / LTR | `/portal/newsfeed` likers | summary "1 likes" opens, shows "Founder Test Owner · Owner" | `staging-en-likers.png` |
| AR / RTL | `/portal/newsfeed` likers | summary "1 إعجاب" opens, shows "Founder Test Owner · المالك"; `lang=ar dir=rtl` | `staging-ar-likers.png` |
| EN / LTR | Photo viewer + tag panel | "Tag children", searchable list, Layla and Omar checked, "Save tags", "2 selected" | `staging-en-photo-viewer.png` |
| EN / LTR | After saving photo tags | `?tagged=1` and "Photo tags saved."; reopening pre-checks both children | `staging-en-photo-tags-saved.png` |
| AR / RTL | Photo viewer + tag panel | `aria-label="عارض الصور"`, "إضافة أطفال إلى الصورة", both children pre-checked | `staging-ar-photo-viewer.png` |
| EN / LTR | Video viewer + tag panel | `aria-label="Video viewer"`; playable `<video>` at 0:02 / 0:06, 960×540; Layla checked, "1 selected" | `staging-en-video-viewer.png` |
| EN / LTR | After saving video tags | `?tagged=1` and "Photo tags saved."; reopening pre-checks Layla | `staging-en-video-tags-saved.png` |
| AR / RTL | Video viewer + tag panel | `aria-label="عارض الفيديو"`, "إضافة أطفال إلى الصورة", Layla pre-checked | `staging-ar-video-viewer.png` |
| EN / LTR | Parent `/child/<Layla>` media | "Media (3)": tagged photo (`a12ba79a…webp`, 240×160 loaded), tagged video (`a55bbb9b…webm`, readyState 4, 960×540), one seeded image | `staging-parent-media-en.png` |
| EN / LTR | Parent `/child/<Omar>` media | "Media (1)": the same `a12ba79a…webp` URL as Layla — one stored object, two child links, no duplicated file | `staging-parent-media-omar-en.png` |
| AR / RTL | Parent child media | "الوسائط (3)", `dir=rtl`, same tagged photo and video | `staging-parent-media-ar.png` |
| EN / LTR | Parent `/child/newsfeed` likers | posts show "1 likes" and expand to "Founder Test Owner · Owner" | `staging-parent-newsfeed-likers.png` |

Raw capture data: `staging-browser-results-2026-11-26.json`.

### Live-guard limitation

The staging seed links the **same parent account** to both children. A
Layla-only post therefore already includes Omar's parent, so the live
audience-refusal path cannot be triggered with these fixtures. The refusal is
pinned by the unit test ("audience refusal when a child's parent is outside the
audience") and by the `newsfeedTagAudienceAllowsChild` server check; it was not
demonstrated by a live staging action.

### Storage note

The staging Worker has no R2 credentials, so new uploads use Supabase private
storage (`kiddy-private:` REFs) and their signed URLs render correctly. The
2026-11-25 photo test post on staging carried an `r2-private:` REF written by
the frozen Vercel build; the Workers deployment cannot sign that REF and no
Supabase fallback object exists, so the stale tags were removed during this run
and replaced by the fresh 2026-11-26 photo post.

## Local browser evidence (final merged code)

Local Next dev server against the isolated SQLite demo fixture, Playwright
Chromium headless at 1440×1000. Owner `trois4ever+admin@gmail.com`, parent
`parent@example.test`. The post was created through the real composer with an
image attachment; the storage fallback used a data URI because R2 is
unconfigured locally.

| Locale | Surface | Result | File |
| --- | --- | --- | --- |
| EN / LTR | `/portal/newsfeed` likers | "1 likes" opens with "Nassef · Owner" | `en-likers.png` |
| EN / LTR | Photo lightbox + tag panel | "Tag children", search, Ella/Leo checkboxes, Save tags | `en-photo-viewer.png` |
| EN / LTR | After Save tags | `?tagged=1` and "Photo tags saved." banner | `en-tags-saved.png` |
| EN / LTR | Re-open lightbox | tagged child is pre-checked | `local-browser-results.json` (`tag-prechecked: true`) |
| AR / RTL | `/portal/newsfeed` likers | "1 إعجاب", "Nassef · المالك"; `lang=ar dir=rtl` | `ar-likers.png` |
| AR / RTL | Photo lightbox + tag panel | "إضافة أطفال إلى الصورة" and Arabic fields | `ar-photo-viewer.png` |
| EN / LTR | Parent child page media | "Media (2)" includes the tagged photo (1 image + 1 seeded video) and the post in the child newsfeed with its likers | `parent-media-en.png` |
| EN / LTR | Video lightbox + tag panel | "Open video" mounts a playable `<video controls>` and the same tag panel; Save tags redirects with `?tagged=1` and the tag is pre-checked on reopen | `en-video-viewer.png` |
| AR / RTL | Video lightbox + tag panel | `aria-label="عارض الفيديو"`, "إضافة أطفال إلى الصورة" | `ar-video-viewer.png` |
| EN / LTR | Parent child page media (video) | tagged video and seeded video render as `<video>`; "Media (4)" includes the tagged video (3 videos + 1 image) | `parent-media-video.png` |

Raw capture data: `local-browser-results.json` (photo flow) and
`video-browser-results.json` (video flow).

## Gates

Production cut is **not** performed. The code is live on
https://staging.kiddyapp.net and verified in EN + AR; the remaining gate is the
founder's sign-off on staging.
