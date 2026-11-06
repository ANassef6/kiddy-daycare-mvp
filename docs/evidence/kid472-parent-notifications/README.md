# KID-472 / KID-474 — Parent notification center, preferences, unread badge, and message/report events

Branch: `kid472-parent-notifications` (from `origin/master` @ `2d20b41`).
Parent: KID-472 (board's 10-item enhancement request). This issue implements item 2 (first half).

## Design decision (required by the deliverable): durable table with read state

Chosen: **durable `notification` table with per-account read state**
(`supabase/migrations/0031_parent_notifications.sql`, mirrored in
`lib/sqlite-schema.ts` for the local SQLite engine).

Why not a longer derived feed: the parent surface needs per-account read/unread
state, a mark-all-read action, and an unread badge — none of which a derived
feed can express. The KID-221 staff feed (`recentActivityFeed`) keeps its
derived provenance slices unchanged, so **no duplicate items exist**: durable
rows are the parent/badge source of truth; the staff derived feed never
consumes them.

- Duplicate prevention is structural: `UNIQUE (account_id, ref)` with a stable
  per-event ref (`msg-<messageId>`, `report-<childId>-<reportDate>`) and
  idempotent `ON CONFLICT DO NOTHING` writes.
- Payload is locale-independent raw data (names, snippets, ids); copy is
  rendered per account locale at view time (`notificationViewCopy` + `FeedCopy`),
  so an AR account never sees English templates.
- Server-side enforcement: `emitNotifications` honors the account's
  `notification_pref (activity, channel='inapp')` row — stored disabled →
  suppressed; no row → enabled (same convention as the KID-47 prefs pages).

## What was added

| Area | Change |
| --- | --- |
| Schema | migration `0031_parent_notifications.sql` (`notification` table, `uq_notification_account_ref`, `idx_notification_account_recent`, `idx_notification_unread`) + SQLite mirror |
| Store | `PARENT_NOTIFICATION_ACTIVITIES`; `emitNotifications`; `listNotificationsFor`; `unreadNotificationCount`; `markAllNotificationsRead`; `markNotificationRead`; `notificationViewCopy`; `NOTIFICATION_ACTIVITIES` gains `daily_report` + `events` |
| Events | `sendMessage` emits a durable `messages` row to the recipient (covers direct sends, composer fan-out and thread replies at the single choke point); `upsertDailyReport` emits a `daily_report` row on NEW reports to the child's parent audience (`family_member` role parent); `markRead`/`markThreadRead` bridge reads back to the durable rows so opening a conversation clears its badge |
| Staff feed | `recentActivityFeed` gains the two missing slices: messages addressed to the account, and daily reports inside its room scope (both `NOTIFICATION_ACTIVITIES` keys now surface) |
| Parent route | `/child/notifications` — chronological list, unread styling, per-row + mark-all read actions, empty state, deep links (`/child/messages?thread=…`, `/child/<childId>`) |
| Parent nav | `NotificationBell` with unread badge in `/child` header (rides every page) + `Notifications` nav item |
| Parent settings | `/child/settings` notification preferences card (7 parent activities × inapp/email) persisted in `notification_pref` via `saveParentNotificationPrefsAction` |
| Staff nav | `/portal` topbar bell (`/portal/notifications`) now shows an unread badge from `unreadNotificationCount`; the staff notifications page adds 💬 messages and 📋 daily-report icons |
| i18n | EN+AR: `parent.notifications*`, `parent.notifPrefs*`, `parent.pref*` (7 activities), `feed.messageTitle`, `feed.reportTitle`, `feed.reportBody`, `feed.reportMeta` |

Emission failures never break the underlying write (message/report persistence
is authoritative); they are logged with ref/account context — never silently.

## Tests — tests/unit/kid472-parent-notifications.test.ts (14 tests)

- Prefs gate: default-enabled delivery; disabled in-app row suppresses; email-only disable keeps in-app; activities list includes `daily_report`/`events`.
- Audience: daily report reaches ONLY the linked parents (`family_member`), not unrelated parents, the author/owner, or message senders (sender never self-notifies).
- Read state: mark-one → unread 2→1 with correct surviving row; mark-all → 0; per-account isolation.
- Bridge: `markThreadRead` + `markRead` clear the corresponding durable badge rows.
- Duplicates: replayed ref → one row per account; second same-day report save → still one item.
- Staff feed: message + daily-report slices appear for the addressed account only.
- i18n: all 18 new parent keys in both dictionaries (no `MISSING:` markers); new `FeedCopy` resolvers EN/AR; durable rows render localized at view time.

## Checks (all local, on this branch)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (EXIT=0, pre-existing `<img>` warnings only) |
| `npm run build` | clean (EXIT=0) |
| Focused suite | 14/14 (`kid472-parent-notifications.test.ts`) |
| Full suite (1st pass) | 66 files / 666 tests passed; `kid171-parent-contact-and-messaging.test.tsx` hit vitest worker-RPC timeouts — caused by the concurrent `next build`, not the code; 13/13 green when rerun solo and 67/67 green on the isolated rerun |
| Full suite (isolated rerun, nothing concurrent) | **67 files passed, 679 tests passed, EXIT=0, Duration 1747.65s** |

## Production notes

- PG mode applies `0031` automatically on the next deploy via the
  `schema_migrations` ledger; SQLite mode applies the inline mirror on
  `ensureSchema()`. No data backfill needed (no-pref rows default enabled).
- No auth/tenant/billing/permission behavior changed.

## Production verification on Sunshine (2026-11-06, post-deploy)

Deployment: Vercel production deployment for master `9099bdb` (`api.vercel.com`
`v6/deployments`: `githubCommitSha 9099bdb`, ref `master`, `readyState READY`,
2026-11-06T07:57Z). Schema: Supabase REST (service-role, read-only) shows
`schema_migrations` latest file `0031_parent_notifications.sql` and an empty,
queryable `notification` table (deployment applied the migration itself — no
manual writes).

Functional pass (real browser, Playwright over the documented Sunshine QA
logins from docs/QA_KID173_STAFF_LOGIN_LINK.md; account language of the QA
parent is Arabic, which doubles as the i18n check):

| # | Check | Observed |
| --- | --- | --- |
| 1 | Parent bell + nav | `a[href="/child/notifications"]` present on every /child page; no badge before any emission (table empty) |
| 2 | Staff bell badge | parent (Grace Nguyen) → staff (Maria Lopez) message via /child/messages → owner login topbar badge shows `1` with aria-label **"1 unread notifications"** (screenshot `11-staff-bell-after-message.png`) |
| 3 | Staff derived feed | `/portal/notifications` lists **"Message from Grace Nguyen"** and **"Daily report: Becca Nassef"** — the two previously missing slices (screenshot `12-staff-notifications-page.png`) |
| 4 | Daily report event | staff saved the daily report for Becca Nassef via the portal child page → parent received a durable unread item **"تقرير يومي: Becca Nassef"** with deep link `/child/<childId>` (screenshots `07/09`) |
| 5 | Message event to parent | staff composer → Grace Nguyen got an unread item **"رسالة من Maria Lopez"** with deep link `/child/messages?thread=mw4p9g7k-knaycvyw` (screenshot `21-parent-message-unread.png`, also header) |
| 6 | Read state | per-row mark-read cleared the badge (1 → none, item flips to read); mark-all-read clears everything; opening the thread deep link auto-clears the badge via the `markThreadRead` bridge on the next server render (screenshots `15/16/23`) |
| 7 | Preference enforcement | parent turned **Messages** off in `/child/settings` (7 activities × inapp/email rendered), staff sent another message — parent badge stayed empty and `notification` gained no row; preference restored afterwards (screenshots `17/18/19`) |
| 8 | i18n | Arabic account renders the entire center in Arabic (titles, subtitles, mark-all button, item copy, time-ago) — the durable payload copies per locale at view time |

Screenshot index: `01` parent home with bell, `09` parent center (empty state
→ first daily-report item), `10` parent settings, `11` staff badge=1, `12`
staff notifications page with new slices, `14` parent center (message+report),
`15/16` mark-one/mark-all, `18` prefs-off state, `21` message unread with
thread deep link, `22/23` deep-link landing + post-read badge cleared.
Screenshots are uploaded to the Paperclip issue as attachments.

