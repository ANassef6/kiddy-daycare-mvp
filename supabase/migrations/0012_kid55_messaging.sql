-- KID-56 (KID-55 item 1): messaging threads, class channels, group mode.
-- Additive only — never drops or rewrites existing data.
-- 1:1 messages keep thread_id NULL and behave exactly as before.

ALTER TABLE message ADD COLUMN IF NOT EXISTS thread_id TEXT;

CREATE TABLE IF NOT EXISTS message_thread (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  title TEXT,
  is_group INTEGER NOT NULL DEFAULT 0,
  created_by_account_id TEXT REFERENCES account(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_thread_participant (
  thread_id TEXT NOT NULL REFERENCES message_thread(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_message_thread ON message (thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_message_unread ON message (recipient_account_id, read);
