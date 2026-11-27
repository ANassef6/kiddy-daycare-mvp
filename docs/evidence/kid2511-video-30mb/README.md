# KID-2511 — Video upload cap raised to 30 MB (5 minutes)

Status: **code and evidence on staging; production approval refreshed. No
production cut yet.**

Founder direction: KID-215 comment `5fcb5a79` (2026-11-27T06:21Z): "increase the
max video upload size to 30mb". This revises KID-2509's 15 MB cap before the
pending production cut. `MAX_VIDEO_DURATION_SECONDS` stays at 300 seconds.

## What changed

- `MAX_VIDEO_UPLOAD_BYTES = 30 * 1024 * 1024` in `lib/media-limits.ts`; the
  5-minute duration cap is unchanged.
- EN copy now says "up to 5 minutes, up to 30 MB" in the newsfeed and event
  composer help text and refusal messages.
- AR copy now says "حتى 5 دقائق، وحتى 30 ميجابايت" in the same places.
- Boundary tests pin the 30 MB constant and cover 30 MB accepted / 30 MB + 1
  refused on the presign path, the client path, and the HEAD-verified REF path.
- Photos on the same purposes keep their old ceilings: newsfeed 2.5 MB, event
  4 MB. Messages stay at the old 60-second limit.

No caller hardcodes the size: `lib/media-limits.ts` remains the single source of
truth for the client and the server.

## Deploy

| Item | Value |
| --- | --- |
| Branch | `staging` |
| Commit | `449c6f0` |
| Worker | `kiddy-web-staging` |
| URL | https://staging.kiddyapp.net |
| Worker version | `3bdc458a-64df-4aac-bac8-e81588b0506e` |
| Login page | `200` |

## Local checks

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit/kid2509-direct-video-upload.test.ts tests/unit/kid2450-media-compression.test.ts` | 22 passed |
| `npx tsc --noEmit` | clean |
| `npx next lint` | 0 errors; pre-existing `<img>` warnings only |
| `npx opennextjs-cloudflare build` + `wrangler deploy --env staging` | green |

## Live staging checks (authenticated owner session)

The browser contract was exercised with the same endpoints and headers the
client uses: sign in through `/api/mobile/login`, call `/api/media/presign`,
PUT the bytes to the returned URL (including the signed `Cache-Control`
header), and submit the REF to the real server action.

| Check | Result |
| --- | --- |
| Newsfeed composer hint (SSR, EN) | "Photos are compressed automatically. Videos: up to 5 minutes, up to 30 MB." |
| Newsfeed composer hint (SSR, AR) | "تُضغط الصور تلقائيًا. الفيديو: حتى 5 دقائق، وحتى 30 ميجابايت." |
| Server-rendered composer limits | `maxVideoBytes=31457280`, `maxVideoSeconds=300` |
| Presign video exactly 30 MB (newsfeed) | `200`, `maxBytes=31457280` |
| Presign video 30 MB + 1 (newsfeed) | `422 size`, message "File is larger than 31457280 bytes." |
| Presign event video exactly 30 MB | `200` |
| Presign event video 30 MB + 1 | `422 size` |
| Presign newsfeed photo 2.5 MB + 1 | `422 size` |
| Presign event photo 4 MB + 1 | `422 size` |
| Direct R2 PUT of a 20 MB `video/mp4` | `200` |
| Newsfeed action with the verified 20 MB REF | `303 /portal/newsfeed`; post visible |
| Playback URL | signed R2 URL on `…r2.cloudflarestorage.com/kiddy-media-staging/newsfeed/…`; raw `r2-private:` refs in HTML: `0` |

The 20 MB upload is above the previous 15 MB cap, so this run proves the raised
cap is live on the deployed Worker, not just in the source. The AR account
language was restored to EN after the copy check.

## Known tension

At phone quality, 5 minutes of 720p footage is usually far above 30 MB, so the
byte cap still limits most clips to a few minutes. The founder chose both
limits; `MAX_VIDEO_UPLOAD_BYTES` is a single constant and can be raised again
without re-architecture.
