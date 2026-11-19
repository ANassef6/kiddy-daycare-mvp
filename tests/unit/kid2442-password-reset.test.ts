// KID-2442: the platform operator's one-click password reset.
//
// Pins the four acceptance behaviours that live below the server-action /
// next/headers boundary:
//   1. Lookup: email -> account + tenant + role (case/whitespace insensitive).
//   2. Reset: app hash becomes the platform default and must_change_password
//      is set in the same write, so the KID-2439 login gate forces a change.
//   3. Unknown accounts: no write, no audit row, null result.
//   4. Authorization: only the platform sentinel session + allowlisted email
//      passes; every daycare role is refused.
//
// The action's own requirePlatformOperator() call is asserted from source,
// matching the split used by the other platform tests (next/headers stays out
// of the unit suite).

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findAccountByEmail, mustChangePasswordFor, verifyPassword } from "@/lib/auth";
import { queryAll } from "@/lib/db";
import { dictionaries, keysOf } from "@/lib/i18n";
import { isPlatformOperator, PLATFORM_OPERATOR_ROLE } from "@/lib/platform";
import {
  DEFAULT_ACCOUNT_PASSWORD,
  lookupAccountForPasswordReset,
  resetAccountPasswordToDefault,
} from "@/lib/platform-accounts";
import { seedFixture } from "../helpers";

beforeEach(async () => {
  await seedFixture();
});

const repoRoot = process.cwd();
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

describe("lookup", () => {
  it("resolves an email to the account, its role and its daycare name", async () => {
    const target = await lookupAccountForPasswordReset("parent@example.test");
    expect(target).not.toBeNull();
    expect(target!.email).toBe("parent@example.test");
    expect(target!.role).toBe("parent");
    expect(target!.fullName).toBe("Grace Nguyen");
    expect(target!.institutes.map((i) => i.name)).toEqual(["Sunshine Daycare"]);
  });

  it("is case- and whitespace-insensitive", async () => {
    const target = await lookupAccountForPasswordReset("  PARENT@Example.Test ");
    expect(target).not.toBeNull();
    expect(target!.accountId).toBe((await findAccountByEmail("parent@example.test"))!.id);
  });

  it("returns null for an unknown or empty email (nothing written)", async () => {
    expect(await lookupAccountForPasswordReset("nobody@example.test")).toBeNull();
    expect(await lookupAccountForPasswordReset("   ")).toBeNull();
  });
});

describe("reset", () => {
  it("sets the platform default and forces a change at the next login", async () => {
    const account = await findAccountByEmail("parent@example.test");
    expect(verifyPassword(DEFAULT_ACCOUNT_PASSWORD, String(account!.password_hash))).toBe(false);

    const reset = await resetAccountPasswordToDefault(
      String(account!.id),
      String((await findAccountByEmail("superadmin@kiddy.test"))!.id)
    );
    expect(reset).not.toBeNull();
    expect(reset!.mustChangePassword).toBe(true);

    const updated = await findAccountByEmail("parent@example.test");
    expect(verifyPassword(DEFAULT_ACCOUNT_PASSWORD, String(updated!.password_hash))).toBe(true);
    expect(verifyPassword("kiddy-parent", String(updated!.password_hash))).toBe(false);
    expect(mustChangePasswordFor(updated)).toBe(true);
  });

  it("writes one audit row naming the actor, target, tenant and forced flag", async () => {
    const target = await findAccountByEmail("parent@example.test");
    const operator = await findAccountByEmail("superadmin@kiddy.test");
    await resetAccountPasswordToDefault(String(target!.id), String(operator!.id));

    const rows = await queryAll(
      "SELECT * FROM audit_event WHERE entity_type = 'account' AND entity_id = ?",
      target!.id
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(String(row.action)).toBe("update");
    expect(String(row.actor_account_id)).toBe(String(operator!.id));
    expect(String(row.actor_name)).toBe("Platform Operator");
    expect(String(row.institute_id).length).toBeGreaterThan(0);
    const meta = JSON.parse(String(row.metadata));
    expect(meta.targetAccountId).toBe(String(target!.id));
    expect(meta.targetEmail).toBe("parent@example.test");
    expect(meta.targetRole).toBe("parent");
    expect(meta.mustChangePassword).toBe(true);
    expect(meta.instituteNames).toEqual(["Sunshine Daycare"]);
  });

  it("refuses an unknown account without a partial write or audit row", async () => {
    const before = await queryAll("SELECT id FROM audit_event WHERE entity_type = 'account'");
    const reset = await resetAccountPasswordToDefault("missing-account-id", "operator-id");
    expect(reset).toBeNull();
    const after = await queryAll("SELECT id FROM audit_event WHERE entity_type = 'account'");
    expect(after).toHaveLength(before.length);
  });

  it("uses the founder's standing default (digits 1-8)", () => {
    expect(DEFAULT_ACCOUNT_PASSWORD).toBe("12345678");
  });
});

describe("authorization", () => {
  it("passes only the platform sentinel + allowlisted email", () => {
    expect(isPlatformOperator(PLATFORM_OPERATOR_ROLE, "superadmin@kiddy.test")).toBe(true);
    expect(isPlatformOperator("platform", "someone@example.test")).toBe(false);
    expect(isPlatformOperator("owner", "superadmin@kiddy.test")).toBe(false);
    expect(isPlatformOperator("admin", "superadmin@kiddy.test")).toBe(false);
    expect(isPlatformOperator("parent", "superadmin@kiddy.test")).toBe(false);
    expect(isPlatformOperator("", "")).toBe(false);
  });

  it("the server action re-checks the platform operator guard", () => {
    const source = read("lib/actions.ts");
    const start = source.indexOf("export async function resetAccountPasswordAction");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, start + 1600);
    expect(body).toContain("requirePlatformOperator()");
    expect(body).toContain("syncGoTruePassword");
    expect(body).toContain("resetAccountPasswordToDefault");
  });

  it("the page repeats the operator guard outside the layout", () => {
    const page = read("app/platform/password-reset/page.tsx");
    expect(page).toContain("isPlatformOperator(session.role, session.email)");
    expect(page).toContain("requireSession()");
  });
});

describe("i18n", () => {
  it("has every reset string in both dictionaries", () => {
    const required = [
      "platform.passwordResetLink",
      "platform.passwordResetTitle",
      "platform.passwordResetSubtitle",
      "platform.passwordResetEmailLabel",
      "platform.passwordResetLookup",
      "platform.passwordResetNotFound",
      "platform.passwordResetAccountTitle",
      "platform.passwordResetName",
      "platform.passwordResetEmail",
      "platform.passwordResetRole",
      "platform.passwordResetDaycare",
      "platform.passwordResetNoDaycare",
      "platform.passwordResetWarning",
      "platform.passwordResetConfirm",
      "platform.passwordResetDone",
      "platform.passwordResetFailed",
      "platform.passwordResetConfirmRequired",
      "platform.passwordResetBack",
    ];
    for (const dict of [dictionaries.en, dictionaries.ar]) {
      const keys = new Set(keysOf(dict));
      for (const key of required) expect(keys.has(key), key).toBe(true);
    }
  });
});
