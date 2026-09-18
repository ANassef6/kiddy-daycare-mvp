-- KID-47 Round 6: homework, supplies, staff schedules, notification prefs, form share tokens.
-- Additive only.

CREATE TABLE IF NOT EXISTS homework (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  child_id TEXT REFERENCES child(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_homework_institute ON homework (institute_id);
CREATE INDEX IF NOT EXISTS idx_homework_child ON homework (child_id);

CREATE TABLE IF NOT EXISTS supply_request (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'pcs',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'needed',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supply_institute ON supply_request (institute_id);

CREATE TABLE IF NOT EXISTS staff_schedule (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL DEFAULT 1,
  start_time TEXT NOT NULL DEFAULT '08:00',
  end_time TEXT NOT NULL DEFAULT '16:00',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_staff ON staff_schedule (staff_id);

CREATE TABLE IF NOT EXISTS notification_pref (
  account_id TEXT NOT NULL,
  activity TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'inapp',
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, activity, channel)
);

ALTER TABLE form_template ADD COLUMN IF NOT EXISTS share_token TEXT;
