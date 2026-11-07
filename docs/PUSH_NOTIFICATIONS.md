# KID-480 / KID-487: Web push notifications + notification sound

Web push for the Next.js PWA and the Android TWA, plus an in-app notification
sound — including pushes for Chatwoot support messages. KID-480 wired the
parent surface; KID-487 made push the general rule for every notification
type and extended it to the staff portal. Everything is best-effort: an
unsupported browser or a missing push setup never breaks messaging or the
notification center.

## How it works

1. **Permission + subscribe** — on `/child/settings` (parents) and
   `/portal/account` (staff: owner/admin/teacher/caregiver, KID-487) the
   *Push notifications* card (`components/PushNotificationsCard.tsx`) runs:
   browser permission prompt → `PushManager.subscribe` against the public
   VAPID key from `GET /api/push/public-key` → `POST /api/push/subscribe`
   stores the subscription. Subscribing seeds explicit enabled 'push' pref
   rows for the caller's surface (parent activities / the full portal
   activity list for staff) without overwriting prior opt-outs.
2. **Storage** — `push_subscription` (migration `0032`, mirrored in the
   SQLite dev schema). `endpoint` is UNIQUE across accounts, so re-subscribing
   re-points the same device; deleting an account cascades.
3. **Emission** — every KID-474 in-app notification (`emitNotifications`,
   `lib/store.ts`) fans out a web push for the *freshly inserted* rows only.
   Per-activity opt-out stays in `notification_pref` (`channel = 'push'`;
   missing row defaults to enabled — granting browser permission is the
   consent, the settings table can still turn an activity off). The
   `inapp` channel row suppresses the durable row itself, so it suppresses
   the push too. Staff receive rows through the same choke point; the KID-221
   derived staff feed is unchanged.
4. **Sound** — `public/sw.js` shows notifications with `silent: false`
   (Android plays the default status-bar notification sound for background
   pushes; the system sound decision belongs to the OS); while the app is
   open, `components/NotificationSoundWatcher.tsx` (mounted on both the
   parent shell and the portal layout, KID-487) polls
   `/api/notifications/unread` and plays the bundled
   `public/notification-sound.wav` once per new unread (toggle: *Play a sound
   for in-app notifications* in settings — stored in
   `localStorage["kiddy:notificationSound"]`).
5. **Test button** — *Send test notification* calls `POST /api/push/test`,
   which runs the exact production path (locale copy → subscription storage →
   VAPID send).
6. **Deep links follow the receiving account** — the same event URL-resolves
   to the parent shell (`/child/...`) or the staff portal (`/portal/...`)
   from the account role (`pushDeepUrl(kind, payload, role)`, `lib/push.ts`);
   notification clicks open or focus that page.

## Events that push

| Event | Activity (notification_pref) | Staff deep link | Parent deep link |
|---|---|---|---|
| New message | `messages` | `/portal/messages[?thread=<id>]` | `/child/messages[?thread=<id>]` |
| Daily report | `daily_report` | `/portal/children/<childId>` | `/child/<childId>` |
| Announcement (newsfeed post) | `newsfeed` | `/portal/newsfeed` | `/child/newsfeed` |
| Planned pickup set/changed (KID-486, kind `pickup_time`) | `attendance` | `/portal/children/<childId>` | `/child/<childId>` |
| Check-in / check-out recorded or auto-checkout (kind `attendance`) | `attendance` | `/portal/attendance` | `/child/<childId>` |
| Incident report | `incidents` | `/portal/incidents` | `/child/incidents` |
| New event | `events` | `/portal/calendar` | `/child/events` |
| Homework | `homework` | `/portal/learning/homework` | — (parent surface has no homework audience) |
| Supply request | `supplies` | `/portal/supplies` | — (parent surface has no supplies audience) |
| Chatwoot agent reply | `messages` | `/portal/support` | `/child/support` |

Audiences: messages go to thread/thread-message recipients; daily reports to
the family plus the assigned classroom staff (minus the author);
announcements to the tagged children's families + their rooms' staff or
center-wide; planned-pickup changes to the assigned classroom staff;
check-in/out to the assigned staff plus the family, excluding the acting
account; incidents to the child's room staff plus family; events to every
parent of the daycare; homework to the room staff (child-less homework →
center-wide staff); supply requests to center-wide staff.

Billing note (audit outcome): the parent app has no billing surface
(`child_payment`/child charges are staff/portal views only, and the center
`daycare_invoice` ledger is platform-facing), so no parent billing emission
exists to push — the `billing` activity remains reserved for staff
preferences and the owner's derived feed.

Pushes reuse the KID-474 locale pipeline: the raw, locale-unaware payload is
rendered per account language at send time (`notificationViewCopy` +
`feedCopyFor`), so an Arabic recipient gets Arabic titles on both surfaces.

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
  (added to the Home Screen) only; earlier/iOS Safari in-tab still gets
  in-app notifications + sound. iOS does not honor custom browser-registered
  sounds — the system notification sound is what plays.
- Android (PWA/TWA): background pushes land as status-bar notifications with
  the system notification sound (`silent: false` pinned in `sw.js` where the
  platform honors it). No custom sound file ships for web push.
- Opt-out: turn the activity's *Push* column off (settings), or *Turn off*
  in the push card (browser unsubscribe + server row delete).

## Local dev notes

- The dev server serves `public/sw.js` at origin scope `/` over `localhost`
  (allowed) — Chrome treats `localhost` as secure for push.
- Without VAPID keys set, use the settings card to confirm the graceful
  degrade (it should show the "not configured" hint, not an error).
