// SQLite schema for the local zero-infra fallback. Mirrors
// supabase/migrations/0001_init.sql (Postgres) exactly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sqliteSchema(db: any): void {
  db.exec(`
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS branch (
    id TEXT PRIMARY KEY,
    institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Main',
    address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS room (
    id TEXT PRIMARY KEY,
    institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
    branch_id TEXT REFERENCES branch(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    capacity INTEGER,
    colour TEXT NOT NULL DEFAULT '#3B82F6',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    auth_user_id TEXT,
    email_confirmed INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'carer',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS enrollment (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    start_date TEXT,
    status TEXT NOT NULL DEFAULT 'enrolled',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS child_health (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    allergies TEXT,
    conditions TEXT,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contact (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    relationship TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    is_pickup INTEGER NOT NULL DEFAULT 0,
    is_emergency INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS family_member (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'parent',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invite (
    id TEXT PRIMARY KEY,
    institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
    child_id TEXT REFERENCES child(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS check_in (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_edit INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS attendance_schedule (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    day_of_week INTEGER,
    planned_in TEXT,
    planned_out TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS child_status (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    note TEXT,
    recorded_by_account_id TEXT REFERENCES account(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_child_status ON child_status (child_id, recorded_at DESC);

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
    sick INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_by_account_id TEXT REFERENCES account(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (child_id, report_date)
  );

  CREATE TABLE IF NOT EXISTS newsfeed_post (
    id TEXT PRIMARY KEY,
    institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    media_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS message (
    id TEXT PRIMARY KEY,
    institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
    sender_account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    recipient_account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
    child_id TEXT REFERENCES child(id) ON DELETE CASCADE,
    account_id TEXT REFERENCES account(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'image',
    caption TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS consent_request (
    id TEXT PRIMARY KEY,
    institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT,
    child_id TEXT REFERENCES child(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS incident_report (
    id TEXT PRIMARY KEY,
    institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
    child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'incident',
    description TEXT NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contact_request (
    id TEXT PRIMARY KEY,
    institute_id TEXT REFERENCES institute(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    role TEXT NOT NULL DEFAULT 'parent',
    interest TEXT NOT NULL DEFAULT 'demo',
    message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS media_event (
    event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, media_id)
  );

  CREATE TABLE IF NOT EXISTS form_template (
    id TEXT PRIMARY KEY,
    institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'form',
    title TEXT NOT NULL,
    description TEXT,
    fields_json TEXT NOT NULL DEFAULT '[]',
    created_by_account_id TEXT REFERENCES account(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS form_response (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL REFERENCES form_template(id) ON DELETE CASCADE,
    account_id TEXT REFERENCES account(id),
    child_id TEXT REFERENCES child(id) ON DELETE CASCADE,
    answers_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tag (
    id TEXT PRIMARY KEY,
    institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3B82F6',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    kind TEXT NOT NULL DEFAULT 'file',
    size_bytes INTEGER,
    description TEXT,
    child_id TEXT REFERENCES child(id) ON DELETE CASCADE,
    uploaded_by_account_id TEXT REFERENCES account(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS learning_observation (
    id TEXT PRIMARY KEY,
    institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
    child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    account_id TEXT REFERENCES account(id),
    kind TEXT NOT NULL DEFAULT 'observation',
    title TEXT,
    body TEXT NOT NULL,
    recorded_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS support_ticket (
    id TEXT PRIMARY KEY,
    institute_id TEXT REFERENCES institute(id) ON DELETE CASCADE,
    account_id TEXT REFERENCES account(id),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_event_date ON event (institute_id, event_date);
  CREATE INDEX IF NOT EXISTS idx_drive_child ON drive_file (child_id);
  CREATE INDEX IF NOT EXISTS idx_obs_child ON learning_observation (child_id);
  CREATE INDEX IF NOT EXISTS idx_form_resp_form ON form_response (form_id);
  `);

  // Idempotent column backfills for databases created before these columns
  // existed (CREATE TABLE IF NOT EXISTS does not alter existing tables).
  const roomCols = db.prepare("PRAGMA table_info(room)").all() as { name: string }[];
  if (!roomCols.some((c) => c.name === "colour")) {
    db.exec("ALTER TABLE room ADD COLUMN colour TEXT NOT NULL DEFAULT '#3B82F6'");
  }
}