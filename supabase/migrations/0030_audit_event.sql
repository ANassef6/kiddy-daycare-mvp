-- KID-477: unified audit trail.
--
-- One row per user-visible mutation. In addition to the action itself, every
-- row snapshots:
--   institute_id       tenant scope (nullable: platform-level events only).
--   actor_account_id   the acting account (SET NULL so deleting an account
--                      never breaks history — same style as 0015/0026).
--   actor_name         denormalized name snapshot, so the trail stays readable
--                      after an account is removed.
--   action/entity_type/entity_id  what happened and to which record.
--   summary            short human string (never bodies/secrets — bounded
--                      metadata in the JSON column only).
--   metadata           bounded JSON details (e.g. changed field names), always
--                      written as a JSON string so pg TEXT and SQLite TEXT
--                      stay byte-compatible.
--   request_path       optional request context captured at write time.
--
-- The audit_event write is add-only: nothing updates or deletes rows, and no
-- code path reads it for behavior — only the admin audit-trail page reads.

CREATE TABLE IF NOT EXISTS audit_event (
  id TEXT PRIMARY KEY,
  institute_id TEXT REFERENCES institute(id) ON DELETE CASCADE,
  actor_account_id TEXT REFERENCES account(id) ON DELETE SET NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  metadata TEXT,
  request_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_institute_created
  ON audit_event (institute_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON audit_event (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor
  ON audit_event (actor_account_id, created_at DESC);

-- KID-477: daily-report edits used to overwrite the row in place with no
-- updated_at / actor trail. Both columns are additive (NULL for rows drafted
-- before this migration, which simply show "Created by …" only).
ALTER TABLE daily_report ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE daily_report ADD COLUMN IF NOT EXISTS updated_by_account_id TEXT REFERENCES account(id) ON DELETE SET NULL;
