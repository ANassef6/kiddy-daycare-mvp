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
- **Pending human gate:** VAPID/Webhook secrets are proposed as Paperclip
  secrets + env bindings (`kiddy/vapid-public-key` → `env.VAPID_PUBLIC_KEY`,
  `kiddy/vapid-private-key` → `env.VAPID_PRIVATE_KEY`,
  `kiddy/chatwoot-webhook-secret` → `env.CHATWOOT_WEBHOOK_SECRET`); the
  confirm-binding cards live on this issue. Until a human approves them, sets
  the three vars on the Vercel project (`kiddy`) and registers the Chatwoot
  webhook per `docs/PUSH_NOTIFICATIONS.md`, production pushes stay in the
  graceful-degrade mode by design.

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

Serial chain (rerun suite): push-send evidence on a real Android device +
Chatwoot webhook round-trip are blocked on exactly one human gate —
**approve the three Paperclip secret-binding cards on this issue** (KID-480),
set the resulting `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
`CHATWOOT_WEBHOOK_SECRET` on the Vercel project `kiddy`, and register the
Chatwoot webhook per `docs/PUSH_NOTIFICATIONS.md`. Everything else ships and
degrades cleanly without them.

## Commit

- Branch `kid472-push-sound`, implementation commit `669725d` (amend history:
  `28b8f79` build-verified tree before docs were appended).
- Evidence: this branch recording PR #23 merge + production deployment.
