# KID-2509 — Direct-to-R2 video uploads (15 MB / 5 minutes)

Status: **code complete on staging; staging behaviour verified. Founder
sign-off pending.**

Founder approval: KID-215 comment `538b5ff3` (2026-11-26T20:43Z) chose the
direct-to-storage option and asked for a 5-minute duration limit.

## What shipped

- `MAX_VIDEO_UPLOAD_BYTES = 15 MB` and `MAX_VIDEO_DURATION_SECONDS = 300` in
  `lib/media-limits.ts` (one source of truth for client and server).
- Newsfeed and event purposes accept 15 MB **videos** on the direct-to-R2 path
  while photos keep their previous ceilings (newsfeed 2.5 MB, event 4 MB).
- The browser PUTs the file straight to R2 with `XMLHttpRequest` upload
  progress; the server action records the private REF only after a HEAD check.
- A submitted REF that fails verification now refuses the post instead of
  publishing without its attachment.
- Messages stay at the old 60-second limit through
  `MAX_MESSAGE_VIDEO_DURATION_SECONDS`; drive, payment proofs, photos and
  profile media are unchanged.
- EN/AR copy now says “up to 5 minutes, up to 15 MB”.

## Deploy

| Item | Value |
| --- | --- |
| Branch | `staging` |
| Commit | `acc63b3` |
| Worker | `kiddy-web-staging` |
| URL | https://staging.kiddyapp.net |
| Code version | `0b78fee6-d5c3-4895-b538-3afae67fda12` |
| Current version (secret update) | `09d65915-5ae6-4544-9fd2-0d9c7a4a13ae` |
| Login page | `200` |

One-time staging infrastructure fix: the Cloudflare staging Worker had no
`R2_*` secrets (the KID-2453 values lived on the frozen Vercel project), so
`/api/media/presign` answered `503`. The four existing values
(`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) were
copied from the frozen Vercel staging project to the Worker as secrets. Bucket:
`kiddy-media-staging`. No credential values are recorded here.

## Local checks

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit/kid2509-direct-video-upload.test.ts` | 9 passed |
| `npx vitest run` KID-2450 / KID-2453 / KID-2466 suites | 51 passed |
| `npx tsc --noEmit` | clean (nested `kid2482-*-wt` worktrees excluded from the check) |
| `npx next lint` | 0 errors; pre-existing `<img>` warnings only |
| `npx opennextjs-cloudflare build` + `wrangler deploy --env staging` | green |

## Live staging checks (authenticated owner session)

The browser path was exercised with the same endpoints and headers the client
uses: sign in through `/api/mobile/login` to obtain the `kiddy_sess` token,
then call `/api/media/presign`, PUT the bytes to the returned URL, and submit
the REF to the real server action.

| Check | Result |
| --- | --- |
| Newsfeed composer hint (SSR) | “Photos are compressed automatically. Videos: up to 5 minutes, up to 15 MB.” |
| Presign 3.5 MB `video/webm` | `200`, `maxBytes=15728640`, `expiresIn=900` |
| Direct R2 PUT of the same 3.5 MB file | `200` |
| `createNewsfeedWithAttachmentAction` with the REF | `303 /portal/newsfeed`; post visible |
| Playback URL | signed R2 URL on `…r2.cloudflarestorage.com/kiddy-media-staging/newsfeed/…`; raw `r2-private:` refs in HTML: `0` |
| Presign video exactly 15 MB | `200` |
| Presign video 15 MB + 1 | `422 size` |
| Presign newsfeed photo 2.5 MB + 1 | `422 size` |
| Presign event video 15 MB | `200` |
| Presign event video 15 MB + 1 | `422 size` |
| Presign event photo 4 MB + 1 | `422 size` |
| 400-second MP4 submitted to the newsfeed action | `303 ?error=attachment`; no post written |
| Overlong-marker post after the refusal | absent |

The 3.5 MB upload is above the previous 2.5 MB newsfeed ceiling, so this run
also proves the raised video cap on the deployed Worker.

## Browser automation note

Skyvern run `tsk_601489496488897234` completed a visual pass on
`staging.kiddyapp.net` (5 steps, screenshots recorded server-side). Skyvern
could not perform the file upload itself: its task file store is a
`file:///data/artifacts/...` path its browser worker cannot read, and external
file hosts failed to download. The byte-for-byte upload was therefore driven
through the same presigned PUT contract the browser uses, and the rendered
result was checked in the SSR HTML.

## Known tension (unchanged from KID-215)

At phone quality, 5 minutes of 720p footage is typically far above 15 MB, so
the 15 MB cap effectively limits usable duration to roughly 1–2 minutes. Both
numbers were chosen by the founder; `MAX_VIDEO_UPLOAD_BYTES` is a single
constant and can be raised later without re-architecture.
