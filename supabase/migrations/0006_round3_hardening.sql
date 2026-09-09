-- Kiddy Round 3 (founder feedback batch #1, buckets A+B): daily-loop hardening.
-- Idempotent — safe to apply on every app startup alongside the earlier migrations.

-- #6 Rooms interactive: colour per room (name/capacity already exist).
ALTER TABLE room ADD COLUMN IF NOT EXISTS colour TEXT NOT NULL DEFAULT '#3B82F6';

-- #5b Child statuses (mood/diaper/sleep/sick): timestamped, multiple entries per day.
CREATE TABLE IF NOT EXISTS child_status (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  note TEXT,
  recorded_by_account_id TEXT REFERENCES account(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_child_status ON child_status (child_id, recorded_at DESC);