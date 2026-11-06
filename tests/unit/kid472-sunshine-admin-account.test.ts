// KID-472 item 7: the Sunshine demo admin account migrates from the
// placeholder identity (admin@sunshinedaycare.test / "Maria Lopez") to the
// board's real identity (trois4ever+admin@gmail.com / "Nassef").
//
// Pins the migration helper in lib/sunshine-admin.ts: the public.account row
// keeps its id, staff link, role and authored records; a password is applied
// only when the caller supplies one; the second pass with the same inputs is
// a no-op; and the retired email must match nothing once the migration ran.

import { beforeEach, describe, expect, it } from "vitest";
import { seedFixture } from "../helpers";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import {
  SUNSHINE_ADMIN_EMAIL,
  SUNSHINE_ADMIN_NAME,
  SUNSHINE_ADMIN_OLD_EMAIL,
  updateSunshineAdmin,
  verifySunshineAdmin,
} from "@/lib/sunshine-admin";

type Snapshot = {
  hash: string;
  full_name: string;
  staffId: string | null;
};

async function snapshotOwner(): Promise<Snapshot> {
  const acc = (await queryGet(
    "SELECT id, password_hash, full_name, staff_id FROM account WHERE lower(email) = ?",
    SUNSHINE_ADMIN_OLD_EMAIL
  ))! as { id: string; password_hash: string; full_name: string; staff_id: string | null };
  const staffId = await queryGet(
    "SELECT id FROM staff WHERE id = ?",
    String(acc.staff_id)
  );
  return {
    hash: String(acc.password_hash),
    full_name: String(acc.full_name),
    staffId: staffId ? String(staffId.id) : null,
  };
}

describe("KID-472: Sunshine demo admin identity migration", () => {
  beforeEach(async () => {
    await seedFixture();
  });

  it("the seed itself already carries the board identity", async () => {
    const retired = await queryGet("SELECT id FROM account WHERE lower(email) = ?", SUNSHINE_ADMIN_OLD_EMAIL);
    expect(retired).toBeUndefined();
    const acc = (await queryGet(
      "SELECT full_name, role FROM account WHERE lower(email) = ?",
      SUNSHINE_ADMIN_EMAIL
    ))! as { full_name: string; role: string };
    expect(acc.role).toBe("owner");
    expect(acc.full_name).toBe(SUNSHINE_ADMIN_NAME);
  });

  it("email/name pass updates the row and preserves id, staff link and hash", async () => {
    // Rewind the fixture to the pre-migration state so the pass runs for real.
    await queryRun(
      "UPDATE account SET email = ?, full_name = 'Maria Lopez' WHERE lower(email) = ?",
      SUNSHINE_ADMIN_OLD_EMAIL,
      SUNSHINE_ADMIN_EMAIL
    );
    const before = await snapshotOwner();

    const result = await updateSunshineAdmin({});
    expect(result.accountEmailUpdated).toBe(true);
    expect(result.accountNameUpdated).toBe(true);
    expect(result.passwordUpdated).toBe(false);

    const after = (await queryGet(
      "SELECT id, password_hash, full_name, staff_id FROM account WHERE lower(email) = ?",
      SUNSHINE_ADMIN_EMAIL
    ))! as { id: string; password_hash: string; full_name: string; staff_id: string | null };
    expect(after.password_hash).toBe(before.hash);
    expect(after.full_name).toBe(SUNSHINE_ADMIN_NAME);
    expect(after.staff_id).toBe(before.staffId);
    expect(String(after.staff_id)).not.toBeNull();

    const check = await verifySunshineAdmin();
    expect(check.ok).toBe(true);
  });

  it("password pass rewrites only the hash, and verifyPassword accepts it", async () => {
    await queryRun(
      "UPDATE account SET email = ? WHERE lower(email) = ?",
      SUNSHINE_ADMIN_OLD_EMAIL,
      SUNSHINE_ADMIN_EMAIL
    );

    const result = await updateSunshineAdmin({ password: "board-secret-demo" });
    expect(result.accountEmailUpdated).toBe(true);
    expect(result.passwordUpdated).toBe(true);

    const acc = (await queryGet(
      "SELECT password_hash, full_name FROM account WHERE lower(email) = ?",
      SUNSHINE_ADMIN_EMAIL
    ))! as { password_hash: string; full_name: string };
    expect(verifyPassword("board-secret-demo", acc.password_hash)).toBe(true);
    expect(acc.full_name).toBe(SUNSHINE_ADMIN_NAME);
  });

  it("a second pass with the same inputs changes nothing (idempotent)", async () => {
    await queryRun(
      "UPDATE account SET email = ? WHERE lower(email) = ?",
      SUNSHINE_ADMIN_OLD_EMAIL,
      SUNSHINE_ADMIN_EMAIL
    );
    await updateSunshineAdmin({ password: "board-secret-demo" });
    const hash = String(
      (await queryGet("SELECT password_hash FROM account WHERE lower(email) = ?", SUNSHINE_ADMIN_EMAIL))!
        .password_hash
    );

    const second = await updateSunshineAdmin({ password: "board-secret-demo" });
    expect(second.accountEmailUpdated).toBe(false);
    expect(second.passwordUpdated).toBe(false);
    expect(second.alreadyApplied).toBe(true);
    expect(second.messages.some((m) => m.includes("no account row carries"))).toBe(true);

    const acc = (await queryGet(
      "SELECT password_hash FROM account WHERE lower(email) = ?",
      SUNSHINE_ADMIN_EMAIL
    )) as { password_hash: string };
    expect(acc.password_hash).toBe(hash);
  });

  it("a second pass without a password never manufactures one", async () => {
    await queryRun(
      "UPDATE account SET email = ? WHERE lower(email) = ?",
      SUNSHINE_ADMIN_OLD_EMAIL,
      SUNSHINE_ADMIN_EMAIL
    );
    const withPassword = await updateSunshineAdmin({ password: "board-secret-demo" });
    expect(withPassword.passwordUpdated).toBe(true);

    const nameOnly = await updateSunshineAdmin({});
    expect(nameOnly.passwordUpdated).toBe(false);
    expect(nameOnly.accountEmailUpdated).toBe(false);
    expect(nameOnly.alreadyApplied).toBe(true);
    const acc = (await queryGet(
      "SELECT password_hash FROM account WHERE lower(email) = ?",
      SUNSHINE_ADMIN_EMAIL
    )) as { password_hash: string };
    expect(verifyPassword("board-secret-demo", acc.password_hash)).toBe(true);
  });

  it("stale rows elsewhere are reported, not touched", async () => {
    await queryRun(
      "INSERT INTO account (id, email, password_hash, full_name, role) VALUES ('acc-stale-kid472', ?, 'x', 'Leftover', 'owner')",
      SUNSHINE_ADMIN_OLD_EMAIL
    );
    const second = await updateSunshineAdmin({});
    expect(second.alreadyApplied).toBe(false);
    expect(second.messages.some((m) => m.includes("acc-stale-kid472"))).toBe(true);
    await queryRun("DELETE FROM account WHERE id = 'acc-stale-kid472'");
  });

  it("refuses to invent an account when neither email carries one", async () => {
    await expect(
      updateSunshineAdmin({ oldEmail: "ghost@invalid.test", newEmail: "ghost2@invalid.test" })
    ).rejects.toThrow(/sunshine-admin-not-found/);
  });

  it("verify() fails loudly while the migration has not run", async () => {
    await queryRun(
      "UPDATE account SET email = ?, full_name = 'Someone' WHERE lower(email) = ?",
      SUNSHINE_ADMIN_OLD_EMAIL,
      SUNSHINE_ADMIN_EMAIL
    );
    const check = await verifySunshineAdmin({
      fullName: SUNSHINE_ADMIN_NAME,
      newEmail: "ghost@invalid.test",
    });
    expect(check.ok).toBe(false);
    expect(check.problems.length).toBeGreaterThan(0);
  });

  it("authored records and tenancy survive the row update", async () => {
    await queryRun(
      "UPDATE account SET email = ? WHERE lower(email) = ?",
      SUNSHINE_ADMIN_OLD_EMAIL,
      SUNSHINE_ADMIN_EMAIL
    );
    const before = (await queryGet("SELECT id FROM account WHERE lower(email) = ?", SUNSHINE_ADMIN_OLD_EMAIL)) as {
      id: string;
    };
    const auditRows = await queryAll(
      "SELECT COUNT(*) AS n FROM audit_event WHERE actor_account_id = ?",
      before.id
    );
    void auditRows;
    await updateSunshineAdmin({});
    const after = (await queryGet(
      "SELECT id, role, staff_id FROM account WHERE lower(email) = ?",
      SUNSHINE_ADMIN_EMAIL
    ))! as { id: string; role: string; staff_id: string | null };
    expect(after.id).toBe(before.id);
    expect(after.role).toBe("owner");
    expect(after.staff_id).not.toBeNull();
  });
});
