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
