-- Kiddy — initial schema (Supabase / Postgres).
-- Mirrors the local SQLite schema so `lib/store.ts` can run unchanged against both.
-- Idempotent: safe to apply on every app startup.
-- Integer flags stay SMALLINT so the app's `= 1` comparisons keep working.

CREATE TABLE IF NOT EXISTS institute (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  brand_image_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#3B82F6',
  accent_color TEXT NOT NULL DEFAULT '#10B981',
  font TEXT NOT NULL DEFAULT 'Inter',
  opening_hours TEXT,
  closing_days TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS branch (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Main',
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branch(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'parent',
  staff_id TEXT,
  pin TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'carer',
  active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_room (
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, room_id)
);

CREATE TABLE IF NOT EXISTS child (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branch(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES room(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  dob TEXT,
  photo_url TEXT,
  active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrollment (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  start_date TEXT,
  status TEXT NOT NULL DEFAULT 'enrolled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS child_health (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  allergies TEXT,
  conditions TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  is_pickup SMALLINT NOT NULL DEFAULT 0,
  is_emergency SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family_member (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'parent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invite (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  child_id TEXT REFERENCES child(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS check_in (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_edit SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attendance_schedule (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  day_of_week INTEGER,
  planned_in TEXT,
  planned_out TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_report (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL,
  summary TEXT,
  observation TEXT,
  mood TEXT,
  meal TEXT,
  sleep TEXT,
  diaper TEXT,
  sick SMALLINT NOT NULL DEFAULT 0,
  note TEXT,
  created_by_account_id TEXT REFERENCES account(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (child_id, report_date)
);

CREATE TABLE IF NOT EXISTS newsfeed_post (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  media_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsfeed_tag (
  post_id TEXT NOT NULL REFERENCES newsfeed_post(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, child_id)
);

CREATE TABLE IF NOT EXISTS newsfeed_like (
  post_id TEXT NOT NULL REFERENCES newsfeed_post(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, account_id)
);

CREATE TABLE IF NOT EXISTS newsfeed_comment (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES newsfeed_post(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  sender_account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  recipient_account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  read SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  child_id TEXT REFERENCES child(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES account(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'image',
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consent_request (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  child_id TEXT REFERENCES child(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incident_report (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'incident',
  description TEXT NOT NULL,
  acknowledged SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helpful index: the daily loop queries today's check-ins per child.
CREATE INDEX IF NOT EXISTS idx_check_in_child_rec ON check_in (child_id, recorded_at DESC);