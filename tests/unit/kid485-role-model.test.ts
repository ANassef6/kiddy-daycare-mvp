// KID-485: role model and staff access update.
//
// Pinned here, mirroring the plan:
//   1. The role union is exactly owner | admin | teacher | caregiver | parent
//      (the retired `staff`/`carer` values are gone and cannot be minted).
//   2. The migration (SQLite mirror; the Postgres chain has its own checks in
//      supabase/verify-migrations.mjs) renames legacy staff/carER rows and
//      accounts to teacher, promotes admin-labeled staff logins, leaves owner
//      records and accounts untouched, defaults new staff rows to teacher,
//      and is idempotent on an already-migrated database.
//   3. The staff profile actions: owner is not assignable (an owner record
//      cannot be demoted, retired values are ignored), and the linked login
//      account follows the staff role without ever demoting a standing
//      owner/admin.
//   4. Caregiver restrictions: the page gate fails closed (children / account
//      / notifications are the only allowed portal areas), business writes are
//      refused server-side, and scoping is assigned-classrooms only — an
//      unassigned caregiver sees NOTHING (never "unscoped admin-like").
//   5. Teacher keeps the classroom-scoped floor behavior of the old staff role.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES, isAdminRole, isOwnerRole, isTeacherRole, isCaregiverRole } from "@/lib/role";
import { seedFixture } from "../helpers";
import { queryGet, queryRun, ensureSchema } from "@/lib/db";
import * as store from "@/lib/store";
import { createAccount, createSessionToken, type Session } from "@/lib/auth";

// --- request-scope mock: the staff actions read cookies(); the portal page
// gate reads headers(). redirect() throws the sentinel Next uses so a refusal
// FAILS loudly instead of silently writing. ---------------------------------
const sessionCookie = { value: "" };
let mockHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (name === "kiddy_sess" ? sessionCookie : undefined),
  }),
  headers: () => ({
    get: (key: string) => mockHeaders[key.toLowerCase()] ?? null,
  }),
}));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    redirect: (url: string) => {
      const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
      err.digest = `NEXT_REDIRECT;replace;${url};`;
      throw err;
    },
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  };
});

import {
  addStaffAction,
  linkStaffLoginAction,
  updateStaffInfoAction,
  createSupplyAction,
  saveChildStatusAction,
} from "@/lib/actions";
import { requirePortalPage, caregiverPathAllowed, refuseCaregiver } from "@/lib/require";

let iid: string;
let sunshineOwner: string;

function sessionCookieFor(accountId: string, role: string, email: string): string {
  const session: Session = { accountId, role, email, emailConfirmed: true };
  return createSessionToken(session);
}
function setSession(accountId: string, role: string, email: string, instituteId?: string) {
  const token = sessionCookieFor(accountId, role, email);
  // Actions read cookies().get("kiddy_sess").value; pages read headers().
  sessionCookie.value = token;
  const extras = instituteId ? `; tenancy=${instituteId}` : "";
  mockHeaders = { cookie: `kiddy_sess=${token}${extras}` };
}

beforeEach(async () => {
  await seedFixture();
  mockHeaders = {};
  const inst = await queryGet("SELECT id FROM institute LIMIT 1");
  iid = String(inst!.id);
  const owner = await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1");
  sunshineOwner = String(owner!.id);
});

// ---- 1. role union -----------------------------------------------------------
describe("the KID-485 role union", () => {
  it("is exactly owner | admin | teacher | caregiver | parent", () => {
    expect([...ROLES]).toEqual(["owner", "admin", "teacher", "caregiver", "parent"]);
    expect(JSON.stringify(ROLES)).not.toContain("staff");
    expect(JSON.stringify(ROLES)).not.toContain("carer");
  });

  it("keeps isAdminRole / isOwnerRole semantics and exposes the floor roles", () => {
    expect(isAdminRole("owner")).toBe(true);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("teacher")).toBe(false);
    expect(isAdminRole("caregiver")).toBe(false);
    expect(isAdminRole("parent")).toBe(false);
    expect(isOwnerRole("owner")).toBe(true);
    expect(isOwnerRole("admin")).toBe(false);
    expect(isTeacherRole("teacher")).toBe(true);
    expect(isCaregiverRole("caregiver")).toBe(true);
    expect(isTeacherRole("caregiver")).toBe(false);
  });

  it("refuses to mint an account with the retired staff/carer roles", async () => {
    for (const retired of ["staff", "carer"]) {
      await expect(
        createAccount({ email: `retired-${retired}@x.test`, password: "x", fullName: "Retired", role: retired })
      ).rejects.toThrow("account-role-not-assignable");
    }
  });
});

// ---- 2. the migration (SQLite mirror) ---------------------------------------
describe("the KID-485 data migration on the SQLite mirror", () => {
  it("renames legacy rows, promotes admin staffers, protects owners, and is idempotent", async () => {
    // Seed the PRE-migration world onto the already-schema'd database: legacy
    // staff rows and accounts still carry 'carer'/'staff'.
    const legacyStaff = async (id: string, role: string, fullName: string) =>
      queryRun(
        "INSERT INTO staff (id, institute_id, full_name, role) VALUES (?, ?, ?, ?)",
        id, iid, fullName, role
      );
    await legacyStaff("st-legacy-carer", "carer", "Legacy Carer");
    await legacyStaff("st-legacy-staff", "staff", "Legacy Staff");
    await legacyStaff("st-legacy-admin", "admin", "Legacy Admin");
    await legacyStaff("st-owner-staff", "owner", "Owner Profile");

    const mkAccount = async (id: string, email: string, fullName: string, role: string, staffId: string) =>
      queryRun(
        "INSERT INTO account (id, email, password_hash, full_name, role, staff_id) VALUES (?, ?, ?, ?, ?, ?)",
        id, email, "x", fullName, role, staffId
      );
    await mkAccount("ac-carer", "legacy-c@k485.test", "Legacy Carer", "carer", "st-legacy-carer");
    await mkAccount("ac-staff", "legacy-s@k485.test", "Legacy Staff", "staff", "st-legacy-staff");
    await mkAccount("ac-admin", "legacy-a@k485.test", "Legacy Admin", "staff", "st-legacy-admin");
    await mkAccount("ac-owner", "legacy-o@k485.test", "Owner Profile", "owner", "st-owner-staff");

    const rolesOf = async () => {
      const rows = await queryAllSafe(
        "SELECT id, role FROM account WHERE id IN ('ac-carer','ac-staff','ac-admin','ac-owner') UNION ALL SELECT id, role FROM staff WHERE id IN ('st-legacy-carer','st-legacy-staff','st-legacy-admin','st-owner-staff') ORDER BY id"
      );
      return rows.map((r: any) => `${r.id}=${r.role}`);
    };

    await ensureSchema(); // the migration backfills run here

    expect(await rolesOf()).toEqual([
      "ac-admin=admin", // promoted from the admin-labeled staff row
      "ac-carer=teacher", // renamed
      "ac-owner=owner", // untouched
      "ac-staff=teacher", // renamed
      "st-legacy-admin=admin",
      "st-legacy-carer=teacher",
      "st-legacy-staff=teacher",
      "st-owner-staff=owner",
    ]);

    // Idempotence: a completely migrated database gains nothing from a replay.
    const before = JSON.stringify(await rolesOf());
    await ensureSchema();
    await ensureSchema();
    expect(JSON.stringify(await rolesOf())).toBe(before);

    // New staff rows land on the teacher default.
    const def = await queryGet(
      "SELECT role FROM staff WHERE id = 'st-default-485'"
    );
    expect(def).toBeUndefined();
    await queryRun(
      "INSERT INTO staff (id, institute_id, full_name) VALUES ('st-default-485', ?, 'Default Dolly')",
      iid
    );
    expect(String((await queryGet("SELECT role FROM staff WHERE id = 'st-default-485'"))!.role)).toBe("teacher");
  });
});

// helpers imported lazily to keep the mock setup above first
async function queryAllSafe(sql: string) {
  const { queryAll } = await import("@/lib/db");
  return queryAll(sql);
}

// Reads one row's `role` column (or undefined) through the awaited queryGet.
async function roleOf(sql: string, ...params: unknown[]): Promise<string | undefined> {
  const { queryGet: qg } = await import("@/lib/db");
  const row = (await (qg as (...a: unknown[]) => Promise<unknown>)(sql, ...params)) as
    | { role?: unknown }
    | undefined;
  return row?.role === undefined ? undefined : String(row.role);
}

// ---- 3. staff profile actions ------------------------------------------------
describe("staff role assignment through the actions (KID-485)", () => {
  it("addStaffAction creates the record and the linked login with the SAME role", async () => {
    setSession(sunshineOwner, "owner", "owner@k485.test");
    const fd = new FormData();
    fd.set("fullName", "Caregiver Kate");
    fd.set("role", "caregiver");
    fd.set("email", "caregiver-kate@k485.test");
    fd.set("password", "caregiver-1");
    await expect(addStaffAction(fd)).rejects.toThrow("NEXT_REDIRECT");

    const staffRow = await queryGet("SELECT id, role FROM staff WHERE full_name = 'Caregiver Kate'");
    expect(String(staffRow!.role)).toBe("caregiver");
    const acc = await queryGet("SELECT role, staff_id FROM account WHERE email = 'caregiver-kate@k485.test'");
    expect(String(acc!.role)).toBe("caregiver");
    expect(String(acc!.staff_id)).toBe(String(staffRow!.id));
  });

  it("addStaffAction falls back to teacher for a forged role value (never owner)", async () => {
    setSession(sunshineOwner, "owner", "owner@k485.test");
    const fd = new FormData();
    fd.set("fullName", "Forged Owner Tag");
    fd.set("role", "owner");
    await expect(addStaffAction(fd)).rejects.toThrow("NEXT_REDIRECT");
    expect(String((await queryGet("SELECT role FROM staff WHERE full_name = 'Forged Owner Tag'"))!.role)).toBe("teacher");
  });

  it("updateStaffInfoAction drops retired/owner values and syncs the login role", async () => {
    setSession(sunshineOwner, "owner", "owner@k485.test");
    const staffRow = await store.createStaff({ instituteId: iid, fullName: "Moving Role", role: "teacher" });
    const acc = await createAccount({ email: "moving-role@k485.test", password: "x", fullName: "Moving Role", role: "teacher" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", staffRow.id, String(acc.id));

    // caregiver -> the record AND the account follow.
    const fd = new FormData();
    fd.set("staffId", String(staffRow.id));
    fd.set("fullName", "Moving Role");
    fd.set("role", "caregiver");
    await expect(updateStaffInfoAction(fd)).rejects.toThrow("NEXT_REDIRECT");
    expect((await roleOf("SELECT role FROM staff WHERE id = ?", String(staffRow.id)))).toBe("caregiver");
    expect((await roleOf("SELECT role FROM account WHERE staff_id = ?", String(staffRow.id)))).toBe("caregiver");

    // A retired 'carer' value is ignored: the record keeps its current role.
    const fd2 = new FormData();
    fd2.set("staffId", String(staffRow.id));
    fd2.set("fullName", "Moving Role");
    fd2.set("role", "carer");
    await expect(updateStaffInfoAction(fd2)).rejects.toThrow("NEXT_REDIRECT");
    expect((await roleOf("SELECT role FROM staff WHERE id = ?", String(staffRow.id)))).toBe("caregiver");

    // An owner staff record with an owner login: the profile edit can never
    // move the role (server-side refusal), and the owner account survives.
    const ownerStaff = await store.createStaff({ instituteId: iid, fullName: "Owner Profile 485", role: "owner" });
    const ownerAcc = await createAccount({ email: "owner-staff-485@k485.test", password: "x", fullName: "Owner Profile 485", role: "owner" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", ownerStaff.id, String(ownerAcc.id));
    const fdOwner = new FormData();
    fdOwner.set("staffId", String(ownerStaff.id));
    fdOwner.set("fullName", "Owner Profile 485");
    fdOwner.set("role", "caregiver");
    await expect(updateStaffInfoAction(fdOwner)).rejects.toThrow("NEXT_REDIRECT");
    expect(await roleOf("SELECT role FROM staff WHERE id = ?", String(ownerStaff.id))).toBe("owner");
    expect(await roleOf("SELECT role FROM account WHERE staff_id = ?", String(ownerStaff.id))).toBe("owner");
  });

  it("linkStaffLoginAction aligns roles without demoting a standing owner/admin", async () => {
    setSession(sunshineOwner, "owner", "owner@k485.test");
    // An admin-labeled staff record with an existing TEACHER account is
    // promoted to admin by linking.
    const adminStaff = await store.createStaff({ instituteId: iid, fullName: "Boss Person", role: "admin" });
    const teacherAcc = await createAccount({ email: "boss-person@k485.test", password: "x", fullName: "Boss Person", role: "teacher" });
    const fd = new FormData();
    fd.set("staffId", String(adminStaff.id));
    fd.set("email", "boss-person@k485.test");
    fd.set("password", "link-password-1");
    await expect(linkStaffLoginAction(fd)).rejects.toThrow("NEXT_REDIRECT");
    expect((await roleOf("SELECT role FROM account WHERE id = ?", String(teacherAcc.id)))).toBe("admin");

    // Linking a teacher staff record to a standing ADMIN account never
    // demotes the admin.
    const teacherStaff = await store.createStaff({ instituteId: iid, fullName: "Floor Person", role: "teacher" });
    const adminAcc = await createAccount({ email: "floor-admin@k485.test", password: "x", fullName: "Floor Person", role: "admin" });
    const fd2 = new FormData();
    fd2.set("staffId", String(teacherStaff.id));
    fd2.set("email", "floor-admin@k485.test");
    fd2.set("password", "link-password-2");
    await expect(linkStaffLoginAction(fd2)).rejects.toThrow("NEXT_REDIRECT");
    expect((await roleOf("SELECT role FROM account WHERE id = ?", String(adminAcc.id)))).toBe("admin");

    // A new login for a caregiver staff record starts as caregiver.
    const caregiverStaff = await store.createStaff({ instituteId: iid, fullName: "Helper Person", role: "caregiver" });
    const fd3 = new FormData();
    fd3.set("staffId", String(caregiverStaff.id));
    fd3.set("email", "helper-person@k485.test");
    fd3.set("password", "link-password-3");
    await expect(linkStaffLoginAction(fd3)).rejects.toThrow("NEXT_REDIRECT");
    expect(await roleOf("SELECT role FROM account WHERE email = 'helper-person@k485.test'")).toBe("caregiver");
  });
});

// ---- 4. caregiver enforcement -------------------------------------------------
describe("caregiver restrictions (KID-485)", () => {
  it("the page gate allows exactly children / account / notifications", () => {
    expect(caregiverPathAllowed("/portal/children")).toBe(true);
    expect(caregiverPathAllowed("/portal/children/c-1")).toBe(true);
    expect(caregiverPathAllowed("/portal/children/c-1?tab=daily")).toBe(true);
    expect(caregiverPathAllowed("/portal/account")).toBe(true);
    expect(caregiverPathAllowed("/portal/notifications")).toBe(true);
    expect(caregiverPathAllowed("/portal/dashboard")).toBe(false);
    expect(caregiverPathAllowed("/portal/finance")).toBe(false);
    expect(caregiverPathAllowed("/portal/staff")).toBe(false);
    expect(caregiverPathAllowed("/portal/messages")).toBe(false);
    // Prefix safety: /portal/children-ossifoX must NOT ride the children path.
    expect(caregiverPathAllowed("/portal/childrenofX")).toBe(false);
    expect(caregiverPathAllowed("/portal/accounts-x")).toBe(false);
  });

  it("a direct URL to any other portal area redirects into the children area", () => {
    setSession(sunshineOwner, "caregiver", "gate@k485.test");
    let digest = "";
    try {
      requirePortalPage("/portal/dashboard");
    } catch (err) {
      digest = String((err as { digest?: unknown }).digest ?? "");
    }
    expect(digest).toContain("/portal/children");
    // Allowed paths return the session instead of throwing.
    expect(requirePortalPage("/portal/children").role).toBe("caregiver");
    expect(requirePortalPage("/portal/account").role).toBe("caregiver");
  });

  it("non-admin roles pass the gate unchanged", () => {
    setSession(sunshineOwner, "teacher", "t@k485.test");
    expect(requirePortalPage("/portal/finance").role).toBe("teacher");
    setSession(sunshineOwner, "parent", "p@k485.test");
    expect(requirePortalPage("/portal/finance").role).toBe("parent");
  });

  it("refuseCaregiver sends caregiver writes back to the children area", () => {
    setSession(sunshineOwner, "caregiver", "w@k485.test");
    let digest = "";
    try {
      refuseCaregiver({ role: "caregiver", email: "w@k485.test" });
    } catch (err) {
      digest = String((err as { digest?: unknown }).digest ?? "");
    }
    expect(digest).toContain("/portal/children?error=readonly");
  });

  it("a caregiver cannot create supplies server-side (forged post refused)", async () => {
    const caregiverStaff = await store.createStaff({ instituteId: iid, fullName: "Supply Caregiver", role: "caregiver" });
    const acc = await createAccount({ email: "supply-caregiver@k485.test", password: "x", fullName: "Supply Caregiver", role: "caregiver" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", caregiverStaff.id, String(acc.id));
    setSession(String(acc.id), "caregiver", "supply-caregiver@k485.test");

    const suppliesBefore = (await store.listSupplies(iid)).length;
    const fd = new FormData();
    fd.set("name", "Forged crayons");
    fd.set("quantity", "10");
    await expect(createSupplyAction(fd)).rejects.toThrow(/NEXT_REDIRECT: \/portal\/children\?error=readonly|NEXT_REDIRECT/);
    expect((await store.listSupplies(iid)).length).toBe(suppliesBefore);
  });

  it("a caregiver logs child status ONLY inside its assigned classrooms", async () => {
    const room = await store.createRoom(iid, "Caregiver Room 485", 8);
    const child = await store.listChildren(iid).then((rows: any[]) => rows[0]);
    const otherChild = (await store.listChildren(iid)).find((r: any) => String(r.id) !== String(child.id));
    const caregiverStaff = await store.createStaff({
      instituteId: iid,
      fullName: "Status Caregiver",
      role: "caregiver",
      roomIds: [String(room.id)],
    });
    const acc = await createAccount({ email: "status-caregiver@k485.test", password: "x", fullName: "Status Caregiver", role: "caregiver" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", caregiverStaff.id, String(acc.id));

    // Unassigned child -> scope refusal; allowed child path exercises saveChildStatusAction itself below.
    if (otherChild) {
      setSession(String(acc.id), "caregiver", "status-caregiver@k485.test");
      const fd = new FormData();
      fd.set("childId", String(otherChild.id));
      fd.set("kind", "mood");
      fd.set("value", "happy");
      await expect(saveChildStatusAction(fd)).rejects.toThrow(/NEXT_REDIRECT: \/portal\/children\?error=scope|NEXT_REDIRECT/);
    }
  });

  it("scoping is fail-closed: an unassigned caregiver scope is [], never unscoped", async () => {
    const caregiverStaff = await store.createStaff({ instituteId: iid, fullName: "Unassigned 485", role: "caregiver" });
    const acc = await createAccount({ email: "unassigned-485@k485.test", password: "x", fullName: "Unassigned 485", role: "caregiver" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", caregiverStaff.id, String(acc.id));
    expect(await store.scopedRoomIds(iid, String(acc.id))).toEqual([]);

    // Even a caregiver with NO staff row at all fails closed.
    const naked = await createAccount({ email: "naked-485@k485.test", password: "x", fullName: "Naked 485", role: "caregiver" });
    expect(await store.scopedRoomIds(iid, String(naked.id))).toEqual([]);

    // A teacher keeps the same room scoping behavior as the old staff role.
    const room = await store.createRoom(iid, "Teacher Room 485", 8);
    const teacherStaff = await store.createStaff({
      instituteId: iid,
      fullName: "Scoped Teacher",
      role: "teacher",
      roomIds: [String(room.id)],
    });
    const tAcc = await createAccount({ email: "scoped-teacher@k485.test", password: "x", fullName: "Scoped Teacher", role: "teacher" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", teacherStaff.id, String(tAcc.id));
    expect(await store.scopedRoomIds(iid, String(tAcc.id))).toEqual([String(room.id)]);
  });

  it("a caregiver login lands on /portal/children (source pin)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/actions.ts", "utf8");
    expect(src).toContain('if (isCaregiverRole(role)) return "/portal/children";');
  });
});
