# KID-2487 — newsfeed likers + tagging children on post photos

## What changed

- The like count is a tappable disclosure on the staff newsfeed, the parent
  newsfeed and the parent child page. Opening it lists each liker's avatar,
  name and role (EN + AR).
- Staff photo viewer on `/portal/newsfeed`: opening a post image opens a
  lightbox with a searchable child checklist. Tag/untag multiple children and
  save.
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
| Final staging commit | `d87562a` |
| Public staging | https://kiddy-staging-orcin.vercel.app |
| Production cut | not performed; gated on founder sign-off |

## Staging deployment status

The staging branch contains the final code, but Vercel refused both post-merge
deployments:

```
Vercel – kiddy-staging  failure
Deployment rate limited — retry in 24 hours.
```

The public staging alias is therefore still serving the earlier successful
staging deployment `63c20ab`. Live EN/AR likers verification was captured on
that deployment (the likers UI is unchanged by the later REF-classification
fix). The final tag-viewer code was verified locally against the merged tree;
the same tree passed the Cloudflare verify job (`tsc`, OpenNext build, wrangler
dry-run) on PR #140.

## Automated checks

- `npx tsc --noEmit`
- `npx vitest run tests/unit/kid2487-newsfeed-likes-tags.test.ts` — 10 passed
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
- R2, legacy private-ref, video and data-URI photo classification.

## Live staging browser evidence

Accounts: `founder.owner@staging.kiddy.test` (owner). Captured with Playwright
Chromium headless at 1440×1000, on staging deployment `63c20ab`.

| Locale | Surface | Result | File |
| --- | --- | --- | --- |
| EN / LTR | `/portal/newsfeed` like count | summary "1 likes" opens, shows "Founder Test Owner · Owner" | `staging-en-likers.png` |
| AR / RTL | `/portal/newsfeed` like count | summary "1 إعجاب" opens, shows "Founder Test Owner · المالك"; `lang=ar dir=rtl` | `staging-ar-likers.png` |

Raw capture data: `staging-browser-results.json`.

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

Raw capture data: `local-browser-results.json`.

## Gates

Production cut is **not** performed. It stays gated on founder sign-off on
staging. The only pending item is the Vercel staging re-deploy after the
rate-limit window; the code is already on the `staging` branch (`d87562a`).
