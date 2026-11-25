// KID-2478: superadmin bulk upload.
//
// The platform operator downloads one of two English-header Excel templates
// from the per-daycare Settings area, fills it, and uploads it back. This
// module owns both sides:
//   - buildBulkTemplate(kind) produces the approved draft template (same
//     headers, sample row, header colours, cell notes and the staff role
//     dropdown).
//   - parseBulkWorkbook(buffer, kind) reads the first worksheet with the tiny
//     OpenXML reader in lib/xlsx-lite.ts (ExcelJS's reader cannot reconcile
//     the cell comments the template carries).
//   - processBulkUpload() creates the records row by row inside a real
//     transaction, so a malformed or failing row never leaves a half-created
//     child/staff member, contact or account.
//
// Accounts are created with DEFAULT_ACCOUNT_PASSWORD and
// must_change_password = 1. NOTHING here sends an email: no GoTrue signUp, no
// invite, no confirmation mail. The operator shares the default password
// out-of-band.

import { queryAll, queryGet, queryRun, uid, withTransaction, type DbTransaction, type Row } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { DEFAULT_ACCOUNT_PASSWORD } from "@/lib/platform-accounts";
import { readXlsxRows, type SheetCell } from "@/lib/xlsx-lite";
import { writeXlsx } from "@/lib/xlsx-write";

export type BulkKind = "children" | "staff";

export const BULK_KINDS: BulkKind[] = ["children", "staff"];
export const MAX_BULK_ROWS = 500;
export const MAX_BULK_FILE_BYTES = 5 * 1024 * 1024;

export type BulkTemplateColumn = {
  key: string;
  header: string;
  width: number;
  note: string;
};

export const CHILDREN_COLUMNS: BulkTemplateColumn[] = [
  { key: "firstName", header: "First name *", width: 16, note: "Required. Child's first (given) name." },
  { key: "lastName", header: "Last name *", width: 16, note: "Required. Child's family name." },
  { key: "dob", header: "Date of birth (YYYY-MM-DD)", width: 18, note: "Optional. Format YYYY-MM-DD, e.g. 2021-03-14." },
  { key: "classroomName", header: "Classroom name", width: 18, note: "Optional. Must match a classroom that already exists at your center; otherwise the child is added without a classroom." },
  { key: "allergies", header: "Allergies", width: 20, note: "Optional. Free text, e.g. peanuts." },
  { key: "conditions", header: "Medical conditions", width: 20, note: "Optional. Free text, e.g. mild asthma." },
  { key: "notes", header: "Notes", width: 24, note: "Optional. Any other notes for staff." },
  { key: "parent1Name", header: "Parent 1 full name", width: 20, note: "Optional. If an email is given, a parent account is created and linked to this child. Parents sign in with the default password and change it at first login. No email is sent." },
  { key: "parent1Email", header: "Parent 1 email", width: 26, note: "Optional. Used with Parent 1 full name to create the parent account." },
  { key: "parent1Phone", header: "Parent 1 phone", width: 16, note: "Optional. Stored with the parent's details." },
  { key: "parent2Name", header: "Parent 2 full name", width: 20, note: "Optional. Second parent/guardian, same rules as Parent 1." },
  { key: "parent2Email", header: "Parent 2 email", width: 26, note: "Optional." },
  { key: "parent2Phone", header: "Parent 2 phone", width: 16, note: "Optional." },
];

export const STAFF_COLUMNS: BulkTemplateColumn[] = [
  { key: "fullName", header: "Full name *", width: 22, note: "Required. Staff member's full name." },
  { key: "email", header: "Email *", width: 30, note: "Required. Becomes the login email. Must be unique at your center; duplicates are skipped and reported." },
  { key: "role", header: "Role *", width: 16, note: "Required. One of: admin, teacher, caregiver. A dropdown is provided. Admin = full admin portal (except billing); teacher = classroom staff; caregiver = read-only assistant." },
  { key: "classrooms", header: "Classrooms (comma-separated)", width: 32, note: "Optional. Classroom names this staff member is assigned to, separated by commas. Must match existing classroom names." },
  { key: "phone", header: "Phone", width: 18, note: "Optional." },
];

const CHILDREN_SAMPLE = [
  "Layla",
  "Founder",
  "2022-05-10",
  "Sunflowers",
  "Peanuts",
  "",
  "Prefers afternoon nap",
  "Yara Hesham",
  "yara@example.com",
  "+20 100 000 0000",
  "",
  "",
  "",
];

const STAFF_SAMPLE = [
  "Nour Teacher",
  "nour@example.com",
  "teacher",
  "Sunflowers, Tulips",
  "+20 100 000 0000",
];

function columnsFor(kind: BulkKind): BulkTemplateColumn[] {
  return kind === "children" ? CHILDREN_COLUMNS : STAFF_COLUMNS;
}

function normalizeHeader(value: SheetCell): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export const BULK_TEMPLATE_FILENAMES: Record<BulkKind, string> = {
  children: "kiddy-bulk-children-template.xlsx",
  staff: "kiddy-bulk-staff-template.xlsx",
};

/** Build the approved draft template. Kept intentionally identical to the
 *  draft the founder reviewed: same headers (with the `*` markers), one sample
 *  row, header notes, frozen header row, and the staff role dropdown. */
export async function buildBulkTemplate(kind: BulkKind): Promise<Buffer> {
  const columns = columnsFor(kind);
  return writeXlsx({
    name: kind === "children" ? "Children" : "Staff",
    columns: columns.map((column) => ({
      header: column.header,
      width: column.width,
      note: column.note,
    })),
    sampleRow: kind === "children" ? CHILDREN_SAMPLE : STAFF_SAMPLE,
    ...(kind === "staff"
      ? { listValidation: { column: 2, values: ["admin", "teacher", "caregiver"] } }
      : {}),
  });
}

export class BulkUploadError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "BulkUploadError";
  }
}

export type ParsedBulkRow = {
  rowNumber: number;
  values: Record<string, string>;
};

function cellString(cell: SheetCell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  return String(cell).trim();
}

function headerIndexMap(row: { cells: Map<number, SheetCell> }, columns: BulkTemplateColumn[]): Map<string, number> {
  const byHeader = new Map(columns.map((column) => [normalizeHeader(column.header), column.key]));
  const map = new Map<string, number>();
  for (const [index, cell] of row.cells) {
    const key = byHeader.get(normalizeHeader(cell));
    if (key && !map.has(key)) map.set(key, index);
  }
  return map;
}

/** Parse the workbook into per-row key/value objects. Throws BulkUploadError
 *  with a stable code the action turns into a localized banner. */
export function parseBulkWorkbook(buffer: Buffer, kind: BulkKind): ParsedBulkRow[] {
  if (!BULK_KINDS.includes(kind)) throw new BulkUploadError("kind");
  let sheetRows;
  try {
    sheetRows = readXlsxRows(buffer);
  } catch (error) {
    console.error(
      `[KID-2478] xlsx read failed (${kind}):`,
      error instanceof Error ? error.message : error
    );
    throw new BulkUploadError("format");
  }
  if (sheetRows.length === 0) throw new BulkUploadError("empty");

  const columns = columnsFor(kind);
  const headerRow = sheetRows[0];
  const indexes = headerIndexMap(headerRow, columns);
  const requiredHeaders = kind === "children" ? ["firstName", "lastName"] : ["fullName", "email", "role"];
  if (requiredHeaders.some((key) => !indexes.has(key))) {
    throw new BulkUploadError("headers");
  }

  const dataRows = sheetRows
    .slice(1)
    .filter((row) => [...row.cells.values()].some((value) => cellString(value) !== ""));
  if (dataRows.length > MAX_BULK_ROWS) throw new BulkUploadError("rows");
  if (dataRows.length === 0) throw new BulkUploadError("empty");

  return dataRows.map((row) => {
    const values: Record<string, string> = {};
    for (const column of columns) {
      const index = indexes.get(column.key);
      values[column.key] = index === undefined ? "" : cellString(row.cells.get(index) ?? null);
    }
    return { rowNumber: row.rowNumber, values };
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

function excelSerialToDto(serial: number): string {
  // Excel's 1900 date system: serial 25569 is 1970-01-01.
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function normalizeDob(raw: string): { value: string } | { error: string } {
  if (!raw) return { value: "" };
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const value = excelSerialToDto(Number(raw));
    return value ? { value } : { error: "dob" };
  }
  // Accept an ISO datetime too (Excel/Google Sheets sometimes export
  // `2022-05-10T00:00:00Z` for a date cell typed with a format).
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(raw);
  if (!iso) return { error: "dob" };
  const value = iso[1];
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return { error: "dob" };
  return { value };
}

type RowResult =
  | { status: "created"; name: string; recordId: string; warnings?: string[] }
  | { status: "skipped"; name: string; message: string };

class RowFailure extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function txUnique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function roomMap(tx: DbTransaction, instituteId: string): Promise<Map<string, string>> {
  const rooms = await tx.queryAll("SELECT id, name FROM room WHERE institute_id = ?", instituteId);
  return new Map(rooms.map((room) => [String(room.name ?? "").trim().toLowerCase(), String(room.id)]));
}

async function findAccountByEmail(tx: DbTransaction, email: string): Promise<Row | undefined> {
  return tx.queryGet("SELECT id, email, full_name, role FROM account WHERE lower(trim(email)) = ?", email);
}

async function createParentAccountForRow(
  tx: DbTransaction,
  email: string,
  fullName: string
): Promise<string> {
  const accountId = uid();
  const displayName = fullName || email;
  await tx.queryRun(
    `INSERT INTO account
      (id, email, password_hash, full_name, role, language, email_confirmed, must_change_password)
     VALUES (?, ?, ?, ?, 'parent', 'en', 1, 1)`,
    accountId,
    email,
    hashPassword(DEFAULT_ACCOUNT_PASSWORD),
    displayName
  );
  return accountId;
}

async function linkParentToChild(tx: DbTransaction, accountId: string, childId: string): Promise<void> {
  await tx.queryRun(
    "INSERT INTO family_member (id, account_id, child_id, role) VALUES (?, ?, ?, 'parent') ON CONFLICT DO NOTHING",
    uid(),
    accountId,
    childId
  );
  await tx.queryRun(
    "UPDATE family_member SET role = 'parent' WHERE account_id = ? AND child_id = ?",
    accountId,
    childId
  );
}

async function insertContact(
  tx: DbTransaction,
  childId: string,
  fullName: string,
  email: string,
  phone: string
): Promise<void> {
  if (!fullName && !email && !phone) return;
  await tx.queryRun(
    "INSERT INTO contact (id, child_id, full_name, relationship, phone, email) VALUES (?, ?, ?, 'parent', ?, ?)",
    uid(),
    childId,
    fullName || email,
    phone || null,
    email || null
  );
}

async function processChildRow(
  tx: DbTransaction,
  instituteId: string,
  rooms: Map<string, string>,
  values: Record<string, string>
): Promise<RowResult> {
  const firstName = values.firstName?.trim() ?? "";
  const lastName = values.lastName?.trim() ?? "";
  if (!firstName || !lastName) throw new RowFailure("names");
  const childName = `${firstName} ${lastName}`.trim();

  const dob = normalizeDob(values.dob?.trim() ?? "");
  if ("error" in dob) throw new RowFailure("dob");

  const warnings: string[] = [];
  const classroom = (values.classroomName ?? "").trim();
  let roomId: string | null = null;
  if (classroom) {
    roomId = rooms.get(classroom.toLowerCase()) ?? null;
    if (!roomId) warnings.push("classroom-not-found");
  }

  const parent1Email = normalizeEmail(values.parent1Email ?? "");
  const parent2Email = normalizeEmail(values.parent2Email ?? "");
  for (const email of [parent1Email, parent2Email]) {
    if (email && !isValidEmail(email)) throw new RowFailure("email");
  }

  const existingChild = await tx.queryGet(
    `SELECT id FROM child
     WHERE institute_id = ? AND lower(trim(first_name)) = ? AND lower(trim(last_name)) = ?
       AND coalesce(dob, '') = ?`,
    instituteId,
    firstName.toLowerCase(),
    lastName.toLowerCase(),
    dob.value
  );
  if (existingChild) return { status: "skipped", name: childName, message: "duplicate-child" };

  const childId = uid();
  await tx.queryRun(
    `INSERT INTO child (id, institute_id, room_id, first_name, last_name, dob)
     VALUES (?, ?, ?, ?, ?, ?)`,
    childId,
    instituteId,
    roomId,
    firstName,
    lastName,
    dob.value || null
  );
  await tx.queryRun("INSERT INTO enrollment (id, child_id) VALUES (?, ?)", uid(), childId);
  await tx.queryRun(
    "INSERT INTO child_health (id, child_id, allergies, conditions, notes) VALUES (?, ?, ?, ?, ?)",
    uid(),
    childId,
    values.allergies ?? "",
    values.conditions ?? "",
    values.notes ?? ""
  );

  const parents = [
    { name: values.parent1Name ?? "", email: parent1Email, phone: values.parent1Phone ?? "" },
    { name: values.parent2Name ?? "", email: parent2Email, phone: values.parent2Phone ?? "" },
  ];
  for (const parent of parents) {
    await insertContact(tx, childId, parent.name.trim(), parent.email, parent.phone.trim());
  }

  // Link/create one account per distinct parent email. Two rows in the same
  // sheet can share a parent (siblings); the account is reused.
  for (const email of txUnique(parents.map((parent) => parent.email).filter(Boolean))) {
    const parent = parents.find((candidate) => candidate.email === email)!;
    const existing = await findAccountByEmail(tx, email);
    let accountId: string;
    if (existing) {
      if (String(existing.role ?? "") !== "parent") throw new RowFailure("email-role");
      accountId = String(existing.id);
    } else {
      accountId = await createParentAccountForRow(tx, email, parent.name.trim());
    }
    await linkParentToChild(tx, accountId, childId);
  }

  return { status: "created", name: childName, recordId: childId, warnings };
}

type StaffRoleMap = { staffRole: string; accountRole: string };

function mapStaffRole(raw: string): StaffRoleMap | null {
  const role = raw.trim().toLowerCase();
  if (role === "admin") return { staffRole: "admin", accountRole: "admin" };
  if (role === "teacher") return { staffRole: "teacher", accountRole: "staff" };
  if (role === "caregiver") return { staffRole: "caregiver", accountRole: "staff" };
  return null;
}

async function processStaffRow(
  tx: DbTransaction,
  instituteId: string,
  rooms: Map<string, string>,
  values: Record<string, string>
): Promise<RowResult> {
  const fullName = values.fullName?.trim() ?? "";
  if (!fullName) throw new RowFailure("name");
  const email = normalizeEmail(values.email ?? "");
  if (!email || !isValidEmail(email)) throw new RowFailure("email");
  const mapped = mapStaffRole(values.role ?? "");
  if (!mapped) throw new RowFailure("role");

  const classroomNames = txUnique(
    (values.classrooms ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
  );
  const roomIds: string[] = [];
  for (const classroom of classroomNames) {
    const id = rooms.get(classroom.toLowerCase());
    if (!id) throw new RowFailure("classroom");
    roomIds.push(id);
  }

  const existingAccount = await findAccountByEmail(tx, email);
  if (existingAccount) return { status: "skipped", name: fullName, message: "duplicate-email" };
  const existingStaff = await tx.queryGet(
    "SELECT id FROM staff WHERE institute_id = ? AND lower(trim(email)) = ?",
    instituteId,
    email
  );
  if (existingStaff) return { status: "skipped", name: fullName, message: "duplicate-email" };

  const staffId = uid();
  await tx.queryRun(
    `INSERT INTO staff (id, institute_id, full_name, role, email, phone)
     VALUES (?, ?, ?, ?, ?, ?)`,
    staffId,
    instituteId,
    fullName,
    mapped.staffRole,
    email,
    values.phone?.trim() || null
  );
  for (const roomId of roomIds) {
    await tx.queryRun(
      "INSERT INTO staff_room (staff_id, room_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
      staffId,
      roomId
    );
  }

  const accountId = uid();
  await tx.queryRun(
    `INSERT INTO account
      (id, email, password_hash, full_name, role, staff_id, language, email_confirmed, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, 'en', 1, 1)`,
    accountId,
    email,
    hashPassword(DEFAULT_ACCOUNT_PASSWORD),
    fullName,
    mapped.accountRole,
    staffId
  );

  return { status: "created", name: fullName, recordId: staffId };
}

export type BulkRowOutcome = {
  row: number;
  status: "created" | "skipped" | "error";
  kind: BulkKind;
  name: string;
  message?: string;
  recordId?: string;
  warnings?: string[];
};

export type BulkUploadReport = {
  id: string;
  instituteId: string;
  kind: BulkKind;
  fileName: string;
  totalRows: number;
  createdCount: number;
  skippedCount: number;
  errorCount: number;
  rows: BulkRowOutcome[];
};

function errorMessageFor(error: unknown): string {
  if (error instanceof RowFailure) return error.code;
  console.error("[KID-2478] bulk row failed:", error);
  return "unknown";
}

/** Create one spreadsheet row's records atomically. */
async function processRow(
  kind: BulkKind,
  instituteId: string,
  row: ParsedBulkRow
): Promise<BulkRowOutcome> {
  try {
    const result = await withTransaction(async (tx) => {
      const rooms = await roomMap(tx, instituteId);
      return kind === "children"
        ? processChildRow(tx, instituteId, rooms, row.values)
        : processStaffRow(tx, instituteId, rooms, row.values);
    });
    return { row: row.rowNumber, kind, ...result };
  } catch (error) {
    const name =
      kind === "children"
        ? `${row.values.firstName ?? ""} ${row.values.lastName ?? ""}`.trim()
        : (row.values.fullName ?? "").trim();
    return {
      row: row.rowNumber,
      kind,
      status: "error",
      name,
      message: errorMessageFor(error),
    };
  }
}

export type ProcessBulkUploadInput = {
  instituteId: string;
  kind: BulkKind;
  fileName: string;
  buffer: Buffer;
  actorAccountId: string;
};

export async function processBulkUpload(input: ProcessBulkUploadInput): Promise<BulkUploadReport> {
  const rows = parseBulkWorkbook(input.buffer, input.kind);
  const outcomes: BulkRowOutcome[] = [];
  for (const row of rows) {
    outcomes.push(await processRow(input.kind, input.instituteId, row));
  }

  const createdCount = outcomes.filter((row) => row.status === "created").length;
  const skippedCount = outcomes.filter((row) => row.status === "skipped").length;
  const errorCount = outcomes.filter((row) => row.status === "error").length;
  const id = uid();

  await queryRun(
    `INSERT INTO bulk_upload
      (id, institute_id, kind, actor_account_id, file_name, total_rows, created_count, skipped_count, error_count, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.instituteId,
    input.kind,
    input.actorAccountId,
    input.fileName,
    rows.length,
    createdCount,
    skippedCount,
    errorCount,
    JSON.stringify(outcomes)
  );

  await recordAuditEvent({
    instituteId: input.instituteId,
    actorAccountId: input.actorAccountId,
    action: "create",
    entityType: "bulk_upload",
    entityId: id,
    summary: `Bulk ${input.kind} upload: ${createdCount} created, ${skippedCount} skipped, ${errorCount} errors`,
    metadata: {
      kind: input.kind,
      fileName: input.fileName,
      totalRows: rows.length,
      createdCount,
      skippedCount,
      errorCount,
    },
  });

  return {
    id,
    instituteId: input.instituteId,
    kind: input.kind,
    fileName: input.fileName,
    totalRows: rows.length,
    createdCount,
    skippedCount,
    errorCount,
    rows: outcomes,
  };
}

export type StoredBulkUploadReport = BulkUploadReport & { createdAt: string };

function parseDetails(raw: unknown): BulkRowOutcome[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? (parsed as BulkRowOutcome[]) : [];
  } catch {
    return [];
  }
}

function rowToReport(row: Row): StoredBulkUploadReport {
  return {
    id: String(row.id),
    instituteId: String(row.institute_id),
    kind: String(row.kind) as BulkKind,
    fileName: String(row.file_name ?? ""),
    totalRows: Number(row.total_rows ?? 0),
    createdCount: Number(row.created_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
    errorCount: Number(row.error_count ?? 0),
    rows: parseDetails(row.details),
    createdAt: String(row.created_at ?? ""),
  };
}

export async function getBulkUploadReport(id: string): Promise<StoredBulkUploadReport | null> {
  const row = await queryGet("SELECT * FROM bulk_upload WHERE id = ?", id);
  return row ? rowToReport(row) : null;
}

export async function listBulkUploadReports(instituteId: string, limit = 10): Promise<StoredBulkUploadReport[]> {
  const rows = await queryAll(
    "SELECT * FROM bulk_upload WHERE institute_id = ? ORDER BY created_at DESC LIMIT ?",
    instituteId,
    limit
  );
  return rows.map(rowToReport);
}

/** The downloadable CSV report: one row per spreadsheet row. */
export function bulkReportCsv(report: StoredBulkUploadReport): string {
  const header = ["Row", "Sheet", "Status", "Name", "Message", "Record ID"];
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [header.map(escape).join(",")];
  for (const row of report.rows) {
    lines.push(
      [
        String(row.row),
        row.kind,
        row.status,
        row.name,
        row.status === "created" ? (row.warnings ?? []).join("; ") : (row.message ?? ""),
        row.recordId ?? "",
      ]
        .map((value) => escape(String(value)))
        .join(",")
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
