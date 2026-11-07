# KID-487 — General push notifications for staff and all notification types

What changed, in one line: web push stopped being a parent-only feature —
every emitted notification kind rides the same `emitNotifications →
sendPushToAccounts` choke point with role-resolved deep links, and the staff
portal can now subscribe and receive.

## Code map

- `lib/push.ts` — `pushDeepUrl(kind, payload, role)` is role-aware
  (`isStaffRole`): staff roles (owner/admin/teacher/caregiver) get `/portal/...`
  links, everyone else `/child/...`; `sendPushToAccounts` resolves the
  receiving account's role per account so one mixed-audience emission
  produces one deliver per surface.
- `lib/store.ts` — new durable emissions through `emitNotifications`:
  - check-in / check-out / edit pass / auto-check-out (kinds `attendance`,
    helper `emitPickupEvent`) → assigned classroom staff (`roomStaffIds`)
    + family parents (`familyParentsForChildren`), minus the actor. The
    planned-pickup set/changed event arrives as the KID-486 `pickup_time`
    kind through the same pipeline; its portal deep link is wired in
    `pushDeepUrl`.
  - incident reports → child's room staff + family (kind `incident`).
  - events → every parent of the daycare (kind `event`).
  - homework → the child's room staff, minus the author (child-less
    homework → center-wide staff) (kind `homework`).
  - supply requests → center-wide staff, minus the actor (kind `supplies`).
  - announcements and daily reports gained their staff audience in the same
    emission they already used for parents (same ref; dedupe is per account).
  - `notificationViewCopy` handles the new kinds (attendance reuses the
    feed's checked-in/out titles; edits use the new
    `feed.attendanceUpdatedTitle`); `ensureDefaultPushPrefs` takes the
    activity list so the caller picks the parent or portal surface.
- Staff surface — `app/portal/layout.tsx` mounts `ServiceWorkerRegister`
  (same `sw.js`, scope `/`) and `NotificationSoundWatcher`;
  `app/portal/account/page.tsx` renders the push card + a Push column for
  every portal activity with EN/AR labels (`portal.pref*` / `portal.push*`
  dictionary keys); `saveNotificationPrefsAction` persists the `push`
  channel; the subscribe API fills defaults matching the caller's role.
- `public/sw.js` — `silent: false` pinned (system notification sound where
  the platform honors it); the payload URL is the deep link.
- `app/child/notifications/page.tsx` — per-kind hrefs now go through the
  shared `pushDeepUrl` map instead of a private branch list.
- `docs/PUSH_NOTIFICATIONS.md` — events/audience/deep-link table, sound +
  iOS/Android behavior, secrets instructions.

## Tests

`tests/unit/kid487-staff-push.test.ts` — 28/28 ✓

- staff push pickup: check-in notifies the assigned room teacher with a
  durable row + push (`/portal/attendance`); other-room staff, the acting
  parent, and the author filtering are all pinned.
- pickup-time changed: auto-check-out (system actor) emits; edit passes use
  the updated title copy.
- family receives its own non-caused events at `/child/<childId>`.
- full kind coverage with role-resolved URLs in one mixed emission
  (message: `/portal/messages?thread=` vs `/child/messages?thread=`); replay
  idempotence; 404/410 stale pruning per account.
- incident/event/homework/supplies audiences (incl. author/actor exclusion,
  center-wide vs room scoping, parents-only for events).
- daily reports reach staff + family through the same ref.
- opt-out: `push` channel disabled suppresses the send but keeps the row;
  `inapp` disabled suppresses both.
- best-effort: a rejected sender never breaks the check-in write.
- teacher subscription defaults fill all nine portal activities; parents
  fill the parent list; subscribe-route/pref semantics pinned via fs pins.
- i18n parity: every new `portal.*` key + `feed.attendanceUpdatedTitle` in
  EN and AR.

## Regression + gates

- `kid472-push-sound` + `kid472-parent-notifications` + `classroom-scoping`
  + `kid182` suites: 58/58 ✓ (behavior change is additive).
- Full `vitest run`: 859/860 — the single red is a first-run 10s hook
  timeout in the static `kid205` source scan; it passes on re-run (7/7 ✓).
- `tsc --noEmit` clean, `next lint` clean, `next build` green.

## Evidence of push delivery (what could not be verified here)

No VAPID keys can be configured inside this repo environment by design
(`docs/PUSH_NOTIFICATIONS.md` § secrets). The secret request is already in
flight through the Paperclip process: pending board proposals
`kiddy/vapid-public-key` and `kiddy/vapid-private-key` (from the KID-480
run). Unit tests cover the full delivery path with an injected fake
`web-push` sender; end-to-end status-bar delivery on a real Android device
only becomes verifiable once those secrets are bound. Do not treat this README
as claiming an end-to-end device delivery.

## Platform limits (documented, unchanged by this task)

- Android PWA/TWA: background pushes are status-bar notifications with the
  system notification sound (`silent: false` in `sw.js`).
- iOS: web push requires the PWA added to the Home Screen (iOS 16.4+);
  the system notification sound applies, custom sounds are not reliable.
- Native FCM/APNs (separate task) would be needed for the mobile app push.
- The concurrent KID-486 work shares this tree; this task's evidence is
  limited to the KID-487 change set + the additive sort.
