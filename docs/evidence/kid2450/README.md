# KID-2450 — client-side media compression before upload (photos + video caps)

Staging-first change approved by the founder in KID-215 (comment `caf253ee`).
The browser now prepares photos before any byte leaves the phone, and both the
browser and the server enforce the same caps.

## Exact new limits (for the founder’s test)

| Surface | Photos | Video | Other files |
| --- | --- | --- | --- |
| Child photo, staff photo, account photo | Compressed to ≤1280px longest edge, WebP ~80% (JPEG fallback), ≤400 KB target; hard server cap 4 MB | — | rejected |
| Daycare logo / brand image (Settings + create daycare) | Same compression (SVG/GIF pass through unchanged); 4 MB cap | — | rejected |
| Newsfeed attachment | Compressed; 2.5 MB cap | ≤60 s and ≤2.5 MB | PDF only |
| Parent drive | Compressed; 4 MB cap | ≤60 s and ≤4 MB | any type ≤4 MB |
| Messages composer attachment | Compressed; 1.5 MB cap | ≤60 s and ≤1.5 MB | any type ≤1.5 MB |

Why video is 4 MB and not 50 MB: these attachments travel through a Next.js
server action, and Vercel rejects request bodies over 4.5 MB. A 50 MB ceiling
would fail as a server error, which is exactly what this task asks us to avoid.
4 MB is still well under Supabase’s 50 MB per-file free-tier cap. Video is **not
transcoded** — no heavy mobile pipeline is added; the client refuses over-long
or over-size clips with a localized message before upload.

## What changed

- `lib/media-limits.ts` — the single source of truth for every cap and for the
  pure resize/validation helpers used by both halves.
- `components/MediaUploadForm.tsx` — one client form wrapper used by every
  affected upload surface. On submit it:
  - resizes images to a 1280px longest edge and re-encodes to WebP ~80%
    (JPEG fallback), stepping quality down toward 400 KB;
  - applies EXIF orientation before drawing (`createImageBitmap` with
    `imageOrientation: "from-image"`, `<img>` fallback), and the canvas
    re-encode strips all EXIF — including children’s geolocation;
  - reads video duration from the chosen file and refuses >60 s or over-cap
    files with an EN/AR message;
  - keeps the original when compression would make the file larger, and blocks
    submission while a file is still being prepared.
- Wired into: child photo, staff photo, account photo, settings logo/brand,
  platform create-daycare logo, newsfeed composer, parent drive, messages
  composer.
- Server mirror in `lib/actions.ts`: photo/branding type + 4 MB; newsfeed/drive/
  messages byte caps; MP4/MOV duration via `lib/video-duration.ts`; explicit
  localized error banners on the child/staff/account/settings/newsfeed/drive
  pages. Old clients cannot bypass the caps.
- EN + AR strings under `media.*`, plus `profile.photoError`,
  `account.photoError`, `settings.uploadTypeError/uploadSizeError`,
  `newsfeed.errorAttachment`, `drive.errorAttachment`, and updated
  `messages.errorAttachment`.

Not changed on purpose: payment proofs and signed contracts are documents with
their own 5/10 MB validators; they are not photo-media paths. The observation
modal’s attachment input is not persisted by the server action, so it is not an
upload path today.

## Before / after (same samples)

`comparison.json` is the raw output; `comparison.html` shows the pairs.

| Sample | Before | After | Saved |
| --- | --- | --- | --- |
| phone-landscape | 2,278,144 B · 4032×3024 JPEG | 23,232 B · 1280×960 WebP | 99.0% |
| phone-portrait | 2,131,078 B · 3024×4032 JPEG | 25,996 B · 960×1280 WebP | 98.8% |
| small-already-ok | 213,781 B · 1200×900 JPEG | 99,082 B · 1200×900 WebP | 53.7% |

The samples are synthetic photo-like 12 MP renders (gradient + shapes + fine
grain) compressed with exactly the client algorithm. Real camera JPEGs land in
the same order of magnitude; the staging pass should confirm sharpness on an
actual phone photo.

## Video sample / behaviour

No transcoder runs. A 12 s MP4 sample attachment is accepted and stored; a 90 s
MP4 is refused **client-side** before submission, and the same MP4/MOV header is
rejected server-side if an old client posts it. Non-ISO containers (e.g. some
WebM files) fall back to the byte-size cap because their duration is not
readable without a demuxer; this is recorded rather than hidden.

## Verification run

```
npx tsc --noEmit                          # clean
npm run lint                              # 0 errors (pre-existing <img> warnings only)
npx vitest run tests/unit/kid2450-media-compression.test.ts \
  tests/unit/kid182-messages-audience-attachment.test.ts \
  tests/unit/kid221-arabic-consistency.test.tsx \
  tests/unit/kid489-branding.test.tsx \
  tests/unit/kid472-composer.test.tsx \
  tests/unit/kid246-account-billing.test.tsx
# 6 files / 77 tests passed
```

## Founder test script (staging)

1. Sign in as the staging owner (`founder.owner@staging.kiddy.test`).
2. Open a child profile → **Change photo** → choose a normal phone photo. Save,
   then confirm the avatar is upright and sharp.
3. Open **Newsfeed** → post with a photo. Confirm the post renders and the
   attachment is not blurry at phone width.
4. Open **Parent drive** → upload a photo (check the shown size) and a short
   (<60 s) video. Then try a >60 s or >4 MB video: the form must show the
   localized refusal and keep the page.
5. Switch the app language to Arabic and repeat the video refusal: the message
   must be Arabic.
6. Old-client mirror: not testable from the UI; covered by the action tests.
