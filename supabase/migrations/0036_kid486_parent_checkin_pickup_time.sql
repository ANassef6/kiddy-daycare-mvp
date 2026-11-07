-- KID-486: parent-side access model — same-day planned pickup time and the
-- center-wide "parents may check in/out" toggle.
--
-- 1. `institute.parent_checkin_enabled` (SMALLINT 1/0, default ON): the
--    admin toggle that governs parent check-in/out. When 0 the parent
--    check-in/out UI is hidden and checkInOutAction refuses parent-role
--    accounts; staff attendance flows and parent attendance READS are not
--    affected. SMALLINT + 0/1 matches 0022_institute_active.sql.
--
-- 2. `pickup_time`: the planned pickup contact's schedule. One entry per
--    child per day (UNIQUE), written only by the pickup user, only for
--    today, only inside the center's working hours on an open day.
--
-- Idempotent: safe to apply on every app startup.

ALTER TABLE institute ADD COLUMN IF NOT EXISTS parent_checkin_enabled SMALLINT NOT NULL DEFAULT 1;

-- The parent-side account editor (name / password / photo) writes the
-- account's OWN avatar; the column mirrors staff.photo_url's convention.
ALTER TABLE account ADD COLUMN IF NOT EXISTS photo_url TEXT;

CREATE TABLE IF NOT EXISTS pickup_time (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  pickup_date TEXT NOT NULL,
  pickup_time TEXT NOT NULL,
  note TEXT,
  created_by_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_pickup_time_child_date UNIQUE (child_id, pickup_date),
  CONSTRAINT ck_pickup_time_hhmm CHECK (pickup_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

CREATE INDEX IF NOT EXISTS idx_pickup_time_child_date ON pickup_time (child_id, pickup_date);
CREATE INDEX IF NOT EXISTS idx_pickup_time_account ON pickup_time (account_id, pickup_date);
CREATE INDEX IF NOT EXISTS idx_pickup_time_institute_date ON pickup_time (institute_id, pickup_date);
