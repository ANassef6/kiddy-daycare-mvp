// Kiddy data layer — local SQLite mirror of the Supabase schema.
// When SUPABASE_URL/KEY are present the app should switch to supabase-js against
// supabase/migrations; this module provides the runnable local path with zero infra.
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// NOTE: we deliberately avoid the generic DATABASE_URL env var (this environment
// injects a control-plane Postgres URL into it). Kiddy uses its own var, defaulting
// to a local SQLite file when unset.
const DB_PATH =
  process.env.KIDDY_DATABASE_URL?.replace("file:", "") ??
  path.join(DATA_DIR, "kiddy.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  // DELETE (rollback) journal: commits are written straight to the main .db file
  // and immediately visible to other processes (seed script, external tooling).
  // WAL mode is preferable for concurrency but leaves data invisible to other
  // processes until a checkpoint — which breaks the seed-then-serve flow here.
  _db.pragma("journal_mode = DELETE");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

// On a clean process exit, ensure the connection is flushed/closed.
if (typeof process !== "undefined") {
  process.on("exit", () => {
    try {
      if (_db) {
        _db.pragma("wal_checkpoint(TRUNCATE)");
        _db.close();
      }
    } catch {
      /* best-effort flush on exit */
    }
  });
}

export function migrate(db: Database.Database = getDb()): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS institute (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    logo_url TEXT,
    brand_image_url TEXT,
    primary_color TEXT NOT NULL DEFAULT '#3B82F6',
    accent_color TEXT NOT NULL DEFAULT '#10B981',
    font TEXT NOT NULL DEFAULT 'Inter',
    opening_hours TEXT,          -- JSON: { "mon": "07:00-18:00", ... }
    closing_days TEXT,           -- JSON array of ISO dates
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'parent',   -- parent | staff | admin | owner
    staff_id TEXT,
    pin TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'carer',    -- admin | carer | parent
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
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS check_in (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    type TEXT NOT NULL,                         -- in | out
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

  CREATE TABLE IF NOT EXISTS daily_report (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    report_date TEXT NOT NULL,
    summary TEXT,
    observation TEXT,
    mood TEXT,
    meal TEXT,                 -- JSON { breakfast, lunch, snack }
    sleep TEXT,                -- JSON { naps: [...], total }
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
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | denied
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
  `);
}

export function uid(): string {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
  );
}
