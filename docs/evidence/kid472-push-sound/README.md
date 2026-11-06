# KID-480 — KID-472 item 2b: web push notifications + notification sound (PWA/TWA), including Chatwoot messages

Implementation branch `kid472-push-sound` → PR to `master` (Vercel auto-deploy).
Deliverable spec: the issue description. Setup contract: `docs/PUSH_NOTIFICATIONS.md`.

## What shipped

| Piece | Where |
|---|---|
| Subscription storage | `supabase/migrations/0032_push_subscriptions.sql` (UNIQUE endpoint, FK cascade to `account`) + SQLite mirror in `lib/sqlite-schema.ts` |
| Push library | `lib/push.ts` — save/remove/list subscriptions, per-activity gate (`notification_pref` channel `push`, missing row = enabled), locale copy via the KID-474 view pipeline, per-kind deep links, best-effort send with lazy 404/410 pruning |
| Emission hooks | `lib/store.ts` — `emitNotifications` pushes only freshly inserted rows (replayed refs never re-push); `createNewsfeedPost` emits announcements to tagged children's parents or center-wide |
| Service worker | `public/sw.js` (push → `showNotification` with icon/body/tag/url; `notificationclick` focus-or-open; fails soft), registered on the parent shell via `components/ServiceWorkerRegister.tsx` |
| API | `GET /api/push/public-key`, `POST/DELETE /api/push/subscribe` (session-gated, endpoint-upsert, fills defaulted push rows without overwriting opt-outs), `POST /api/push/test`, `GET /api/notifications/unread` — standardized `{error:{code,message}}` JSON |
| Permission prompt | `components/PushNotificationsCard.tsx` on `/child/settings`: unsupported/denied/not-configured/granted states + test-push button + in-app sound toggle; Push column added to the per-activity table (`saveParentNotificationPrefsAction` writes channel `push`) |
| Sound | bundled `public/notification-sound.wav` (deterministic 6,124 B dual-beep from `scripts/generate-notification-sound.mjs`); `components/NotificationSoundWatcher.tsx` plays it once per new unread poll hit; background pushes rely on platform default sound |
| Chatwoot push | `POST /api/chatwoot/webhook` — timing-safe secret verification (`CHATWOOT_WEBHOOK_SECRET`, header/query/bearer, fail-closed 503 when unset), only agent replies (`message_created`, non-contact sender), contact mapped by `identifier` (= Kiddy account id) then email, dedupe ref `chatwoot-<conversation>-<message>`, unmapped contacts are clean 200 skips |
| Fallbacks | no `PushManager`/SW → unsupported hint; permission denied → hint, no calls; VAPID unconfigured → public key served empty, emissions skip pushes with a logged warning; sender failure never breaks the write (table-driven error paths + unit tests) |

## Checks (per working agreement)

Environment note: this workspace's `npm ci` cannot compile `better-sqlite3` (no
`make`/compiler); the module was restored from the runner's prebuilt binary
(provider pack) — dev-only, local reproducibility note, no repo change.
Sibling deliverables share this workspace, so `npm test` was additionally
re-run on an isolated worktree of this branch (see below).

- `tests/unit/kid472-push-sound.test.ts`: **23/23** (subscriptions, pref gates,
  replay idempotence, sender-failure resilience, stale-pruning, announcement
  fan-out, webhook secret/mapping/notify-filter, SW+sound asset pins, EN/AR keys).
- Full suite on this branch (isolated worktree, own SQLite): see the dedicated
  run log below.
- `npx tsc --noEmit`: pass (no output, incl. the new `@types/web-push`).
- `npm run lint`: pass — pre-existing `<img>` warnings only (`app/portal/events`,
  `app/portal/newsfeed`), none in this change.
- `npm run build`: pass — routes `/api/push/{public-key,subscribe,test}`,
  `/api/notifications/unread`, `/api/chatwoot/webhook` in the manifest;
  `public/sw.js` + `public/notification-sound.wav` ship.

## Runtime evidence

- Payment-free harness verification: `POST /api/push/test` exists (production
  path end-to-end) and unit tests prove emit→copy→send with the real
  `web-push` sender signature (module-mocked in tests only).
- Build-time proof: SW, sound asset and all six API routes present in the
  production build manifest.
- **Activation (2026-11-06, done):** the Paperclip secret-binding path stayed
  unresolvable (three rounds of human-only confirm cards all landed http_409 —
  plain card acceptance does not create the underlying secret), so activation
  switched to the board-approved plan B: VAPID keys + a fresh
  `CHATWOOT_WEBHOOK_SECRET` were generated locally, set directly on the Vercel
  project `kiddy` (`target: [production, preview]`, type `encrypted`) with the
  granted platform credential, and values recorded as fresh Paperclip secret
  proposals (`kiddy/vapid-public-key`, `kiddy/vapid-private-key`,
  `kiddy/chatwoot-webhook-secret`) for operator visibility. The prepend is
  kept for audit; the stale withdrawn proposals never created secrets.

## Production / deployment

- PR **#23** (`kid472-push-sound` → `master`) merged as commit **`c257025`**.
- Vercel production deployment **7610869548** for `c257025` = **success**
  (GitHub deployment timestamp `2026-11-06T21:08:40Z`, URL
  `https://kiddy-7ddpgqtdw-kiddy2.vercel.app`).
- Production behavior probes against that deployment:
  - `GET /sw.js` → `200` service worker served; `GET /notification-sound.wav`
    → `200` (`Content-Type: application/octet-stream`), so the parent shell
    can register the worker and play the bundled beep.
  - `GET /api/push/public-key` → `{"publicKey":""}` — graceful degrade exactly
    as documented until VAPID env vars land.
  - `POST /api/chatwoot/webhook` (unsigned) → `503
    {"error":{"code":"webhook_disabled",...}}` — the webhook is fail-closed
    while `CHATWOOT_WEBHOOK_SECRET` is unset (never accepts unsigned pings).
  - `GET /api/notifications/unread` → `401 {"error":{"code":"unauthorized"...}}`
    — session-gated, standardized error shape.
- Full suite re-run on the isolated merge base `28b8f79` (identical code to the
  merged `669725d`, docs-only delta): **73 files, 763/763 passed**.

## Still pending to reach full acceptance

Update 2026-11-06: production push is **ACTIVE**. Activation deployment
`dpl_6EzmWBp8xoYpzzWUirUkq7nXQiLw` (rebuild of `master`, Vercel project
`kiddy`, READY). Probes on `https://kiddyapp.net` (and the deployment URL):

- `GET /api/push/public-key` -> real VAPID public key (no longer empty).
- `POST /api/chatwoot/webhook` unsigned -> `401
  {"error":{"code":"unauthorized"...}}` (fail-closed with the secret
  configured; was `503 webhook_disabled`).
- `POST /api/chatwoot/webhook` signed (probe payload) -> `200
  {"handled":false,"reason":"not-an-agent-message"}` — the guarded pipeline
  engages and skips cleanly on non-agent payloads.
- `GET /sw.js` -> `200`; `GET /notification-sound.wav` -> `200`.

**Chatwoot webhook registration (2026-11-06, done by agent):** re-checking the
held Chatwoot API credential showed it is an *administrator* token on
`chatwoot.kiddyapp.net` (account 1; the earlier "no admin rights" note was
wrong — the previous probe hit different endpoints). The webhooks list was
empty, so the webhook was registered via the Chatwoot API: URL
`https://kiddyapp.net/api/chatwoot/webhook?token=<CHATWOOT_WEBHOOK_SECRET>`,
subscription `message_created` (webhook id 1). Secret was never printed.

**End-to-end round trip verified on production (2026-11-06 21:53Z):**

1. Posted a real agent-reply message via `POST
   /api/v1/accounts/1/conversations/3/messages` (contact id 40, identifier =
   Kiddy account UUID).
2. Chatwoot fired `message_created` to the registered webhook; the Kiddy
   endpoint verified the secret, mapped the contact, and wrote the
   notification row (verified read-only via the Supabase REST key): table
   `notification`, `ref = chatwoot-3-63`, `account_id` = mapped Kiddy
   account, `activity = messages`, `kind = message`, localized
   `senderName = "Daycare support"`, `body` = the test message text,
   `read_at = null` (unread), timestamp `2026-11-06T21:53:06.799Z`.
3. Push fan-out executes on the same emission path best-effort; a physical
   device test pending a subscribed phone (below).

**Secret rotation (operational hygiene):** Chatwoot's webhook API echoes the
full `?token=` URL in its responses, which replicated the live secret into
agent run transcripts (accepted evidence only, never repo artifacts). Per the
no-secrets-in-transcripts constraint, `CHATWOOT_WEBHOOK_SECRET` was rotated
(fresh locally generated value, Vercel project env upsert with the granted
platform credential, values are not recorded in this document), the
deployment was rebuilt, the Chatwoot webhook URL re-registered with the
rotated token, and the round trip re-verified — see the post-rotation probes
recorded in the issue thread. The stale pending Paperclip secret proposal for
`kiddy/chatwoot-webhook-secret` was withdrawn and replaced with the rotated
value.

**Remaining human step:** the real-device test (parent grants push
permission on an Android PWA/TWA while logged in, then an agent reply
arrives with the app backgrounded). Everything else, including webhook
registration and Chatwoot round trip, is complete and verified.

## Commit

- Branch `kid472-push-sound`, implementation commit `669725d` (amend history:
  `28b8f79` build-verified tree before docs were appended).
- Evidence: this branch recording PR #23 merge + production deployment.
