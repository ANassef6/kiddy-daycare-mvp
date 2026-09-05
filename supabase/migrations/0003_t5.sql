-- Kiddy — T5 / M5 extra kept areas (idempotent, applied on app startup in
-- Postgres mode like 0001/0002):
--   light Learning/observations, Events & Video, Forms/Lists/Tags/Surveys,
--   Parent Drive, support tickets, and live-chat helpers.
-- All tables use the same TEXT-id + institute_id pattern as 0001 so
-- `lib/store.ts` runs unchanged against both Postgres and the SQLite mirror.

CREATE TABLE IF NOT EXISTS event (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  description TEXT,
  created_by_account_id TEXT REFERENCES account(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Photos/videos attached to an event (media rows created for the event).
CREATE TABLE IF NOT EXISTS media_event (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, media_id)
);

CREATE TABLE IF NOT EXISTS form_template (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'form', -- form | list | survey
  title TEXT NOT NULL,
  description TEXT,
  fields_json TEXT NOT NULL DEFAULT '[]',
  created_by_account_id TEXT REFERENCES account(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS form_response (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES form_template(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES account(id),
  child_id TEXT REFERENCES child(id) ON DELETE CASCADE,
  answers_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tag (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS child_tag (
  tag_id TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  PRIMARY KEY (tag_id, child_id)
);

CREATE TABLE IF NOT EXISTS drive_file (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'file', -- file | pdf | photo | video | audio
  size_bytes INTEGER,
  description TEXT,
  child_id TEXT REFERENCES child(id) ON DELETE CASCADE, -- null = center-wide
  uploaded_by_account_id TEXT REFERENCES account(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_observation (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES account(id),
  kind TEXT NOT NULL DEFAULT 'observation', -- observation | milestone | goal
  title TEXT,
  body TEXT NOT NULL,
  recorded_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_ticket (
  id TEXT PRIMARY KEY,
  institute_id TEXT REFERENCES institute(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES account(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | answered | closed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_date ON event (institute_id, event_date);
CREATE INDEX IF NOT EXISTS idx_drive_child ON drive_file (child_id);
CREATE INDEX IF NOT EXISTS idx_obs_child ON learning_observation (child_id);
CREATE INDEX IF NOT EXISTS idx_form_resp_form ON form_response (form_id);