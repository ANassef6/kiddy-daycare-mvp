import { getDb, uid } from "./db";
import type Database from "better-sqlite3";

type Row = Record<string, unknown>;

function all(db: Database.Database, sql: string, ...args: unknown[]): Row[] {
  return db.prepare(sql).all(...args) as Row[];
}
function one(db: Database.Database, sql: string, ...args: unknown[]): Row | undefined {
  return db.prepare(sql).get(...args) as Row | undefined;
}

// ---------- Institute / branding (white-label) ----------
export function getInstitute(instituteId: string): Row | undefined {
  return one(getDb(), "SELECT * FROM institute WHERE id = ?", instituteId);
}

export function listInstitutes(): Row[] {
  return all(getDb(), "SELECT * FROM institute ORDER BY name");
}

export function seedInstitute(data: {
  name: string;
  primaryColor?: string;
  accentColor?: string;
  font?: string;
  openingHours?: Record<string, string>;
  closingDays?: string[];
}): Row {
  const db = getDb();
  const id = uid();
  db.prepare(
    `INSERT INTO institute (id, name, primary_color, accent_color, font, opening_hours, closing_days)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.name,
    data.primaryColor ?? "#3B82F6",
    data.accentColor ?? "#10B981",
    data.font ?? "Inter",
    JSON.stringify(data.openingHours ?? {}),
    JSON.stringify(data.closingDays ?? [])
  );
  return getInstitute(id)!;
}

export function updateInstitute(instituteId: string, patch: Record<string, unknown>): void {
  const db = getDb();
  const fields = Object.keys(patch)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = Object.values(patch);
  values.push(instituteId);
  db.prepare(`UPDATE institute SET ${fields} WHERE id = ?`).run(...values);
}

// ---------- Rooms ----------
export function listRooms(instituteId: string): Row[] {
  return all(getDb(), "SELECT * FROM room WHERE institute_id = ? ORDER BY name", instituteId);
}

export function createRoom(instituteId: string, name: string, capacity?: number): Row {
  const db = getDb();
  const id = uid();
  db.prepare("INSERT INTO room (id, institute_id, name, capacity) VALUES (?, ?, ?, ?)").run(
    id,
    instituteId,
    name,
    capacity ?? null
  );
  return one(db, "SELECT * FROM room WHERE id = ?", id)!;
}

// ---------- Staff ----------
export function listStaff(instituteId: string): Row[] {
  return all(getDb(), "SELECT * FROM staff WHERE institute_id = ? ORDER BY full_name", instituteId);
}

export function createStaff(data: {
  instituteId: string;
  fullName: string;
  role: string;
  roomIds?: string[];
}): Row {
  const db = getDb();
  const id = uid();
  db.prepare(
    "INSERT INTO staff (id, institute_id, full_name, role) VALUES (?, ?, ?, ?)"
  ).run(id, data.instituteId, data.fullName, data.role);
  for (const roomId of data.roomIds ?? []) {
    db.prepare("INSERT OR IGNORE INTO staff_room (staff_id, room_id) VALUES (?, ?)").run(id, roomId);
  }
  return one(db, "SELECT * FROM staff WHERE id = ?", id)!;
}

export function staffRooms(staffId: string): Row[] {
  return all(
    getDb(),
    `SELECT r.* FROM room r JOIN staff_room sr ON sr.room_id = r.id WHERE sr.staff_id = ? ORDER BY r.name`,
    staffId
  );
}

// ---------- Children ----------
export function createChild(data: {
  instituteId: string;
  firstName: string;
  lastName: string;
  dob?: string;
  roomId?: string;
  branchId?: string;
  allergies?: string;
  conditions?: string;
  healthNotes?: string;
}): Row {
  const db = getDb();
  const childId = uid();
  db.prepare(
    `INSERT INTO child (id, institute_id, branch_id, room_id, first_name, last_name, dob)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    childId,
    data.instituteId,
    data.branchId ?? null,
    data.roomId ?? null,
    data.firstName,
    data.lastName,
    data.dob ?? null
  );
  db.prepare("INSERT INTO enrollment (id, child_id) VALUES (?, ?)").run(uid(), childId);
  db.prepare(
    "INSERT INTO child_health (id, child_id, allergies, conditions, notes) VALUES (?, ?, ?, ?, ?)"
  ).run(uid(), childId, data.allergies ?? "", data.conditions ?? "", data.healthNotes ?? "");
  return one(db, "SELECT * FROM child WHERE id = ?", childId)!;
}

export function listChildren(instituteId: string): Row[] {
  const db = getDb();
  return all(
    db,
    `SELECT c.*, r.name AS room_name, h.allergies, h.conditions, h.notes
     FROM child c
     LEFT JOIN room r ON r.id = c.room_id
     LEFT JOIN child_health h ON h.child_id = c.id
     WHERE c.institute_id = ? AND c.active = 1
     ORDER BY c.first_name, c.last_name`,
    instituteId
  );
}

export function getChild(childId: string): Row | undefined {
  return one(getDb(), "SELECT * FROM child WHERE id = ?", childId);
}

export function addContact(data: {
  childId: string;
  fullName: string;
  relationship: string;
  phone?: string;
  email?: string;
  isPickup: boolean;
  isEmergency: boolean;
}): Row {
  const db = getDb();
  const id = uid();
  db.prepare(
    `INSERT INTO contact (id, child_id, full_name, relationship, phone, email, is_pickup, is_emergency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.childId,
    data.fullName,
    data.relationship,
    data.phone ?? null,
    data.email ?? null,
    data.isPickup ? 1 : 0,
    data.isEmergency ? 1 : 0
  );
  return one(db, "SELECT * FROM contact WHERE id = ?", id)!;
}

export function listContacts(childId: string): Row[] {
  return all(getDb(), "SELECT * FROM contact WHERE child_id = ? ORDER BY full_name", childId);
}

// ---------- Parent linking / invites ----------
export function createInvite(instituteId: string, childId: string | null, email: string, code: string): Row {
  const db = getDb();
  const id = uid();
  db.prepare(
    "INSERT INTO invite (id, institute_id, child_id, email, code) VALUES (?, ?, ?, ?, ?)"
  ).run(id, instituteId, childId, email.toLowerCase(), code);
  return one(db, "SELECT * FROM invite WHERE id = ?", id)!;
}

export function getInviteByCode(code: string): Row | undefined {
  return one(getDb(), "SELECT * FROM invite WHERE code = ?", code);
}

export function linkFamily(accountId: string, childId: string): void {
  const db = getDb();
  db.prepare(
    "INSERT OR IGNORE INTO family_member (id, account_id, child_id) VALUES (?, ?, ?)"
  ).run(uid(), accountId, childId);
}

export function familiesForAccount(accountId: string): Row[] {
  return all(
    getDb(),
    `SELECT c.*, r.name AS room_name, fm.role AS link_role
     FROM family_member fm
     JOIN child c ON c.id = fm.child_id
     LEFT JOIN room r ON r.id = c.room_id
     WHERE fm.account_id = ? AND c.active = 1`,
    accountId
  );
}

// ---------- Check-in / attendance (daily loop) ----------
export function checkChildInOut(data: {
  childId: string;
  accountId: string;
  type: "in" | "out";
  isEdit?: boolean;
}): Row {
  const db = getDb();
  const id = uid();
  db.prepare(
    "INSERT INTO check_in (id, child_id, account_id, type, is_edit) VALUES (?, ?, ?, ?, ?)"
  ).run(id, data.childId, data.accountId, data.type, data.isEdit ? 1 : 0);
  return one(db, "SELECT * FROM check_in WHERE id = ?", id)!;
}

export function todayStatus(childId: string): { checkedIn?: Row; checkedOut?: Row; lastEvent?: Row } {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const latest = all(
    db,
    `SELECT * FROM check_in WHERE child_id = ? AND date(recorded_at) = ?
     ORDER BY recorded_at DESC LIMIT 6`,
    childId,
    today
  );
  const last = latest[0];
  return {
    checkedIn: latest.find((c) => c.type === "in"),
    checkedOut: latest.find((c) => c.type === "out"),
    lastEvent: last,
  };
}

export function attendanceOn(instituteId: string, day: string): Row[] {
  return all(
    getDb(),
    `SELECT c.id, c.first_name, c.last_name, r.name AS room_name,
            (SELECT type FROM check_in WHERE child_id = c.id AND date(recorded_at) = ? ORDER BY recorded_at DESC LIMIT 1) AS last_event,
            (SELECT recorded_at FROM check_in WHERE child_id = c.id AND date(recorded_at) = ? AND type='in' ORDER BY recorded_at DESC LIMIT 1) AS checked_in_at,
            (SELECT recorded_at FROM check_in WHERE child_id = c.id AND date(recorded_at) = ? AND type='out' ORDER BY recorded_at DESC LIMIT 1) AS checked_out_at
     FROM child c
     LEFT JOIN room r ON r.id = c.room_id
     WHERE c.institute_id = ? AND c.active = 1
     ORDER BY r.name, c.first_name`,
    day,
    day,
    day,
    instituteId
  );
}

// ---------- Daily report ----------
export function upsertDailyReport(data: {
  childId: string;
  reportDate: string;
  summary?: string;
  observation?: string;
  mood?: string;
  meal?: string;
  sleep?: string;
  diaper?: string;
  sick?: boolean;
  note?: string;
  accountId?: string;
}): Row {
  const db = getDb();
  const existing = one(
    db,
    "SELECT * FROM daily_report WHERE child_id = ? AND report_date = ?",
    data.childId,
    data.reportDate
  );
  if (existing) {
    db.prepare(
      `UPDATE daily_report SET summary=?, observation=?, mood=?, meal=?, sleep=?, diaper=?, sick=?, note=?
       WHERE id = ?`
    ).run(
      data.summary ?? "",
      data.observation ?? "",
      data.mood ?? "",
      data.meal ?? "",
      data.sleep ?? "",
      data.diaper ?? "",
      data.sick ? 1 : 0,
      data.note ?? "",
      existing.id
    );
    return one(db, "SELECT * FROM daily_report WHERE id = ?", existing.id)!;
  }
  const id = uid();
  db.prepare(
    `INSERT INTO daily_report (id, child_id, report_date, summary, observation, mood, meal, sleep, diaper, sick, note, created_by_account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.childId,
    data.reportDate,
    data.summary ?? "",
    data.observation ?? "",
    data.mood ?? "",
    data.meal ?? "",
    data.sleep ?? "",
    data.diaper ?? "",
    data.sick ? 1 : 0,
    data.note ?? "",
    data.accountId ?? null
  );
  return one(db, "SELECT * FROM daily_report WHERE id = ?", id)!;
}

export function reportFor(childId: string, reportDate: string): Row | undefined {
  return one(
    getDb(),
    "SELECT * FROM daily_report WHERE child_id = ? AND report_date = ?",
    childId,
    reportDate
  );
}

export function recentReports(instituteId: string, limit = 50): Row[] {
  return all(
    getDb(),
    `SELECT dr.*, c.first_name, c.last_name FROM daily_report dr
     JOIN child c ON c.id = dr.child_id
     WHERE c.institute_id = ?
     ORDER BY dr.report_date DESC, dr.created_at DESC LIMIT ?`,
    instituteId,
    limit
  );
}

// ---------- Newsfeed ----------
export function createNewsfeedPost(data: {
  instituteId: string;
  accountId: string;
  body: string;
  mediaUrl?: string;
  tagChildIds?: string[];
}): Row {
  const db = getDb();
  const id = uid();
  db.prepare(
    "INSERT INTO newsfeed_post (id, institute_id, account_id, body, media_url) VALUES (?, ?, ?, ?, ?)"
  ).run(id, data.instituteId, data.accountId, data.body, data.mediaUrl ?? null);
  for (const cid of data.tagChildIds ?? []) {
    db.prepare("INSERT OR IGNORE INTO newsfeed_tag (post_id, child_id) VALUES (?, ?)").run(id, cid);
  }
  return one(db, "SELECT * FROM newsfeed_post WHERE id = ?", id)!;
}

export function listNewsfeed(instituteId: string, forAccountId?: string): Row[] {
  const db = getDb();
  const rows = all(
    db,
    `SELECT p.*, a.full_name AS author_name, a.role AS author_role,
            (SELECT COUNT(*) FROM newsfeed_like l WHERE l.post_id = p.id) AS like_count,
            (SELECT COUNT(*) FROM newsfeed_comment c WHERE c.post_id = p.id) AS comment_count,
            EXISTS(SELECT 1 FROM newsfeed_like l WHERE l.post_id = p.id AND l.account_id = ?) AS liked
     FROM newsfeed_post p
     JOIN account a ON a.id = p.account_id
     WHERE p.institute_id = ?
     ORDER BY p.created_at DESC`,
    forAccountId ?? "",
    instituteId
  );
  return rows.map((row) => {
    const tags = all(db, `SELECT c.id, c.first_name, c.last_name FROM newsfeed_tag t JOIN child c ON c.id = t.child_id WHERE t.post_id = ?`, row.id);
    const comments = all(db, `SELECT c.*, a.full_name FROM newsfeed_comment c JOIN account a ON a.id = c.account_id WHERE c.post_id = ? ORDER BY c.created_at ASC`, row.id);
    return { ...row, tags, comments };
  });
}

export function newsfeedForChild(childId: string): Row[] {
  const db = getDb();
  return all(
    db,
    `SELECT p.*, a.full_name AS author_name
     FROM newsfeed_post p
     JOIN newsfeed_tag t ON t.post_id = p.id
     JOIN account a ON a.id = p.account_id
     WHERE t.child_id = ?
     ORDER BY p.created_at DESC`,
    childId
  );
}

export function toggleLike(postId: string, accountId: string): { liked: boolean } {
  const db = getDb();
  const existing = one(db, "SELECT * FROM newsfeed_like WHERE post_id = ? AND account_id = ?", postId, accountId);
  if (existing) {
    db.prepare("DELETE FROM newsfeed_like WHERE post_id = ? AND account_id = ?").run(postId, accountId);
    return { liked: false };
  }
  db.prepare("INSERT INTO newsfeed_like (post_id, account_id) VALUES (?, ?)").run(postId, accountId);
  return { liked: true };
}

export function addComment(postId: string, accountId: string, body: string): Row {
  const db = getDb();
  const id = uid();
  db.prepare("INSERT INTO newsfeed_comment (id, post_id, account_id, body) VALUES (?, ?, ?, ?)").run(
    id,
    postId,
    accountId,
    body
  );
  return one(db, "SELECT * FROM newsfeed_comment WHERE id = ?", id)!;
}

// ---------- Messaging ----------
export function sendMessage(data: {
  instituteId: string;
  senderAccountId: string;
  recipientAccountId: string;
  body: string;
}): Row {
  const db = getDb();
  const id = uid();
  db.prepare(
    "INSERT INTO message (id, institute_id, sender_account_id, recipient_account_id, body) VALUES (?, ?, ?, ?, ?)"
  ).run(id, data.instituteId, data.senderAccountId, data.recipientAccountId, data.body);
  return one(db, "SELECT * FROM message WHERE id = ?", id)!;
}

export function conversation(a: string, b: string): Row[] {
  return all(
    getDb(),
    `SELECT m.*, ac.full_name AS from_name, sc.full_name AS to_name
     FROM message m
     JOIN account ac ON ac.id = m.sender_account_id
     JOIN account sc ON sc.id = m.recipient_account_id
     WHERE (m.sender_account_id = ? AND m.recipient_account_id = ?)
        OR (m.sender_account_id = ? AND m.recipient_account_id = ?)
     ORDER BY m.created_at ASC`,
    a,
    b,
    b,
    a
  );
}

export function markRead(otherAccountId: string, me: string): void {
  getDb()
    .prepare("UPDATE message SET read = 1 WHERE sender_account_id = ? AND recipient_account_id = ?")
    .run(otherAccountId, me);
}

// ---------- Media ----------
export function addMedia(data: {
  instituteId: string;
  url: string;
  kind?: string;
  caption?: string;
  childId?: string;
  accountId?: string;
}): Row {
  const db = getDb();
  const id = uid();
  db.prepare(
    "INSERT INTO media (id, institute_id, url, kind, caption, child_id, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, data.instituteId, data.url, data.kind ?? "image", data.caption ?? null, data.childId ?? null, data.accountId ?? null);
  return one(db, "SELECT * FROM media WHERE id = ?", id)!;
}

export function listMedia(instituteId: string, childId?: string): Row[] {
  const db = getDb();
  if (childId) {
    return all(db, "SELECT * FROM media WHERE institute_id = ? AND child_id = ? ORDER BY created_at DESC", instituteId, childId);
  }
  return all(db, "SELECT * FROM media WHERE institute_id = ? ORDER BY created_at DESC", instituteId);
}

// ---------- Consents ----------
export function createConsent(data: {
  instituteId: string;
  title: string;
  body?: string;
  childId?: string;
}): Row {
  const db = getDb();
  const id = uid();
  db.prepare(
    "INSERT INTO consent_request (id, institute_id, title, body, child_id) VALUES (?, ?, ?, ?, ?)"
  ).run(id, data.instituteId, data.title, data.body ?? "", data.childId ?? null);
  return one(db, "SELECT * FROM consent_request WHERE id = ?", id)!;
}

export function respondConsent(id: string, status: "approved" | "denied"): void {
  getDb().prepare("UPDATE consent_request SET status = ? WHERE id = ?").run(status, id);
}

export function listConsents(instituteId: string): Row[] {
  return all(getDb(), "SELECT * FROM consent_request WHERE institute_id = ? ORDER BY created_at DESC", instituteId);
}

// ---------- Incidents ----------
export function createIncident(data: {
  instituteId: string;
  childId: string;
  accountId: string;
  type?: string;
  description: string;
}): Row {
  const db = getDb();
  const id = uid();
  db.prepare(
    "INSERT INTO incident_report (id, institute_id, child_id, account_id, type, description) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, data.instituteId, data.childId, data.accountId, data.type ?? "incident", data.description);
  return one(db, "SELECT * FROM incident_report WHERE id = ?", id)!;
}

export function acknowledgeIncident(id: string): void {
  getDb().prepare("UPDATE incident_report SET acknowledged = 1 WHERE id = ?").run(id);
}

export function listIncidents(instituteId: string): Row[] {
  return all(
    getDb(),
    `SELECT ir.*, c.first_name, c.last_name, a.full_name AS reported_by
     FROM incident_report ir
     JOIN child c ON c.id = ir.child_id
     JOIN account a ON a.id = ir.account_id
     WHERE ir.institute_id = ?
     ORDER BY ir.created_at DESC`,
    instituteId
  );
}

export function incidentsForChild(childId: string): Row[] {
  return all(
    getDb(),
    `SELECT ir.*, c.first_name, c.last_name FROM incident_report ir
     JOIN child c ON c.id = ir.child_id
     WHERE ir.child_id = ? ORDER BY ir.created_at DESC`,
    childId
  );
}
