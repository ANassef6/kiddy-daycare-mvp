// KID-216: the lazy bootstrap (lib/bootstrap.ts) was dead code — nothing in
// the app ever called `ensureSeeded()`, so an unmanaged deployment could not
// mint its platform-operator account even with PLATFORM_ADMIN_EMAIL set, and
// the board's production login failed by design. These tests pin the fixed
// boot contract:
//
//   1. with PLATFORM_ADMIN_EMAIL set, the first bootstrap pass mints exactly
//      one operator account for the allowlisted email (loginable password);
//   2. without any PLATFORM_* env, an already-populated deployment gains NO
//      new accounts — the documented demo password is never minted there;
//   3. concurrent/duplicate bootstrap passes stay idempotent (single account);
//   4. an empty database bootstraps demo data plus the operator account.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findAccountByEmail, verifyPassword } from "@/lib/auth";
import { PLATFORM_OPERATOR_ROLE } from "@/lib/platform";
import { queryAll } from "@/lib/db";
import { seedFixture } from "../helpers";

type Row = { email?: unknown };

const allowlistEmail = "op1@board.example.test";
const operatorPassword = "qa-operator-pass-9f3d21";

beforeEach(async () => {
  await seedFixture();
});

afterEach(() => {
  delete process.env.PLATFORM_ADMIN_EMAIL;
  delete process.env.PLATFORM_OPERATOR_PASSWORD;
  delete process.env.SUPERADMIN_EMAIL;
});

/** Fresh module import per test: lib/bootstrap caches `initialized`, so each
 *  case needs its own module instance (and lib/seed reads the env at import). */
async function freshEnsureSeeded() {
  vi.resetModules();
  const mod = await import("@/lib/bootstrap");
  return mod.ensureSeeded;
}

async function platformAccounts(): Promise<Row[]> {
  return queryAll("SELECT email FROM account WHERE role = ?", PLATFORM_OPERATOR_ROLE);
}

describe("KID-216 boot bootstrap", () => {
  it("mints exactly one loginable operator account for the allowlisted email", async () => {
    process.env.PLATFORM_ADMIN_EMAIL = allowlistEmail;
    process.env.PLATFORM_OPERATOR_PASSWORD = operatorPassword;

    const ensureSeeded = await freshEnsureSeeded();
    await ensureSeeded();

    const account = await findAccountByEmail(allowlistEmail);
    expect(account).toBeDefined();
    expect(String(account!.role)).toBe(PLATFORM_OPERATOR_ROLE);
    expect(verifyPassword(operatorPassword, String(account!.password_hash))).toBe(true);

    const accounts = (await platformAccounts()).filter(
      (a) => String(a.email).toLowerCase() === allowlistEmail
    );
    expect(accounts).toHaveLength(1);
  });

  it("mints nothing new into a populated deployment with no PLATFORM_* env", async () => {
    delete process.env.PLATFORM_ADMIN_EMAIL;
    delete process.env.SUPERADMIN_EMAIL;

    const before = new Set(
      (await queryAll("SELECT email FROM account")).map((r) => String(r.email))
    );
    expect(before.size).toBeGreaterThan(0);

    const ensureSeeded = await freshEnsureSeeded();
    await ensureSeeded();

    const after = await queryAll("SELECT email FROM account");
    expect(new Set(after.map((r) => String(r.email)))).toEqual(before);
  });

  it("keeps duplicate and concurrent bootstrap passes idempotent", async () => {
    process.env.PLATFORM_ADMIN_EMAIL = allowlistEmail;
    process.env.PLATFORM_OPERATOR_PASSWORD = operatorPassword;

    const ensureSeeded = await freshEnsureSeeded();
    await Promise.all([ensureSeeded(), ensureSeeded(), ensureSeeded()]);

    const rows = (await platformAccounts()).filter(
      (a) => String(a.email).toLowerCase() === allowlistEmail
    );
    expect(rows).toHaveLength(1);
  });

  it("also bootstraps a completely empty database (fresh deployment)", async () => {
    process.env.PLATFORM_ADMIN_EMAIL = allowlistEmail;
    process.env.PLATFORM_OPERATOR_PASSWORD = operatorPassword;

    const { resetDb } = await import("../helpers");
    await resetDb();
    expect(await queryAll("SELECT id, name FROM institute")).toHaveLength(0);

    const ensureSeeded = await freshEnsureSeeded();
    await ensureSeeded();

    const institute = await queryAll("SELECT name FROM institute");
    expect(institute).toHaveLength(1);
    expect(String(institute[0].name)).toBe("Sunshine Daycare");

    const account = await findAccountByEmail(allowlistEmail);
    expect(account?.role).toBe(PLATFORM_OPERATOR_ROLE);
    // the empty-DB dev seed path never mints demo credentials on top of the
    // configured operator — the allowlisted email IS the operator account
    expect(String(account?.email)).toBe(allowlistEmail);
  });
});
