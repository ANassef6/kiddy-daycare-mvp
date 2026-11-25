// KID-2478: superadmin bulk upload.
//
// Pins the behaviour the acceptance criteria name:
//   1. The two approved templates build with their exact headers + sample row.
//   2. Child rows create the child, health row, parent contact and a linked
//      parent account with DEFAULT_ACCOUNT_PASSWORD + must_change_password.
//   3. Staff rows create the staff row, classroom links and a login with the
//      mapped role, default password and forced-change flag.
//   4. Duplicates are skipped; malformed rows are reported with the row number.
//   5. A row that fails after writing (non-parent email) rolls back: nothing
//      half-created.
//   6. Reports are stored, listable and downloadable as CSV.
//   7. The operator-only guard is on the action (source pin).

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAccount, findAccountByEmail, mustChangePasswordFor, verifyPassword } from "@/lib/auth";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { createRoom } from "@/lib/store";
import {
  BULK_TEMPLATE_FILENAMES,
  CHILDREN_COLUMNS,
  STAFF_COLUMNS,
  buildBulkTemplate,
  bulkReportCsv,
  getBulkUploadReport,
  listBulkUploadReports,
  parseBulkWorkbook,
  processBulkUpload,
  type BulkKind,
} from "@/lib/bulk-upload";
import { readXlsxRows } from "@/lib/xlsx-lite";
import { writeXlsx } from "@/lib/xlsx-write";
import { seedFixture } from "../helpers";

let iid: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  await createRoom(iid, "Sunflowers");
  await createRoom(iid, "Tulips");
});

async function workbookBuffer(kind: BulkKind, rows: Record<string, string>[]): Promise<Buffer> {
  const columns = kind === "children" ? CHILDREN_COLUMNS : STAFF_COLUMNS;
  return writeXlsx({
    name: "Sheet",
    columns: columns.map((column) => ({ header: column.header, width: column.width })),
    sampleRow: [],
    dataRows: rows.map((row) => columns.map((column) => row[column.key] ?? "")),
  });
}

async function upload(kind: BulkKind, rows: Record<string, string>[], fileName = "sheet.xlsx") {
  const operator = await findAccountByEmail("superadmin@kiddy.test");
  const buffer = await workbookBuffer(kind, rows);
  return processBulkUpload({
    instituteId: iid,
    kind,
    fileName,
    buffer,
    actorAccountId: String(operator!.id),
  });
}

function childRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    firstName: "Layla",
    lastName: "Founder",
    dob: "2022-05-10",
    classroomName: "Sunflowers",
    allergies: "Peanuts",
    conditions: "",
    notes: "Prefers afternoon nap",
    parent1Name: "Yara Hesham",
    parent1Email: "yara@example.com",
    parent1Phone: "+20 100 000 0000",
    parent2Name: "",
    parent2Email: "",
    parent2Phone: "",
    ...overrides,
  };
}

function staffRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    fullName: "Nour Teacher",
    email: "nour@example.com",
    role: "teacher",
    classrooms: "Sunflowers, Tulips",
    phone: "+20 100 000 0000",
    ...overrides,
  };
}

describe("templates", () => {
  it("builds the children template with the approved headers and sample row", async () => {
    const buffer = await buildBulkTemplate("children");
    const rows = readXlsxRows(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0].cells.get(0)).toBe("First name *");
    expect(rows[0].cells.get(2)).toBe("Date of birth (YYYY-MM-DD)");
    expect(rows[0].cells.get(12)).toBe("Parent 2 phone");
    expect(rows[1].cells.get(0)).toBe("Layla");
    expect(BULK_TEMPLATE_FILENAMES.children).toBe("kiddy-bulk-children-template.xlsx");
  });

  it("builds the staff template with the role column and sample row", async () => {
    const buffer = await buildBulkTemplate("staff");
    const rows = readXlsxRows(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0].cells.get(0)).toBe("Full name *");
    expect(rows[0].cells.get(2)).toBe("Role *");
    expect(rows[1].cells.get(2)).toBe("teacher");
    expect(BULK_TEMPLATE_FILENAMES.staff).toBe("kiddy-bulk-staff-template.xlsx");
  });

  it("keeps the sample row out of a parse when the founder deletes it", async () => {
    const buffer = await workbookBuffer("children", [childRow()]);
    expect(parseBulkWorkbook(buffer, "children")).toHaveLength(1);
  });
});

describe("children upload", () => {
  it("creates the child, health row, contact and a linked default-password parent account", async () => {
    const report = await upload("children", [childRow()]);
    expect(report.createdCount).toBe(1);
    expect(report.errorCount).toBe(0);

    const child = await queryGet("SELECT * FROM child WHERE first_name = 'Layla' AND last_name = 'Founder'");
    expect(child).toBeTruthy();
    expect(String(child!.dob)).toBe("2022-05-10");
    const room = await queryGet("SELECT id FROM room WHERE name = 'Sunflowers' AND institute_id = ?", iid);
    expect(String(child!.room_id)).toBe(String(room!.id));

    const health = await queryGet("SELECT * FROM child_health WHERE child_id = ?", child!.id);
    expect(String(health!.allergies)).toBe("Peanuts");
    expect(String(health!.notes)).toBe("Prefers afternoon nap");

    const contact = await queryGet("SELECT * FROM contact WHERE child_id = ? AND lower(email) = 'yara@example.com'", child!.id);
    expect(contact).toBeTruthy();
    expect(String(contact!.full_name)).toBe("Yara Hesham");
    expect(String(contact!.relationship)).toBe("parent");

    const account = await findAccountByEmail("yara@example.com");
    expect(account).toBeTruthy();
    expect(String(account!.role)).toBe("parent");
    expect(verifyPassword("12345678", String(account!.password_hash))).toBe(true);
    expect(mustChangePasswordFor(account)).toBe(true);

    const link = await queryGet("SELECT * FROM family_member WHERE account_id = ? AND child_id = ?", account!.id, child!.id);
    expect(String(link!.role)).toBe("parent");
  });

  it("links an existing parent account instead of creating a duplicate", async () => {
    const existing = await createAccount({
      email: "yara@example.com",
      password: "existing-pass-1",
      fullName: "Yara Hesham",
      role: "parent",
    });
    const report = await upload("children", [childRow()]);
    expect(report.createdCount).toBe(1);
    const accounts = await queryAll("SELECT id FROM account WHERE email = 'yara@example.com'");
    expect(accounts).toHaveLength(1);
    const link = await queryGet("SELECT * FROM family_member WHERE account_id = ?", String(existing.id));
    expect(link).toBeTruthy();
  });

  it("skips a duplicate child row and reports it", async () => {
    await upload("children", [childRow()]);
    const report = await upload("children", [childRow()]);
    expect(report.createdCount).toBe(0);
    expect(report.skippedCount).toBe(1);
    expect(report.rows[0].message).toBe("duplicate-child");
    expect(await queryAll("SELECT id FROM child WHERE last_name = 'Founder'")).toHaveLength(1);
  });

  it("reports a malformed date with its row number and writes nothing", async () => {
    const report = await upload("children", [childRow({ dob: "10/05/2022" })]);
    expect(report.errorCount).toBe(1);
    expect(report.rows[0].row).toBe(2);
    expect(report.rows[0].message).toBe("dob");
    expect(await queryAll("SELECT id FROM child WHERE first_name = 'Layla'")).toHaveLength(0);
  });

  it("keeps an unknown classroom as a warning and creates the child without a room", async () => {
    const report = await upload("children", [childRow({ classroomName: "Nursery" })]);
    expect(report.createdCount).toBe(1);
    expect(report.rows[0].warnings).toEqual(["classroom-not-found"]);
    const child = await queryGet("SELECT * FROM child WHERE first_name = 'Layla'");
    expect(child!.room_id).toBeNull();
  });

  it("rolls the whole row back when the parent email belongs to a non-parent account", async () => {
    await createAccount({
      email: "boss@example.com",
      password: "boss-password-1",
      fullName: "Centre Boss",
      role: "admin",
    });
    const beforeHealth = await queryAll("SELECT id FROM child_health");
    const report = await upload("children", [childRow({ parent1Email: "boss@example.com" })]);
    expect(report.errorCount).toBe(1);
    expect(report.rows[0].message).toBe("email-role");
    expect(await queryAll("SELECT id FROM child WHERE first_name = 'Layla'")).toHaveLength(0);
    expect(await queryAll("SELECT id FROM child_health")).toHaveLength(beforeHealth.length);
    expect(await queryAll("SELECT id FROM contact WHERE email = 'boss@example.com'")).toHaveLength(0);
  });

  it("creates two linked parent accounts from one row", async () => {
    const report = await upload("children", [
      childRow({
        parent2Name: "Hassan Ali",
        parent2Email: "hassan@example.com",
        parent2Phone: "+20 111 111 1111",
      }),
    ]);
    expect(report.createdCount).toBe(1);
    expect(await findAccountByEmail("yara@example.com")).toBeTruthy();
    expect(await findAccountByEmail("hassan@example.com")).toBeTruthy();
    expect(await queryAll("SELECT id FROM contact WHERE lower(email) IN ('yara@example.com','hassan@example.com')")).toHaveLength(2);
  });
});

describe("staff upload", () => {
  it("creates staff, classroom links and a default-password login mapped to the role", async () => {
    const report = await upload("staff", [
      staffRow(),
      staffRow({ fullName: "Mona Admin", email: "mona@example.com", role: "admin", classrooms: "" }),
      staffRow({ fullName: "Sara Care", email: "sara@example.com", role: "caregiver", classrooms: "Tulips" }),
    ]);
    expect(report.createdCount).toBe(3);
    expect(report.errorCount).toBe(0);

    const teacher = await queryGet("SELECT * FROM staff WHERE email = 'nour@example.com'");
    expect(String(teacher!.role)).toBe("teacher");
    expect(String(teacher!.phone)).toBe("+20 100 000 0000");
    expect(await queryAll("SELECT * FROM staff_room WHERE staff_id = ?", teacher!.id)).toHaveLength(2);
    const teacherAccount = await findAccountByEmail("nour@example.com");
    expect(String(teacherAccount!.role)).toBe("staff");
    const teacherLink = await queryGet("SELECT staff_id FROM account WHERE email = 'nour@example.com'");
    expect(String(teacherLink!.staff_id)).toBe(String(teacher!.id));
    expect(verifyPassword("12345678", String(teacherAccount!.password_hash))).toBe(true);
    expect(mustChangePasswordFor(teacherAccount)).toBe(true);

    const admin = await queryGet("SELECT * FROM staff WHERE email = 'mona@example.com'");
    expect(String(admin!.role)).toBe("admin");
    const adminAccount = await findAccountByEmail("mona@example.com");
    expect(String(adminAccount!.role)).toBe("admin");

    const carer = await queryGet("SELECT * FROM staff WHERE email = 'sara@example.com'");
    expect(String(carer!.role)).toBe("caregiver");
    expect(await queryAll("SELECT * FROM staff_room WHERE staff_id = ?", carer!.id)).toHaveLength(1);
  });

  it("skips a duplicate staff email and reports it", async () => {
    await upload("staff", [staffRow()]);
    const report = await upload("staff", [staffRow()]);
    expect(report.skippedCount).toBe(1);
    expect(report.rows[0].message).toBe("duplicate-email");
    expect(await queryAll("SELECT id FROM staff WHERE email = 'nour@example.com'")).toHaveLength(1);
  });

  it("rejects an invalid role and an unknown classroom without writing either row", async () => {
    const report = await upload("staff", [
      staffRow({ email: "bad-role@example.com", role: "manager" }),
      staffRow({ email: "bad-room@example.com", classrooms: "Nursery" }),
    ]);
    expect(report.errorCount).toBe(2);
    expect(report.rows[0].message).toBe("role");
    expect(report.rows[1].message).toBe("classroom");
    expect(await queryAll("SELECT id FROM staff WHERE email IN ('bad-role@example.com','bad-room@example.com')")).toHaveLength(0);
    expect(await queryAll("SELECT id FROM account WHERE email IN ('bad-role@example.com','bad-room@example.com')")).toHaveLength(0);
  });

  it("rejects a row with a missing required column value", async () => {
    const report = await upload("staff", [staffRow({ fullName: "" })]);
    expect(report.errorCount).toBe(1);
    expect(report.rows[0].message).toBe("name");
  });
});

describe("report", () => {
  it("stores, lists and downloads the row-level report", async () => {
    const report = await upload("children", [childRow(), childRow({ firstName: "Omar", dob: "bad" })]);
    const stored = await getBulkUploadReport(report.id);
    expect(stored).not.toBeNull();
    expect(stored!.totalRows).toBe(2);
    expect(stored!.createdCount).toBe(1);
    expect(stored!.errorCount).toBe(1);
    expect((await listBulkUploadReports(iid)).map((r) => r.id)).toContain(report.id);
    const csv = bulkReportCsv(stored!);
    expect(csv).toContain('"Row","Sheet","Status","Name","Message","Record ID"');
    expect(csv).toContain('"created"');
    expect(csv).toContain('"dob"');
  });

  it("has the bulk_upload table in the SQLite mirror, with the tenant index", async () => {
    const rows = await queryAll("PRAGMA table_info(bulk_upload)");
    expect(rows.map((row) => String(row.name))).toEqual(
      expect.arrayContaining(["id", "institute_id", "kind", "details", "created_at"])
    );
    const indexes = await queryAll("PRAGMA index_list(bulk_upload)");
    expect(indexes.map((row) => String(row.name))).toContain("idx_bulk_upload_institute");
  });
});

describe("authorization", () => {
  it("guards the action with the platform-operator double check", () => {
    const source = readFileSync(join(process.cwd(), "lib/actions.ts"), "utf8");
    const start = source.indexOf("export async function bulkUploadAction");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, start + 1400);
    expect(body).toContain("requirePlatformOperator()");
    expect(body).toContain("MAX_BULK_FILE_BYTES");
  });

  it("requires the operator session in both download routes", () => {
    const template = readFileSync(
      join(process.cwd(), "app/api/platform/bulk-upload/template/[kind]/route.ts"),
      "utf8"
    );
    const report = readFileSync(
      join(process.cwd(), "app/api/platform/bulk-upload/report/[id]/route.ts"),
      "utf8"
    );
    for (const source of [template, report]) {
      expect(source).toContain("sessionFromHeaders");
      expect(source).toContain("isPlatformOperator(");
      expect(source).toContain("403");
    }
  });
});
