// KID-495: temporary passwords for staff and parent accounts.
//
// Pins the data + action behaviours the acceptance criteria name:
//   1. account.must_change_password exists (migration 0036 + SQLite mirror)
//      and defaults to 0 for every existing account.
//   2. Accounts born from a temp password carry the flag (createAccount +
//      addStaffAction + admin parent-login creation).
//   3. changePasswordAction rejects a wrong current password, enforces the
//      8-character minimum and the confirm match, then updates the app-side
//      hash (verify with the real scrypt verify) and clears the flag.
//   4. The flag read (mustChangePasswordFor) drives the non-blocking prompt:
//      true after any flagged creation, false after a successful change.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "@/lib/store";
import { createAccount, createSessionToken, getAccount, mustChangePasswordFor, verifyPassword } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";

const sessionCookie = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (name === "kiddy_sess" ? sessionCookie : undefined) }),
  headers: () => new Headers(),
}));

function adminSession(accountId: string, email: string) {
  sessionCookie.value = createSessionToken({
    accountId,
    role: "admin",
    email,
    emailConfirmed: true,
  });
}

function parentSession(accountId: string, email: string) {
  sessionCookie.value = createSessionToken({
    accountId,
    role: "parent",
    email,
    emailConfirmed: true,
  });
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

let iid: string;
let childId: string;
let adminId: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const admin = await createAccount({
    email: "admin@sunshine.example",
    password: "admin-password-1",
    fullName: "Centre Admin",
    role: "admin",
  });
  adminId = String(admin.id);
  const child = await store.createChild({ instituteId: iid, firstName: "Amira", lastName: "Hassan" });
  childId = String(child.id);
});

describe("KID-495 migration + mirror", () => {
  it("has the must_change_password column on account", async () => {
    const row = await queryGet("SELECT must_change_password FROM account LIMIT 1");
    expect(Number(row!.must_change_password)).toBe(0);
  });

  it("reads the flag off rows through mustChangePasswordFor", async () => {
    const staff = await store.createStaff({ instituteId: iid, fullName: "Nadia Kamal", role: "carer" });
    const account = await createAccount({
      email: "nadia@sunshine.example",
      password: "temporary-pass-1",
      fullName: "Nadia Kamal",
      role: "staff",
      mustChangePassword: true,
    });
    await (await import("@/lib/db")).queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), String(account.id));
    expect(mustChangePasswordFor(await getAccount(String(account.id)))).toBe(true);
    expect(mustChangePasswordFor(await getAccount("missing-id"))).toBe(false);
  });
});

describe("KID-495 createParentLoginAction", () => {
  it("creates a flagged parent account, links the family, and the temp password verifies on login", async () => {
    adminSession(adminId, "admin@sunshine.example");
    const { createParentLoginAction } = await import("@/lib/actions");
    const target = await redirectTarget(() =>
      createParentLoginAction(form(
        ["childId", childId],
        ["fullName", "Mona Hassan"],
        ["email", "mona@sunshine.example"],
        ["relationship", "parent"],
        ["password", "TempPass-99"],
      ))
    );
    expect(target).toContain("parent=created");
    expect(target).toContain("mona%40sunshine.example");

    const account = await (await import("@/lib/auth")).findAccountByEmail("mona@sunshine.example");
    expect(account).toBeTruthy();
    expect(mustChangePasswordFor(account)).toBe(true);
    // Login works with the shared temp password (app-side fallback path).
    expect(verifyPassword("TempPass-99", String(account!.password_hash))).toBe(true);
    // The family link went through the existing linkFamily logic.
    expect((await store.familiesForAccount(String(account!.id))).map((c) => String(c.id))).toContain(childId);
  });

  it("refuses a short password and an email that already has an account", async () => {
    adminSession(adminId, "admin@sunshine.example");
    const { createParentLoginAction } = await import("@/lib/actions");
    expect(
      await redirectTarget(() =>
        createParentLoginAction(form(["childId", childId], ["fullName", "Sara"], ["email", "sara@sunshine.example"], ["relationship", "parent"], ["password", "short7"]))
      )
    ).toContain("parent=short-password");

    await createAccount({ email: "taken@sunshine.example", password: "whatever-99", fullName: "Taken", role: "parent" });
    expect(
      await redirectTarget(() =>
        createParentLoginAction(form(["childId", childId], ["fullName", "Dup"], ["email", "taken@sunshine.example"], ["relationship", "parent"], ["password", "Pass-9999"]))
      )
    ).toContain("parent=exists");
  });
});

describe("KID-495 addStaffAction marks temp passwords", () => {
  it("flags the staff account created from the shared password", async () => {
    adminSession(adminId, "admin@sunshine.example");
    const { addStaffAction } = await import("@/lib/actions");
    await redirectTarget(() =>
      addStaffAction(form(["fullName", "Tarek Fahmy"], ["role", "carer"], ["email", "tarek@sunshine.example"], ["password", ""]))
    );
    const account = await (await import("@/lib/auth")).findAccountByEmail("tarek@sunshine.example");
    expect(account).toBeTruthy();
    expect(mustChangePasswordFor(account)).toBe(true);
  });
});

describe("KID-495 changePasswordAction", () => {
  it("rejects a wrong current password, a short password, and a mismatched confirm", async () => {
    await createAccount({
      email: "reda@sunshine.example",
      password: "old-password-7",
      fullName: "Reda Nour",
      role: "staff",
      mustChangePassword: true,
    });
    const account = await (await import("@/lib/auth")).findAccountByEmail("reda@sunshine.example");
    sessionCookie.value = createSessionToken({ accountId: String(account!.id), role: "staff", email: "reda@sunshine.example", emailConfirmed: true });
    const { changePasswordAction } = await import("@/lib/actions");

    expect(
      await redirectTarget(() => changePasswordAction(form(["currentPassword", "WRONG"], ["newPassword", "new-password-9"], ["confirmPassword", "new-password-9"])))
    ).toContain("pw=wrong");
    expect(
      await redirectTarget(() => changePasswordAction(form(["currentPassword", "old-password-7"], ["newPassword", "short7"], ["confirmPassword", "short7"])))
    ).toContain("pw=short");
    expect(
      await redirectTarget(() => changePasswordAction(form(["currentPassword", "old-password-7"], ["newPassword", "new-password-9"], ["confirmPassword", "different-9"])))
    ).toContain("pw=mismatch");
  });

  it("updates the app hash, verifies the new password, and clears the flag", async () => {
    await createAccount({
      email: "hana@sunshine.example",
      password: "old-password-7",
      fullName: "Hana Selim",
      role: "staff",
      mustChangePassword: true,
    });
    const { changePasswordAction } = await import("@/lib/actions");
    const account = await (await import("@/lib/auth")).findAccountByEmail("hana@sunshine.example");
    // The staff account signs in through the same cookie mock.
    sessionCookie.value = createSessionToken({ accountId: String(account!.id), role: "staff", email: "hana@sunshine.example", emailConfirmed: true });

    expect(
      await redirectTarget(() => changePasswordAction(form(["currentPassword", "old-password-7"], ["newPassword", "new-password-9"], ["confirmPassword", "new-password-9"])))
    ).toContain("/portal/account?pw=changed");

    const after = await getAccount(String(account!.id));
    expect(mustChangePasswordFor(after)).toBe(false);
    expect(verifyPassword("new-password-9", String(after!.password_hash))).toBe(true);
    expect(verifyPassword("old-password-7", String(after!.password_hash))).toBe(false);
  });

  it("redirects parents back to /child/settings", async () => {
    const parent = await createAccount({
      email: "parent-change@sunshine.example",
      password: "old-password-7",
      fullName: "Laila Fayed",
      role: "parent",
      mustChangePassword: true,
    });
    parentSession(String(parent.id), "parent-change@sunshine.example");
    const { changePasswordAction } = await import("@/lib/actions");
    expect(
      await redirectTarget(() => changePasswordAction(form(["currentPassword", "old-password-7"], ["newPassword", "new-password-9"], ["confirmPassword", "new-password-9"])))
    ).toContain("/child/settings?pw=changed");
    expect(mustChangePasswordFor(await getAccount(String(parent.id)))).toBe(false);
  });
});
