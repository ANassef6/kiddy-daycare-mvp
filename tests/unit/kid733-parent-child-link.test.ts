// KID-733: a parent account must never exist without a child.
//
// Pins the data + action behaviours the acceptance criteria name:
//   1. addChildAction with a temporary password creates the child, the
//      guardian contact, the parent login (role parent, mustChangePassword,
//      emailConfirmed) and the family_member link in one flow.
//   2. addChildAction without a password creates no account at all.
//   3. An existing parent account on the guardian email is reused + linked —
//      never duplicated; an existing staff/admin account is refused and
//      NOTHING is written.
//   4. Every password/email validation failure refuses BEFORE the child is
//      created (password without email, invalid email, short password).
//   5. createParentLoginAction / inviteParentAction reject a missing or
//      forged child server-side and write no account / invite row.
//   6. A legacy childless invite can never activate into a parent account.
//   7. The Create parent login UI no longer offers a childless option.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "@/lib/store";
import { createAccount, createSessionToken, findAccountByEmail, mustChangePasswordFor, verifyPassword } from "@/lib/auth";
import { queryGet, queryAll } from "@/lib/db";
import { seedFixture } from "../helpers";

const sessionCookie = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (name === "kiddy_sess" ? sessionCookie : undefined) }),
  headers: () => new Headers(),
}));

function adminSession(accountId: string, email: string) {
  sessionCookie.value = createSessionToken({ accountId, role: "admin", email, emailConfirmed: true });
}

/** Runs an action and returns its NEXT_REDIRECT target ("" when it doesn't redirect). */
async function redirectTarget(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (err) {
    const digest = String((err as { digest?: unknown })?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw err;
  }
}

function form(...pairs: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of pairs) fd.set(k, v);
  return fd;
}

async function countAccounts(email: string): Promise<number> {
  const rows = await queryAll("SELECT id FROM account WHERE lower(trim(email)) = ?", email.toLowerCase());
  return rows.length;
}

let iid: string;
let adminId: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const admin = await createAccount({
    email: "kid733-admin@sunshine.example",
    password: "admin-password-1",
    fullName: "Centre Admin",
    role: "admin",
  });
  adminId = String(admin.id);
});

describe("KID-733 addChildAction parent-login flow", () => {
  it("creates child + guardian contact + parent account + family link with a temp password", async () => {
    adminSession(adminId, "kid733-admin@sunshine.example");
    const { addChildAction } = await import("@/lib/actions");
    const target = await redirectTarget(() =>
      addChildAction(form(
        ["firstName", "Maya"],
        ["lastName", "Khalil"],
        ["guardianName", "Dina Khalil"],
        ["guardianRelationship", "parent"],
        ["guardianEmail", "dina@sunshine.example"],
        ["parentLoginPassword", "TempPass-77"],
      ))
    );
    expect(target).toContain("parent=created");
    expect(target).toContain("dina%40sunshine.example");

    // child + guardian contact
    const child = await store.createChild; // existence via contact lookup below
    const contact = await queryGet(
      "SELECT id FROM contact WHERE email = ? AND relationship = 'parent'",
      "dina@sunshine.example"
    );
    expect(contact).toBeTruthy();

    // the login: role, flags, working password, family link
    const account = await findAccountByEmail("dina@sunshine.example");
    expect(account).toBeTruthy();
    expect(String(account!.role)).toBe("parent");
    expect(mustChangePasswordFor(account)).toBe(true);
    expect(Number((account as { email_confirmed?: number }).email_confirmed)).toBe(1);
    expect(verifyPassword("TempPass-77", String(account!.password_hash))).toBe(true);
    const kidId = String(
      (await queryGet("SELECT child_id FROM contact WHERE id = ?", String(contact!.id)))!.child_id
    );
    const link = await queryGet(
      "SELECT id FROM family_member WHERE account_id = ? AND child_id = ?",
      String(account!.id),
      kidId
    );
    expect(link).toBeTruthy();
  });

  it("adds a child without a password and creates no account", async () => {
    adminSession(adminId, "kid733-admin@sunshine.example");
    const { addChildAction } = await import("@/lib/actions");
    const before = await countAccounts("phone-only@sunshine.example");
    expect(before).toBe(0);
    const target = await redirectTarget(() =>
      addChildAction(form(
        ["firstName", "Nour"],
        ["lastName", "Fahmy"],
        ["guardianName", "Hala Fahmy"],
        ["guardianRelationship", "family"],
        ["guardianPhone", "+1 555 0733"],
        ["guardianEmail", "phone-only@sunshine.example"],
      ))
    );
    expect(target).toContain("/portal/children/");
    expect(target).not.toContain("parent=");
    expect(await countAccounts("phone-only@sunshine.example")).toBe(0);
  });

  it("reuses an existing parent account and links it to the new child", async () => {
    adminSession(adminId, "kid733-admin@sunshine.example");
    const existing = await createAccount({
      email: "linked-parent@sunshine.example",
      password: "original-pass-1",
      fullName: "Sami Razi",
      role: "parent",
    });
    const { addChildAction } = await import("@/lib/actions");
    const target = await redirectTarget(() =>
      addChildAction(form(
        ["firstName", "Lina"],
        ["lastName", "Razi"],
        ["guardianName", "Sami Razi"],
        ["guardianRelationship", "parent"],
        ["guardianEmail", "linked-parent@sunshine.example"],
        ["parentLoginPassword", "TempPass-88"],
      ))
    );
    expect(target).toContain("parent=linked");
    expect(await countAccounts("linked-parent@sunshine.example")).toBe(1);
    const reused = await findAccountByEmail("linked-parent@sunshine.example");
    expect(String(reused!.id)).toBe(String(existing.id));
    // the link attaches to the NEW child regardless of the reused password
    const childRow = await queryGet("SELECT id FROM child WHERE first_name = 'Lina' AND last_name = 'Razi'");
    expect(childRow).toBeTruthy();
    const link = await queryGet(
      "SELECT id FROM family_member WHERE account_id = ? AND child_id = ?",
      String(existing.id),
      String(childRow!.id)
    );
    expect(link).toBeTruthy();
  });

  it("refuses a non-parent account email and creates nothing", async () => {
    adminSession(adminId, "kid733-admin@sunshine.example");
    const staffLogin = await createAccount({
      email: "staff-hat@sunshine.example",
      password: "staff-pass-99999",
      fullName: "Staff Hat",
      role: "staff",
    });
    const { addChildAction } = await import("@/lib/actions");
    const before = await countAccounts("staff-hat@sunshine.example");
    const target = await redirectTarget(() =>
      addChildAction(form(
        ["firstName", "Ghost"],
        ["lastName", "Child"],
        ["guardianName", "Staff Hat"],
        ["guardianRelationship", "parent"],
        ["guardianEmail", "staff-hat@sunshine.example"],
        ["parentLoginPassword", "TempPass-99"],
      ))
    );
    expect(target).toContain("error=addChildLoginRole");
    // nothing was written: no duplicate account, no child enrollment
    expect(await countAccounts("staff-hat@sunshine.example")).toBe(before);
    expect(await queryGet("SELECT id FROM child WHERE first_name = 'Ghost'")).toBeUndefined();
    expect(
      await queryGet("SELECT id FROM family_member WHERE account_id = ?", String(staffLogin.id))
    ).toBeUndefined();
  });

  it.each([
    [
      "a password without a guardian email",
      [
        ["firstName", "NoEmail"],
        ["lastName", "Child"],
        ["guardianName", "Guardian X"],
        ["guardianRelationship", "parent"],
        ["guardianPhone", "+1 555 0111"],
        ["parentLoginPassword", "TempPass-99"],
      ],
      "error=addChildLoginNoEmail",
    ],
    [
      "an invalid guardian email",
      [
        ["firstName", "BadEmail"],
        ["lastName", "Child"],
        ["guardianName", "Guardian Y"],
        ["guardianRelationship", "parent"],
        ["guardianEmail", "not-an-email"],
        ["parentLoginPassword", "TempPass-99"],
      ],
      "error=addChildLoginEmail",
    ],
    [
      "a too-short password",
      [
        ["firstName", "ShortPw"],
        ["lastName", "Child"],
        ["guardianName", "Guardian Z"],
        ["guardianRelationship", "parent"],
        ["guardianEmail", "shortpw@sunshine.example"],
        ["parentLoginPassword", "short7"],
      ],
      "error=addChildLoginPassword",
    ],
  ] as [string, [string, string][], string][])("%s refuses with nothing created", async (_, pairs, marker) => {
    adminSession(adminId, "kid733-admin@sunshine.example");
    const { addChildAction } = await import("@/lib/actions");
    const target = await redirectTarget(() => addChildAction(form(...(pairs as [string, string][]))));
    expect(target).toContain(marker);
    // no child was created under the refused enrollment's names
    const firstName = pairs.find(([k]) => k === "firstName")![1];
    expect(await queryGet("SELECT id FROM child WHERE first_name = ?", firstName)).toBeUndefined();
    // no login was written for the form emails
    const namedEmail = pairs.find(([k]) => k === "guardianEmail");
    if (namedEmail) {
      expect(await countAccounts(namedEmail[1])).toBe(0);
    } else {
      const ghostRows = await queryAll("SELECT id FROM account WHERE full_name = 'Guardian X'");
      expect(ghostRows.length).toBe(0);
    }
  });
});

describe("KID-733 createParentLoginAction requires a linked child", () => {
  it("refuses a childless submission and writes no account row", async () => {
    adminSession(adminId, "kid733-admin@sunshine.example");
    const { createParentLoginAction } = await import("@/lib/actions");
    const before = await countAccounts("orphan@sunshine.example");
    expect(before).toBe(0);
    const target = await redirectTarget(() =>
      createParentLoginAction(form(
        ["fullName", "Orphan Parent"],
        ["email", "orphan@sunshine.example"],
        ["relationship", "parent"],
        ["password", "TempPass-55"],
      ))
    );
    expect(target).toContain("parent=child-required");
    expect(await countAccounts("orphan@sunshine.example")).toBe(0);
  });

  it("refuses a forged child id and writes no account row", async () => {
    adminSession(adminId, "kid733-admin@sunshine.example");
    const { createParentLoginAction } = await import("@/lib/actions");
    const forgedChild = "f0rged-child-id-that-is-not-in-any-center";
    const target = await redirectTarget(() =>
      createParentLoginAction(form(
        ["childId", forgedChild],
        ["fullName", "Forged Parent"],
        ["email", "forged@sunshine.example"],
        ["relationship", "parent"],
        ["password", "TempPass-66"],
      ))
    );
    expect(target).toContain("/portal/children");
    expect(await countAccounts("forged@sunshine.example")).toBe(0);
  });
});

describe("KID-733 inviteParentAction requires a linked child", () => {
  it("refuses a childless invite and writes no invite row", async () => {
    adminSession(adminId, "kid733-admin@sunshine.example");
    const { inviteParentAction } = await import("@/lib/actions");
    const target = await redirectTarget(() =>
      inviteParentAction(form(
        ["email", "nochild-invite@sunshine.example"],
        ["code", "KID733NOTES"],
        ["relationship", "parent"],
      ))
    );
    expect(target).toContain("invite=child-required");
    expect(await queryGet("SELECT id FROM invite WHERE code = 'KID733NOTES'")).toBeUndefined();
  });

  it("refuses a forged child id and writes no invite row", async () => {
    adminSession(adminId, "kid733-admin@sunshine.example");
    const { inviteParentAction } = await import("@/lib/actions");
    const target = await redirectTarget(() =>
      inviteParentAction(form(
        ["childId", "another-forged-child-id"],
        ["email", "forged-invite@sunshine.example"],
        ["code", "KID733FORGE"],
        ["relationship", "parent"],
      ))
    );
    expect(target).toContain("/portal/children");
    expect(await queryGet("SELECT id FROM invite WHERE code = 'KID733FORGE'")).toBeUndefined();
  });

  it("creates the invite when a real in-scope child is attached", async () => {
    adminSession(adminId, "kid733-admin@sunshine.example");
    const child = await store.createChild({ instituteId: iid, firstName: "Hana", lastName: "Sabry" });
    const { inviteParentAction } = await import("@/lib/actions");
    const target = await redirectTarget(() =>
      inviteParentAction(form(
        ["childId", String(child.id)],
        ["email", "real-invite@sunshine.example"],
        ["code", "KID733REAL1"],
        ["relationship", "parent"],
      ))
    );
    expect(target).not.toContain("child-required");
    const invite = await queryGet("SELECT child_id FROM invite WHERE code = 'KID733REAL1'");
    expect(invite).toBeTruthy();
    expect(String(invite!.child_id)).toBe(String(child.id));
  });
});

describe("KID-733 registration refuses legacy childless invites", () => {
  it("childless invite codes cannot activate an account", async () => {
    await store.createInvite(iid, null, "legacy@sunshine.example", "KID733LEGAC1");
    const { registerAction } = await import("@/lib/actions");
    const result = (await registerAction(form(
      ["email", "legacy@sunshine.example"],
      ["password", "legacy-pass-1"],
      ["fullName", "Legacy Parent"],
      ["inviteCode", "KID733LEGAC1"],
    ))) as { error?: string };
    expect(result?.error).toContain("not attached to a child");
    expect(await countAccounts("legacy@sunshine.example")).toBe(0);
  });
});

describe("KID-733 UI surfaces", () => {
  it("the Create parent login form no longer offers a childless option", async () => {
    const fs = await import("node:fs");
    const path = fs.readFileSync("components/CreateParentLoginForm.tsx", "utf8");
    expect(path).not.toContain("childAny");
    expect(path).toContain('name="childId" required');
  });
});
