import { queryAll, queryGet, queryRun, uid, type Row } from "./db";

// ---------- Institute / branding (white-label) ----------
export async function getInstitute(instituteId: string): Promise<Row | undefined> {
  return queryGet("SELECT * FROM institute WHERE id = ?", instituteId);
}

export async function listInstitutes(): Promise<Row[]> {
  return queryAll("SELECT * FROM institute ORDER BY name");
}

export async function seedInstitute(data: {
  name: string;
  primaryColor?: string;
  accentColor?: string;
  font?: string;
  openingHours?: Record<string, string>;
  closingDays?: string[];
}): Promise<Row> {
  const id = uid();
  await queryRun(
    `INSERT INTO institute (id, name, primary_color, accent_color, font, opening_hours, closing_days)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.name,
    data.primaryColor ?? "#3B82F6",
    data.accentColor ?? "#10B981",
    data.font ?? "Inter",
    JSON.stringify(data.openingHours ?? {}),
    JSON.stringify(data.closingDays ?? [])
  );
  return (await getInstitute(id))!;
}

export async function updateInstitute(instituteId: string, patch: Record<string, unknown>): Promise<void> {
  const fields = Object.keys(patch)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = Object.values(patch);
  values.push(instituteId);
  await queryRun(`UPDATE institute SET ${fields} WHERE id = ?`, ...values);
}

// ---------- Rooms ----------
export async function listRooms(instituteId: string): Promise<Row[]> {
  return queryAll("SELECT * FROM room WHERE institute_id = ? ORDER BY name", instituteId);
}

export async function createRoom(instituteId: string, name: string, capacity?: number): Promise<Row> {
  const id = uid();
  await queryRun("INSERT INTO room (id, institute_id, name, capacity) VALUES (?, ?, ?, ?)", id, instituteId, name, capacity ?? null);
  return (await queryGet("SELECT * FROM room WHERE id = ?", id))!;
}

// ---------- Staff ----------
export async function listStaff(instituteId: string): Promise<Row[]> {
  return queryAll("SELECT * FROM staff WHERE institute_id = ? ORDER BY full_name", instituteId);
}

export async function createStaff(data: {
  instituteId: string;
  fullName: string;
  role: string;
  roomIds?: string[];
}): Promise<Row> {
  const id = uid();
  await queryRun("INSERT INTO staff (id, institute_id, full_name, role) VALUES (?, ?, ?, ?)", id, data.instituteId, data.fullName, data.role);
  for (const roomId of data.roomIds ?? []) {
    await queryRun("INSERT INTO staff_room (staff_id, room_id) VALUES (?, ?) ON CONFLICT DO NOTHING", id, roomId);
  }
  return (await queryGet("SELECT * FROM staff WHERE id = ?", id))!;
}

export async function staffRooms(staffId: string): Promise<Row[]> {
  return queryAll(
    `SELECT r.* FROM room r JOIN staff_room sr ON sr.room_id = r.id WHERE sr.staff_id = ? ORDER BY r.name`,
    staffId
  );
}

// ---------- Children ----------
export async function createChild(data: {
  instituteId: string;
  firstName: string;
  lastName: string;
  dob?: string;
  roomId?: string;
  branchId?: string;
  allergies?: string;
  conditions?: string;
  healthNotes?: string;
}): Promise<Row> {
  const childId = uid();
  await queryRun(
    `INSERT INTO child (id, institute_id, branch_id, room_id, first_name, last_name, dob)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    childId,
    data.instituteId,
    data.branchId ?? null,
    data.roomId ?? null,
    data.firstName,
    data.lastName,
    data.dob ?? null
  );
  await queryRun("INSERT INTO enrollment (id, child_id) VALUES (?, ?)", uid(), childId);
  await queryRun(
    "INSERT INTO child_health (id, child_id, allergies, conditions, notes) VALUES (?, ?, ?, ?, ?)",
    uid(),
    childId,
    data.allergies ?? "",
    data.conditions ?? "",
    data.healthNotes ?? ""
  );
  return (await queryGet("SELECT * FROM child WHERE id = ?", childId))!;
}

export async function listChildren(instituteId: string): Promise<Row[]> {
  return queryAll(
    `SELECT c.*, r.name AS room_name, h.allergies, h.conditions, h.notes
     FROM child c
     LEFT JOIN room r ON r.id = c.room_id
     LEFT JOIN child_health h ON h.child_id = c.id
     WHERE c.institute_id = ? AND c.active = 1
     ORDER BY c.first_name, c.last_name`,
    instituteId
  );
}

export async function getChild(childId: string): Promise<Row | undefined> {
  return queryGet("SELECT * FROM child WHERE id = ?", childId);
}

export async function addContact(data: {
  childId: string;
  fullName: string;
  relationship: string;
  phone?: string;
  email?: string;
  isPickup: boolean;
  isEmergency: boolean;
}): Promise<Row> {
  const id = uid();
  await queryRun(
    `INSERT INTO contact (id, child_id, full_name, relationship, phone, email, is_pickup, is_emergency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.childId,
    data.fullName,
    data.relationship,
    data.phone ?? null,
    data.email ?? null,
    data.isPickup ? 1 : 0,
    data.isEmergency ? 1 : 0
  );
  return (await queryGet("SELECT * FROM contact WHERE id = ?", id))!;
}

export async function listContacts(childId: string): Promise<Row[]> {
  return queryAll("SELECT * FROM contact WHERE child_id = ? ORDER BY full_name", childId);
}

// ---------- Parent linking / invites ----------
export async function createInvite(instituteId: string, childId: string | null, email: string, code: string): Promise<Row> {
  const id = uid();
  await queryRun("INSERT INTO invite (id, institute_id, child_id, email, code) VALUES (?, ?, ?, ?, ?)", id, instituteId, childId, email.toLowerCase(), code);
  return (await queryGet("SELECT * FROM invite WHERE id = ?", id))!;
}

export async function getInviteByCode(code: string): Promise<Row | undefined> {
  return queryGet("SELECT * FROM invite WHERE code = ?", code);
}

export async function linkFamily(accountId: string, childId: string): Promise<void> {
  await queryRun("INSERT INTO family_member (id, account_id, child_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", uid(), accountId, childId);
}

export async function familiesForAccount(accountId: string): Promise<Row[]> {
  return queryAll(
    `SELECT c.*, r.name AS room_name, fm.role AS link_role
     FROM family_member fm
     JOIN child c ON c.id = fm.child_id
     LEFT JOIN room r ON r.id = c.room_id
     WHERE fm.account_id = ? AND c.active = 1`,
    accountId
  );
}

// ---------- Check-in / attendance (daily loop) ----------
export async function checkChildInOut(data: {
  childId: string;
  accountId: string;
  type: "in" | "out";
  isEdit?: boolean;
}): Promise<Row> {
  const id = uid();
  await queryRun("INSERT INTO check_in (id, child_id, account_id, type, is_edit) VALUES (?, ?, ?, ?, ?)", id, data.childId, data.accountId, data.type, data.isEdit ? 1 : 0);
  return (await queryGet("SELECT * FROM check_in WHERE id = ?", id))!;
}

export async function todayStatus(childId: string): Promise<{ checkedIn?: Row; checkedOut?: Row; lastEvent?: Row }> {
  const today = new Date().toISOString().slice(0, 10);
  const latest = await queryAll(
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

export async function attendanceOn(instituteId: string, day: string): Promise<Row[]> {
  return queryAll(
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
export async function upsertDailyReport(data: {
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
}): Promise<Row> {
  const existing = await queryGet(
    "SELECT * FROM daily_report WHERE child_id = ? AND report_date = ?",
    data.childId,
    data.reportDate
  );
  if (existing) {
    await queryRun(
      `UPDATE daily_report SET summary=?, observation=?, mood=?, meal=?, sleep=?, diaper=?, sick=?, note=?
       WHERE id = ?`,
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
    return (await queryGet("SELECT * FROM daily_report WHERE id = ?", existing.id))!;
  }
  const id = uid();
  await queryRun(
    `INSERT INTO daily_report (id, child_id, report_date, summary, observation, mood, meal, sleep, diaper, sick, note, created_by_account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  return (await queryGet("SELECT * FROM daily_report WHERE id = ?", id))!;
}

export async function reportFor(childId: string, reportDate: string): Promise<Row | undefined> {
  return queryGet(
    "SELECT * FROM daily_report WHERE child_id = ? AND report_date = ?",
    childId,
    reportDate
  );
}

export async function recentReports(instituteId: string, limit = 50): Promise<Row[]> {
  return queryAll(
    `SELECT dr.*, c.first_name, c.last_name FROM daily_report dr
     JOIN child c ON c.id = dr.child_id
     WHERE c.institute_id = ?
     ORDER BY dr.report_date DESC, dr.created_at DESC LIMIT ?`,
    instituteId,
    limit
  );
}

// ---------- Newsfeed ----------
export async function createNewsfeedPost(data: {
  instituteId: string;
  accountId: string;
  body: string;
  mediaUrl?: string;
  tagChildIds?: string[];
}): Promise<Row> {
  const id = uid();
  await queryRun(
    "INSERT INTO newsfeed_post (id, institute_id, account_id, body, media_url) VALUES (?, ?, ?, ?, ?)",
    id,
    data.instituteId,
    data.accountId,
    data.body,
    data.mediaUrl ?? null
  );
  for (const cid of data.tagChildIds ?? []) {
    await queryRun("INSERT INTO newsfeed_tag (post_id, child_id) VALUES (?, ?) ON CONFLICT DO NOTHING", id, cid);
  }
  return (await queryGet("SELECT * FROM newsfeed_post WHERE id = ?", id))!;
}

export async function listNewsfeed(instituteId: string, forAccountId?: string): Promise<Row[]> {
  const rows = await queryAll(
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
  const results: Row[] = [];
  for (const row of rows) {
    const tags = await queryAll(`SELECT c.id, c.first_name, c.last_name FROM newsfeed_tag t JOIN child c ON c.id = t.child_id WHERE t.post_id = ?`, row.id);
    const comments = await queryAll(`SELECT c.*, a.full_name FROM newsfeed_comment c JOIN account a ON a.id = c.account_id WHERE c.post_id = ? ORDER BY c.created_at ASC`, row.id);
    results.push({ ...row, tags, comments });
  }
  return results;
}

export async function newsfeedForChild(childId: string): Promise<Row[]> {
  return queryAll(
    `SELECT p.*, a.full_name AS author_name
     FROM newsfeed_post p
     JOIN newsfeed_tag t ON t.post_id = p.id
     JOIN account a ON a.id = p.account_id
     WHERE t.child_id = ?
     ORDER BY p.created_at DESC`,
    childId
  );
}

export async function toggleLike(postId: string, accountId: string): Promise<{ liked: boolean }> {
  const existing = await queryGet("SELECT * FROM newsfeed_like WHERE post_id = ? AND account_id = ?", postId, accountId);
  if (existing) {
    await queryRun("DELETE FROM newsfeed_like WHERE post_id = ? AND account_id = ?", postId, accountId);
    return { liked: false };
  }
  await queryRun("INSERT INTO newsfeed_like (post_id, account_id) VALUES (?, ?) ON CONFLICT DO NOTHING", postId, accountId);
  return { liked: true };
}

export async function addComment(postId: string, accountId: string, body: string): Promise<Row> {
  const id = uid();
  await queryRun("INSERT INTO newsfeed_comment (id, post_id, account_id, body) VALUES (?, ?, ?, ?)", id, postId, accountId, body);
  return (await queryGet("SELECT * FROM newsfeed_comment WHERE id = ?", id))!;
}

// ---------- Messaging ----------
export async function sendMessage(data: {
  instituteId: string;
  senderAccountId: string;
  recipientAccountId: string;
  body: string;
}): Promise<Row> {
  const id = uid();
  await queryRun(
    "INSERT INTO message (id, institute_id, sender_account_id, recipient_account_id, body) VALUES (?, ?, ?, ?, ?)",
    id,
    data.instituteId,
    data.senderAccountId,
    data.recipientAccountId,
    data.body
  );
  return (await queryGet("SELECT * FROM message WHERE id = ?", id))!;
}

export async function conversation(a: string, b: string): Promise<Row[]> {
  return queryAll(
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

export async function markRead(otherAccountId: string, me: string): Promise<void> {
  await queryRun("UPDATE message SET read = 1 WHERE sender_account_id = ? AND recipient_account_id = ?", otherAccountId, me);
}

// ---------- Media ----------
export async function addMedia(data: {
  instituteId: string;
  url: string;
  kind?: string;
  caption?: string;
  childId?: string;
  accountId?: string;
}): Promise<Row> {
  const id = uid();
  await queryRun(
    "INSERT INTO media (id, institute_id, url, kind, caption, child_id, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    data.instituteId,
    data.url,
    data.kind ?? "image",
    data.caption ?? null,
    data.childId ?? null,
    data.accountId ?? null
  );
  return (await queryGet("SELECT * FROM media WHERE id = ?", id))!;
}

export async function listMedia(instituteId: string, childId?: string): Promise<Row[]> {
  if (childId) {
    return queryAll("SELECT * FROM media WHERE institute_id = ? AND child_id = ? ORDER BY created_at DESC", instituteId, childId);
  }
  return queryAll("SELECT * FROM media WHERE institute_id = ? ORDER BY created_at DESC", instituteId);
}

// ---------- Consents ----------
export async function createConsent(data: {
  instituteId: string;
  title: string;
  body?: string;
  childId?: string;
}): Promise<Row> {
  const id = uid();
  await queryRun(
    "INSERT INTO consent_request (id, institute_id, title, body, child_id) VALUES (?, ?, ?, ?, ?)",
    id,
    data.instituteId,
    data.title,
    data.body ?? "",
    data.childId ?? null
  );
  return (await queryGet("SELECT * FROM consent_request WHERE id = ?", id))!;
}

export async function respondConsent(id: string, status: "approved" | "denied"): Promise<void> {
  await queryRun("UPDATE consent_request SET status = ? WHERE id = ?", status, id);
}

export async function listConsents(instituteId: string): Promise<Row[]> {
  return queryAll("SELECT * FROM consent_request WHERE institute_id = ? ORDER BY created_at DESC", instituteId);
}

// ---------- Incidents ----------
export async function createIncident(data: {
  instituteId: string;
  childId: string;
  accountId: string;
  type?: string;
  description: string;
}): Promise<Row> {
  const id = uid();
  await queryRun(
    "INSERT INTO incident_report (id, institute_id, child_id, account_id, type, description) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    data.instituteId,
    data.childId,
    data.accountId,
    data.type ?? "incident",
    data.description
  );
  return (await queryGet("SELECT * FROM incident_report WHERE id = ?", id))!;
}

export async function acknowledgeIncident(id: string): Promise<void> {
  await queryRun("UPDATE incident_report SET acknowledged = 1 WHERE id = ?", id);
}

export async function listIncidents(instituteId: string): Promise<Row[]> {
  return queryAll(
    `SELECT ir.*, c.first_name, c.last_name, a.full_name AS reported_by
     FROM incident_report ir
     JOIN child c ON c.id = ir.child_id
     JOIN account a ON a.id = ir.account_id
     WHERE ir.institute_id = ?
     ORDER BY ir.created_at DESC`,
    instituteId
  );
}

export async function incidentsForChild(childId: string): Promise<Row[]> {
  return queryAll(
    `SELECT ir.*, c.first_name, c.last_name FROM incident_report ir
     JOIN child c ON c.id = ir.child_id
     WHERE ir.child_id = ? ORDER BY ir.created_at DESC`,
    childId
  );
}

// ---------- Marketing / contact (M6) ----------
export async function createContactRequest(data: {
  name: string;
  email: string;
  phone?: string;
  role?: string;
  interest?: string;
  message?: string;
}): Promise<Row> {
  const id = uid();
  await queryRun(
    `INSERT INTO contact_request (id, name, email, phone, role, interest, message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.name,
    data.email.toLowerCase(),
    data.phone ?? null,
    data.role ?? "parent",
    data.interest ?? "demo",
    data.message ?? null
  );
  return (await queryGet("SELECT * FROM contact_request WHERE id = ?", id))!;
}

// ---------- T5 / M5 extra kept areas ----------
// All tables are guaranteed by ensureSchema (0003 migration on Postgres, the
// sqlite-schema.ts mirror locally), so the fn() pattern stays simple.

// ---- Events & Video ----
export async function createEvent(data: {
  instituteId: string;
  title: string;
  eventDate: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  description?: string;
  accountId?: string;
}): Promise<Row> {
  const id = uid();
  await queryRun(
    `INSERT INTO event (id, institute_id, title, event_date, start_time, end_time, location, description, created_by_account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.instituteId,
    data.title,
    data.eventDate,
    data.startTime ?? null,
    data.endTime ?? null,
    data.location ?? null,
    data.description ?? "",
    data.accountId ?? null
  );
  return (await queryGet("SELECT * FROM event WHERE id = ?", id))!;
}

export async function listEvents(instituteId: string, upcoming = false): Promise<Row[]> {
  const today = new Date().toISOString().slice(0, 10);
  const args: unknown[] = [instituteId];
  if (upcoming) args.push(today);
  return queryAll(
    `SELECT e.*, a.full_name AS created_by_name,
            (SELECT COUNT(*) FROM media_event me JOIN media m ON m.id = me.media_id WHERE me.event_id = e.id) AS media_count
     FROM event e
     LEFT JOIN account a ON a.id = e.created_by_account_id
     WHERE e.institute_id = ? ${upcoming ? "AND e.event_date >= ?" : ""}
     ORDER BY e.event_date ASC, e.start_time ASC`,
    ...args
  );
}

export async function eventMedia(eventId: string): Promise<Row[]> {
  return queryAll(
    `SELECT m.* FROM media m JOIN media_event me ON me.media_id = m.id
     WHERE me.event_id = ? ORDER BY m.created_at ASC`,
    eventId
  );
}

export async function addEventMedia(data: {
  eventId: string;
  instituteId: string;
  url: string;
  kind?: string;
  caption?: string;
  accountId?: string;
}): Promise<Row> {
  const media = await addMedia({
    instituteId: data.instituteId,
    url: data.url,
    kind: data.kind ?? "image",
    caption: data.caption ?? undefined,
    accountId: data.accountId,
  });
  await queryRun("INSERT INTO media_event (event_id, media_id) VALUES (?, ?) ON CONFLICT DO NOTHING", data.eventId, media.id);
  return media;
}

export async function listVideos(instituteId: string): Promise<Row[]> {
  return queryAll(
    `SELECT m.*, c.first_name, c.last_name FROM media m
     LEFT JOIN child c ON c.id = m.child_id
     WHERE m.institute_id = ? AND m.kind = 'video' ORDER BY m.created_at DESC`,
    instituteId
  );
}

// ---- Forms / Lists / Surveys ----
export async function createForm(data: {
  instituteId: string;
  kind?: string;
  title: string;
  description?: string;
  fieldsJson?: string;
  accountId?: string;
}): Promise<Row> {
  const id = uid();
  await queryRun(
    `INSERT INTO form_template (id, institute_id, kind, title, description, fields_json, created_by_account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.instituteId,
    data.kind ?? "form",
    data.title,
    data.description ?? "",
    data.fieldsJson ?? "[]",
    data.accountId ?? null
  );
  return (await queryGet("SELECT * FROM form_template WHERE id = ?", id))!;
}

export async function listForms(instituteId: string, kind?: string): Promise<Row[]> {
  const args: unknown[] = [instituteId];
  if (kind) args.push(kind);
  return queryAll(
    `SELECT f.*, a.full_name AS created_by_name,
            (SELECT COUNT(*) FROM form_response fr WHERE fr.form_id = f.id) AS response_count
     FROM form_template f
     LEFT JOIN account a ON a.id = f.created_by_account_id
     WHERE f.institute_id = ? ${kind ? "AND f.kind = ?" : ""}
     ORDER BY f.created_at DESC`,
    ...args
  );
}

export async function getForm(formId: string): Promise<Row | undefined> {
  return queryGet("SELECT * FROM form_template WHERE id = ?", formId);
}

export async function saveFormResponse(data: {
  formId: string;
  accountId?: string;
  childId?: string;
  answersJson: string;
}): Promise<Row> {
  const id = uid();
  await queryRun(
    `INSERT INTO form_response (id, form_id, account_id, child_id, answers_json) VALUES (?, ?, ?, ?, ?)`,
    id,
    data.formId,
    data.accountId ?? null,
    data.childId ?? null,
    data.answersJson
  );
  return (await queryGet("SELECT * FROM form_response WHERE id = ?", id))!;
}

export async function formResponses(formId: string): Promise<Row[]> {
  return queryAll(
    `SELECT fr.*, a.full_name AS respondent_name, c.first_name, c.last_name
     FROM form_response fr
     LEFT JOIN account a ON a.id = fr.account_id
     LEFT JOIN child c ON c.id = fr.child_id
     WHERE fr.form_id = ? ORDER BY fr.created_at DESC`,
    formId
  );
}

export async function responsesByAccount(accountId: string): Promise<Row[]> {
  return queryAll(
    `SELECT fr.*, f.title AS form_title, f.kind FROM form_response fr
     JOIN form_template f ON f.id = fr.form_id
     WHERE fr.account_id = ? ORDER BY fr.created_at DESC`,
    accountId
  );
}

// ---- Tags ----
export async function createTag(instituteId: string, name: string, color?: string): Promise<Row> {
  const id = uid();
  await queryRun("INSERT INTO tag (id, institute_id, name, color) VALUES (?, ?, ?, ?)", id, instituteId, name, color ?? "#3B82F6");
  return (await queryGet("SELECT * FROM tag WHERE id = ?", id))!;
}

export async function listTags(instituteId: string): Promise<Row[]> {
  return queryAll(
    `SELECT t.*, (SELECT COUNT(*) FROM child_tag ct WHERE ct.tag_id = t.id) AS child_count
     FROM tag t WHERE t.institute_id = ? ORDER BY t.name`,
    instituteId
  );
}

export async function tagsForChild(childId: string): Promise<Row[]> {
  return queryAll(
    `SELECT t.* FROM tag t JOIN child_tag ct ON ct.tag_id = t.id
     WHERE ct.child_id = ? ORDER BY t.name`,
    childId
  );
}

export async function setChildTags(childId: string, tagIds: string[]): Promise<void> {
  await queryRun("DELETE FROM child_tag WHERE child_id = ?", childId);
  for (const tagId of tagIds) {
    await queryRun("INSERT INTO child_tag (tag_id, child_id) VALUES (?, ?) ON CONFLICT DO NOTHING", tagId, childId);
  }
}

// ---- Parent Drive ----
export async function addDriveFile(data: {
  instituteId: string;
  filename: string;
  url: string;
  kind?: string;
  sizeBytes?: number;
  description?: string;
  childId?: string;
  accountId?: string;
}): Promise<Row> {
  const id = uid();
  await queryRun(
    `INSERT INTO drive_file (id, institute_id, filename, url, kind, size_bytes, description, child_id, uploaded_by_account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.instituteId,
    data.filename,
    data.url,
    data.kind ?? "file",
    data.sizeBytes ?? null,
    data.description ?? "",
    data.childId ?? null,
    data.accountId ?? null
  );
  return (await queryGet("SELECT * FROM drive_file WHERE id = ?", id))!;
}

export async function listDriveFiles(instituteId: string): Promise<Row[]> {
  return queryAll(
    `SELECT d.*, c.first_name, c.last_name, a.full_name AS uploaded_by
     FROM drive_file d
     LEFT JOIN child c ON c.id = d.child_id
     LEFT JOIN account a ON a.id = d.uploaded_by_account_id
     WHERE d.institute_id = ? ORDER BY d.created_at DESC`,
    instituteId
  );
}

export async function driveFilesFor(instituteId: string, childId?: string): Promise<Row[]> {
  if (childId) {
    return queryAll(
      `SELECT d.*, c.first_name, c.last_name FROM drive_file d
       LEFT JOIN child c ON c.id = d.child_id
       WHERE d.institute_id = ? AND (d.child_id IS NULL OR d.child_id = ?)
       ORDER BY d.created_at DESC`,
      instituteId,
      childId
    );
  }
  return queryAll(
    `SELECT d.* FROM drive_file d WHERE d.institute_id = ? ORDER BY d.created_at DESC`,
    instituteId
  );
}

// ---- Learning & observations ----
export async function createObservation(data: {
  instituteId: string;
  childId: string;
  accountId?: string;
  kind?: string;
  title?: string;
  body: string;
  recordedAt?: string;
}): Promise<Row> {
  const id = uid();
  await queryRun(
    `INSERT INTO learning_observation (id, institute_id, child_id, account_id, kind, title, body, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.instituteId,
    data.childId,
    data.accountId ?? null,
    data.kind ?? "observation",
    data.title ?? null,
    data.body,
    data.recordedAt ?? null
  );
  return (await queryGet("SELECT * FROM learning_observation WHERE id = ?", id))!;
}

export async function observationsForChild(childId: string): Promise<Row[]> {
  return queryAll(
    `SELECT o.*, a.full_name AS recorded_by
     FROM learning_observation o
     LEFT JOIN account a ON a.id = o.account_id
     WHERE o.child_id = ? ORDER BY o.recorded_at DESC, o.created_at DESC`,
    childId
  );
}

export async function listObservations(instituteId: string): Promise<Row[]> {
  return queryAll(
    `SELECT o.*, c.first_name, c.last_name, a.full_name AS recorded_by
     FROM learning_observation o
     JOIN child c ON c.id = o.child_id
     LEFT JOIN account a ON a.id = o.account_id
     WHERE o.institute_id = ? ORDER BY o.recorded_at DESC, o.created_at DESC`,
    instituteId
  );
}

// ---- Support ----
export async function createSupportTicket(data: {
  instituteId: string;
  accountId?: string;
  subject: string;
  body: string;
}): Promise<Row> {
  const id = uid();
  await queryRun(
    `INSERT INTO support_ticket (id, institute_id, account_id, subject, body) VALUES (?, ?, ?, ?, ?)`,
    id,
    data.instituteId,
    data.accountId ?? null,
    data.subject,
    data.body
  );
  return (await queryGet("SELECT * FROM support_ticket WHERE id = ?", id))!;
}

export async function listSupportTickets(instituteId: string): Promise<Row[]> {
  return queryAll(
    `SELECT t.*, a.full_name AS author_name FROM support_ticket t
     LEFT JOIN account a ON a.id = t.account_id
     WHERE t.institute_id = ? ORDER BY t.created_at DESC`,
    instituteId
  );
}

export async function ticketsForAccount(accountId: string): Promise<Row[]> {
  return queryAll(
    `SELECT t.*, i.name AS institute_name FROM support_ticket t
     LEFT JOIN institute i ON i.id = t.institute_id
     WHERE t.account_id = ? ORDER BY t.created_at DESC`,
    accountId
  );
}

export async function setTicketStatus(ticketId: string, status: string): Promise<void> {
  await queryRun("UPDATE support_ticket SET status = ? WHERE id = ?", status, ticketId);
}

// ---- Live chat / messaging helpers ----
export async function conversationsForAccount(accountId: string): Promise<Row[]> {
  return queryAll(
    `SELECT DISTINCT other.id AS other_account_id, other.full_name AS other_name, other.role AS other_role,
            (SELECT body FROM message WHERE (sender_account_id = ? AND recipient_account_id = other.id)
              OR (sender_account_id = other.id AND recipient_account_id = ?)
             ORDER BY message.created_at DESC LIMIT 1) AS last_message,
            (SELECT created_at FROM message WHERE (sender_account_id = ? AND recipient_account_id = other.id)
              OR (sender_account_id = other.id AND recipient_account_id = ?)
             ORDER BY message.created_at DESC LIMIT 1) AS last_at
     FROM account other
     WHERE other.id != ? AND EXISTS (
       SELECT 1 FROM message m
       WHERE (m.sender_account_id = ? AND m.recipient_account_id = other.id)
          OR (m.sender_account_id = other.id AND m.recipient_account_id = ?))
     ORDER BY last_at DESC`,
    accountId,
    accountId,
    accountId,
    accountId,
    accountId,
    accountId,
    accountId
  );
}

export async function centerContactAccount(instituteId: string): Promise<Row | undefined> {
  // MVP live-chat: parents talk to the daycare's owner/admin account.
  return queryGet(
    `SELECT a.id, a.email, a.full_name FROM account a
     WHERE a.role = 'owner' OR (a.role = 'admin' AND a.staff_id IS NOT NULL)
     ORDER BY a.created_at LIMIT 1`
  );
}

export async function parentAccounts(instituteId: string): Promise<Row[]> {
  return queryAll(
    `SELECT DISTINCT a.id, a.email, a.full_name
     FROM account a
     JOIN family_member fm ON fm.account_id = a.id
     JOIN child c ON c.id = fm.child_id
     WHERE c.institute_id = ? AND a.role = 'parent'
     ORDER BY a.full_name`,
    instituteId
  );
}

// ---- Report Center analytics ----
export async function reportCenterStats(instituteId: string): Promise<Row> {
  const children = await listChildren(instituteId);
  const active = children.length;
  const reports = await queryGet(
    "SELECT COUNT(*) c FROM daily_report dr JOIN child c ON c.id = dr.child_id WHERE c.institute_id = ?",
    instituteId
  );
  const checkIns = await queryGet(
    "SELECT COUNT(*) c FROM check_in ci JOIN child c ON c.id = ci.child_id WHERE c.institute_id = ? AND ci.type = 'in'",
    instituteId
  );
  const newsfeed = await queryGet("SELECT COUNT(*) c FROM newsfeed_post WHERE institute_id = ?", instituteId);
  const media = await queryGet("SELECT COUNT(*) c FROM media WHERE institute_id = ?", instituteId);
  const incidents = await queryGet(
    "SELECT COUNT(*) c FROM incident_report ir JOIN child c ON c.id = ir.child_id WHERE c.institute_id = ?",
    instituteId
  );
  const observations = await queryGet(
    "SELECT COUNT(*) c FROM learning_observation o JOIN child c ON c.id = o.child_id WHERE c.institute_id = ?",
    instituteId
  );
  const consents = await queryGet(
    "SELECT COUNT(*) c FROM consent_request WHERE institute_id = ? AND status != 'pending'",
    instituteId
  );
  return {
    childrenCount: active,
    reportsCount: (reports?.c as number) ?? 0,
    checkInsCount: (checkIns?.c as number) ?? 0,
    newsfeedCount: (newsfeed?.c as number) ?? 0,
    mediaCount: (media?.c as number) ?? 0,
    incidentCount: (incidents?.c as number) ?? 0,
    observationCount: (observations?.c as number) ?? 0,
    consentsAnswered: (consents?.c as number) ?? 0,
  };
}

export async function staffPerformance(instituteId: string): Promise<Row[]> {
  return queryAll(
    `SELECT a.id AS account_id, a.full_name AS name, a.role,
       (SELECT COUNT(*) FROM daily_report dr WHERE dr.created_by_account_id = a.id) AS reports_authored,
       (SELECT COUNT(*) FROM check_in ci WHERE ci.account_id = a.id) AS check_ins,
       (SELECT COUNT(*) FROM incident_report ir WHERE ir.account_id = a.id) AS incidents_logged,
       (SELECT COUNT(*) FROM learning_observation o WHERE o.account_id = a.id) AS observations
     FROM account a
     WHERE a.role IN ('owner','staff','carer','admin')
     ORDER BY reports_authored DESC, a.full_name`
  );
}