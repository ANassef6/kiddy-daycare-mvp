-- KID-474: parent notification center.
--
-- Design decision (documented instead of a derived feed): a durable
-- notification table with per-account read state. The KID-221 staff feed
-- (recentActivityFeed) stays derived for provenance, but read state, unread
-- badges and mark-all-read cannot be expressed per account without a
-- durable row, so this table is the source of truth for the parent surface
-- and for every account's unread badge. Duplicates are avoided structurally
-- by a unique (account_id, ref) emission id — writers upsert-safe with
-- ON CONFLICT DO NOTHING.
--
-- `activity` carries the NOTIFICATION_ACTIVITIES key whose notification_pref
-- row governs delivery (channel 'inapp'); `kind` is the view renderer id;
-- `payload` holds the raw, locale-independent data (names, snippets, ids) so
-- the view copies per the account's locale at render time, and `ref` is
-- stable per source event (msg-<messageId>, report-<childId>-<reportDate>).

CREATE TABLE IF NOT EXISTS notification (
  id TEXT PRIMARY KEY,
  institute_id TEXT REFERENCES institute(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  activity TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'activity',
  payload TEXT NOT NULL DEFAULT '{}',
  ref TEXT NOT NULL DEFAULT '',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_account_ref UNIQUE (account_id, ref)
);

CREATE INDEX IF NOT EXISTS idx_notification_account_recent
  ON notification (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_unread
  ON notification (account_id, read_at);
