# KID-480: Web push notifications + notification sound (PWA/TWA)

Parent-facing web push for the Next.js PWA and the Android TWA, plus an
in-app notification sound — including pushes for Chatwoot support messages.
Everything is best-effort: an unsupported browser or a missing push setup
never breaks messaging or the notification center.

## How it works

1. **Permission + subscribe** — on `/child/settings` the parent uses the
   *Push notifications* card (`components/PushNotificationsCard.tsx`):
   browser permission prompt → `PushManager.subscribe` against the public
   VAPID key from `GET /api/push/public-key` → `POST /api/push/subscribe`
   stores the subscription.
2. **Storage** — `push_subscription` (migration `0032`, mirrored in the
   SQLite dev schema). `endpoint` is UNIQUE, so re-subscribing re-points the
   same device; deleting an account cascades.
3. **Emission** — every KID-474 in-app notification (`emitNotifications`,
   `lib/store.ts`) fans out a web push for the *freshly inserted* rows only.
   Per-activity opt-out stays in `notification_pref` (`channel = 'push'`;
   missing row defaults to enabled — granting browser permission is the
   consent, the settings table can still turn an activity off).
4. **Sound** — `public/sw.js` shows notifications (Android plays the default
   notification sound for background pushes); while the app is open,
   `components/NotificationSoundWatcher.tsx` polls `/api/notifications/unread`
   and plays the bundled `public/notification-sound.wav` once per new unread
   (toggle: *Play a sound for in-app notifications* in settings — stored in
   `localStorage["kiddy:notificationSound"]`).
5. **Test button** — *Send test notification* calls `POST /api/push/test`,
   which runs the exact production path (locale copy → subscription storage →
   VAPID send).

## Events that push

| Event | Activity (notification_pref) | Deep link |
|---|---|---|
| New message | `messages` | `/child/messages[?thread=<id>]` |
| Daily report | `daily_report` | `/child/<childId>` |
| Announcement (newsfeed post) | `newsfeed` | `/child/newsfeed` |
| Chatwoot agent reply | `messages` | `/child/support` |

Pushes reuse the KID-474 locale pipeline: the raw, locale-unaware payload is
rendered per account language at send time (`notificationViewCopy` +
`feedCopyFor`), so an Arabic parent gets Arabic titles.

## Environment / secrets (never commit values)

| Env var | Meaning |
|---|---|
| `VAPID_PUBLIC_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public VAPID key served to browsers |
| `VAPID_PRIVATE_KEY` | private VAPID key used to sign push requests |
| `VAPID_SUBJECT` | optional `mailto:` contact for push services (defaults to a mailto) |
| `CHATWOOT_WEBHOOK_SECRET` | shared secret the Chatwoot webhook presents |

The VAPID key pair must exist per deployment. Generate once:

```sh
npx web-push generate-vapid-keys
```

Store the values as Paperclip company secrets (never in the repo) and bind
them as env secrets so Vercel receives `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `CHATWOOT_WEBHOOK_SECRET`. If they are missing the
app degrades gracefully: `GET /api/push/public-key` returns `""`, the
settings card shows "push is not set up yet", and emissions skip pushes with
a logged warning — messages/reports/announcements keep working.

## Chatwoot webhook setup

1. In Chatwoot → Settings → Integrations → Webhooks → **Add webhook**.
2. URL: `https://<your-domain>/api/chatwoot/webhook?token=<CHATWOOT_WEBHOOK_SECRET>`
   (the secret may equivalently be sent as header `X-Chatwoot-Webhook-Secret`
   or `Authorization: Bearer <secret>`; the `?token=` query is the easiest
   to configure inside Chatwoot).
3. Subscribe only to the **`message_created`** event.
4. Verify (`curl` example, replace `<secret>`):

```sh
curl -s -X POST "https://<your-domain>/api/chatwoot/webhook?token=<secret>" \
  -H "Content-Type: application/json" \
  -d '{"event":"message_created","id":501,"message_type":1,
       "content":"Your request is confirmed.",
       "sender":{"type":"agent"},
       "contact":{"identifier":"<kiddy-account-id>","name":"Pat"},
       "conversation":{"id":77}}'
```

- `sender.type === "contact"` (the parent's own message) or
  `message_type === 0` is ignored — only agent replies notify.
- The contact is mapped by `identifier` (= Kiddy account id, the same id
  `lib/chatwoot-contacts.ts` upserts) then by email. Unmapped contacts return
  a clean `200 {handled:false, reason:"contact-not-mapped"}`.
- Notification dedupe ref: `chatwoot-<conversation_id>-<message_id>` —
  Chatwoot retries never duplicate.

## Unsupported devices / opt-out

- No `PushManager`/`Notification`/service worker → the card shows the
  unsupported hint; nothing is fetched, nothing breaks.
- Permission denied → hint + no server call.
- Web push on iOS: supported from iOS 16.4 for installed PWA/TWA contexts
  only; earlier/iOS Safari in-tab still gets in-app notifications + sound.
- Opt-out: turn the activity's *Push* column off (settings), or *Turn off*
  in the push card (browser unsubscribe + server row delete).

## Local dev notes

- The dev server serves `public/sw.js` at origin scope `/` over `localhost`
  (allowed) — Chrome treats `localhost` as secure for push.
- Without VAPID keys set, use the settings card to confirm the graceful
  degrade (it should show the "not configured" hint, not an error).
