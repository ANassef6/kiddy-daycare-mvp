# KID-2466 — real photo/video attachments on events

Status: **staging verified and shipped to production** — see `prod-cut.md`.

## Change

The old per-event control accepted a pasted URL and an image/video select. It
is replaced by the shared **MediaUploadForm** and the KID-2453 presigned R2
pipeline:

- a new `event` upload purpose accepts photos and videos only (no PDFs),
  capped at **4 MB** with the existing **60-second** video limit;
- the multipart fallback mirrors the same type/size/duration checks server-side;
- `takeUploadedRef` HEAD-verifies the tenant prefix, byte size and MIME before a
  direct-upload REF can reach a `media` row;
- the action refuses an event that does not belong to the caller's tenant;
- each event card now has a visible **Add media / Close** control (previously
  the form was reachable only by hand-building `?open=<eventId>`);
- staff and parent event pages sign stored REFs with `signedUrlsForRefs`, and
  videos render as `<video controls>` instead of being forced into `<img>`;
- the parent video shelf is signed too;
- EN + AR copy, RTL-safe row-start error border.

## Unit / static pins

`tests/unit/kid2466-events-attachments.test.ts` — **12/12 passed**:

- the `event` purpose accepts JPEG/PNG/WebP/HEIC/MP4/MOV/WebM, refuses PDFs and
  files over 4 MB, and scopes keys to `events/<institute>/…`;
- a REF minted for another purpose is refused;
- the action stores a valid photo and a valid short video;
- oversized photo, PDF, over-long video, forged REF and missing/foreign event
  each redirect to `error=eventMedia` and write **zero** rows;
- both pages call `signedUrlsForRefs`, never emit `src={m.url}` /
  `src={v.url}`, and the staff page exposes a real Add media link.

Gates on this branch: `tsc --noEmit` clean; `next lint` 0 errors (only the
pre-existing `no-img-element` warnings); `next build` green with a
`SESSION_SECRET` set; related KID-221 / KID-368 / KID-2450 / KID-2453 suites
**54/54** green.

## Staging verification

| Item | Value |
| --- | --- |
| URL | https://kiddy-staging-orcin.vercel.app |
| Branch | `staging` (PR #106 + follow-up PR #108; deployment of `c2220ef`) |
| Vercel deployment | `dpl_DZ8WuwZmiX6xrfRcjvKSi3euBVS6` (Production, alias `kiddy-staging-orcin.vercel.app`) |
| Browser | Chromium 131 headless shell, 1366×900 |
| Owner | `founder.owner@staging.kiddy.test` |
| Parent | `founder.parent@staging.kiddy.test` |

### Staff flow

1. `/portal/events` → created an event (date 2026-12-15).
2. The card shows **Add media**; clicking it opens a file input
   (`accept="image/*,video/*"`, 4 MB / 60 s copy).
3. Uploaded a photo: **POST `/api/media/presign` → signed PUT → signed GET
   200**, thumbnail rendered.
4. Uploaded a video (WebM): signed GET **206**, `<video controls>` rendered and
   reported `readyState=4`, `error=null`.
5. Card shows **2 media**; page HTML contained **0** occurrences of
   `r2-private:`.

Screenshots: `staging-staff-events.png` (empty card + Add media),
`staging-staff-photo-video.png` (photo + video after uploads).

### Parent flow

1. Logged in as the parent and opened `/child/events`.
2. The same event card rendered the photo (`<img>`) and the video
   (`<video controls>`) from signed R2 URLs.
3. Parent HTML contained **0** occurrences of `r2-private:`.

Screenshots: `staging-parent-events.png` (EN, LTR) and
`staging-parent-events-ar.png` (AR, RTL).

### Arabic / RTL

The owner account was switched with the real `/switch-app-lang` POST:

| Check | Result |
| --- | --- |
| `/portal/events` `<html lang dir>` | `ar` / `rtl` |
| Event action labels | `إضافة وسائط` / `إغلاق` |
| Upload form labels | `المرفق (من جهازك)` + the 4 MB / 60 s limit line |
| Parent `/child/events` | `ar` / `rtl`, `الفعاليات` |

Screenshots: `staging-staff-events-ar.png`, `staging-staff-upload-ar.png`.

## Production

The founder accepted the confirmation card `a71b939d-afe7-439e-951e-347d0d875801`
on 2026-11-24T00:04:42Z. The change was cherry-picked onto `master` and shipped
as PR #112 / merge `32a65f4` in Worker version `6cad1a8a-57e2-4366-8428-d6921748c091`.
The cut record, build inputs, live probes and rollback are in `prod-cut.md` and
`prod-verify.json`.
