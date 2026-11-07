# KID-685 — Admin portal notification center: list, mark all as read, sound

KID-488 defect D8 fix. The portal bell counted durable `notification` rows, but
`/portal/notifications` rendered only the derived activity feed — no list, no
"Mark all as read", and no in-app sound. This evidence pack covers the local
production-build verification (`next build` + `next start` of the fix commit,
SQLite demo seed).

## What changed (code)

- `app/portal/notifications/page.tsx` — lists the signed-in staff account's
  `notification` rows newest first (same table `unreadNotificationCount`
  counts), read/unread state per row, per-row "Mark read" plus "Mark all as
  read" (server action, role-correct deep links per kind). The derived
  activity feed stays as a secondary "Recent activity" section.
- `lib/actions.ts` — `markNotificationReadAction` now revalidates BOTH
  `/child/notifications` and `/portal/notifications`; authorization is
  unchanged (`authAccount()` + `account_id`-scoped WHERE).
- `app/portal/layout.tsx` — mounts the KID-480 `NotificationSoundWatcher` on
  the portal shell (parent shell already had it).
- `components/NotificationSoundWatcher.tsx` — the poll/play loop extracted to
  `startNotificationSoundWatcher` (behavior unchanged) so the one-sound-attempt
  rule is unit-testable.
- `lib/i18n.ts` — `notifications.subtitle` reworded (EN/AR), new
  `notifications.activityTitle` (EN/AR); the mark-read/empty/badge strings
  reuse the existing KID-474 keys (already EN+AR).
- `tests/unit/kid685-portal-notifications.test.tsx` — 11 tests (see below).

## Test evidence (unit, isolated SQLite — never touches prod data)

`tests/unit/kid685-portal-notifications.test.tsx`: 11/11 pass
- list renders the caller's rows; unread-row count on the page equals
  `unreadNotificationCount` (the mismatch is gone); "Mark all as read" and
  per-row "Mark read" render.
- only the caller's rows render (another staff account's rows never appear,
  either direction).
- tenant isolation: a row tagged to another institute never renders even for
  the same account (mirrors `/child/notifications`).
- `markNotificationReadAction` clears ONLY the caller's rows; the unread count
  reaches 0; both shell paths are revalidated.
- sound: a new unread row triggers exactly ONE `Audio` play attempt (mocked
  audio + fetch, fake timers); a repeated count and the "off" opt-out never
  play; the portal layout mounts the watcher.
- EN + AR parity for the page keys.

Regression: full suite green at the fix commit (see final report), plus
`npx tsc --noEmit`, `npm run lint` (pre-existing `<img>` warnings only) and
`npm run build` all clean.

## Local production-build verification (browser + HTTP)

Build: `npm run build` (Next 14.2.35, production). Server: `next start -p 3777`
with the seeded SQLite demo (`lib/seed.ts`: admin `trois4ever+admin@gmail.com`).
Two parent→admin message notifications were emitted through the real
`sendMessage` path, reproducing the user report exactly (2 unread, no list).

Verified with Skyvern's real browser (run `tsk_594387400480082784`, this
directory's `skyvern-flow-transcript.md`) and raw HTTP:

1. **Bell count equals the list** — the bell shows the red "2" badge
   (`aria-label` "2 unread notifications") and the page lists the SAME 2 rows,
   both with the unread marker and a per-row "Mark read" button; the
   "Mark all as read" button sits above the list. Screenshot:
   `local-prodbuild-notifications-page-belld2.png` (login → bell →
   `/portal/notifications`).
2. **Mark all as read clears the badge** — the button posts the shared server
   action (`markNotificationReadAction`, id=all). After it runs:
   `unreadNotificationCount` = 0 (`/api/notifications/unread` → `{"count":0}`),
   the per-row "Mark read" buttons and the unread markers are gone from the
   markup, and the bell badge disappears (no `role="status"` unread span).
3. **Sound** — the portal layout now mounts the KID-480 watcher, so the
   polling ear is live on every portal page. Browser-level audio playback is
   not observable over an automation screenshot, so the one-play-per-new-row
   behavior is pinned by the mocked unit test above.

### The exact browser rule for the sound (required by the plan)

- Browsers apply autoplay policy: `Audio.play()` needs a prior user
  interaction with the page (a click, a key press, etc. — navigation alone is
  not enough). If the admin opens the portal and a notification arrives before
  ANY interaction, the browser refuses the play (`NotAllowedError`); the
  watcher logs it and keeps polling, so the NEXT new row after any interaction
  beeps normally.
- Background/hidden tabs: Chrome throttles page timers to at least one minute
  in hidden tabs (the 45 s poll can stretch), and only plays audio if the site
  has a high media-engagement index; Firefox and Safari commonly mute hidden
  tabs entirely. So "beep for every row while I keep the portal in another
  tab" is not reliably achievable in any browser — this is the platform rule,
  not an app defect. The KID-480 web-push channel remains the reliable channel
  for closed/background delivery where VAPID is configured.
- The sound is opt-out via the existing account preference
  (localStorage `kiddy:notificationSound === "off"`); every failure degrades
  silently-safe (logged, never thrown).

## Production verification status (honest)

- Master deploys automatically (prior evidence: Vercel auto-deploy on merge).
- The production admin account is `trois4ever+admin@gmail.com`; its password
  is NOT available to this run (KID-489 QA documented the same gap), sothe
  login-gated portal surfaces could not be driven on kiddyapp.net from here.
  Everything above was verified on a production build of the fix running
  locally with the demo seed — same code paths (`next build` output, server
  actions, real browser traffic).
- After merge/deploy, the two remaining production checks are: admin bell
  count equals the list on kiddyapp.net (already proven count-consistent by
  construction — same table, same WHERE), and a real device check that
  audio plays after a user interaction (browser/device dependent per the rule
  above).

## Artifacts

- `local-prodbuild-notifications-page-belld2.png` — Skyvern screenshot of the
  production-build page: bell badge "2", both unread rows with per-row
  "Mark read", "Mark all as read" button, "Recent activity" section below.
- `skyvern-flow-transcript.md` — the automation run's own observations
  (login, navigation, button click, page-state assessment).
- `after-markall.http` — HTTP transcript of the server-action POST and the
  post-action page state (0 unread markers, 0 badge, count API → 0).
