import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { createAccount } from "@/lib/auth";
import { ensureSchema, queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let iid: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
});

async function secondInstitute(): Promise<{ id: string; roomId: string }> {
  const other = await store.seedInstitute({ name: "Other Center" });
  const room = await store.createRoom(other.id as string, "Other Room", 10);
  return { id: String(other.id), roomId: String(room.id) };
}

describe("KID-173: link existing centre owner login to unlinked staff", () => {
  it("links admin@sunshinedaycare.test to Maria Lopez in same institute (seed case)", async () => {
    const staff = await queryGet("SELECT id FROM staff WHERE lower(full_name) LIKE '%maria lopez%'");
    const acc = await queryGet("SELECT id, staff_id FROM account WHERE lower(email)=?", "admin@sunshinedaycare.test");
    expect(staff).toBeTruthy();
    expect(acc).toBeTruthy();
    // Unlink first to simulate pre-fix state
    await queryRun("UPDATE account SET staff_id=null WHERE lower(email)=?", "admin@sunshinedaycare.test");
    await ensureSchema();
    const after = await queryGet("SELECT staff_id FROM account WHERE lower(email)=?", "admin@sunshinedaycare.test");
    expect(after?.staff_id).toBe(String(staff?.id));
  });

  it("is idempotent (second run changes nothing)", async () => {
    await queryRun("UPDATE account SET staff_id=null WHERE lower(email)=?", "admin@sunshinedaycare.test");
    await ensureSchema();
    const before = await queryGet("SELECT staff_id FROM account WHERE lower(email)=?", "admin@sunshinedaycare.test");
    await ensureSchema();
    await ensureSchema();
    const after = await queryGet("SELECT staff_id FROM account WHERE lower(email)=?", "admin@sunshinedaycare.test");
    expect(after?.staff_id).toBe(before?.staff_id);
  });

  it("never touches a parent account", async () => {
    const other = await secondInstitute();
    await store.createChild({ instituteId: other.id, firstName: "A", lastName: "B", roomId: other.roomId });
    const parent = await createAccount({ email: "parent-k173@example.com", password: "x", fullName: "Parent K173", role: "parent" });
    await queryRun("UPDATE account SET staff_id=null WHERE id=?", parent.id);
    await ensureSchema();
    const after = await queryGet("SELECT staff_id FROM account WHERE id=?", parent.id);
    expect(after?.staff_id).toBeNull();
  });

  it("only links within same institute", async () => {
    const other = await secondInstitute();
    await queryRun("INSERT INTO staff (id, institute_id, full_name, role, created_at) VALUES (?, ?, ?, 'admin', ?)", "s-other-maria", other.id, "Maria Lopez", "2026-01-01");
    const acc = await createAccount({ email: "other-maria@example.com", password: "x", fullName: "Maria Lopez", role: "owner" });
    await queryRun("UPDATE account SET staff_id=null WHERE id=?", acc.id);
    await ensureSchema();
    const after = await queryGet("SELECT staff_id FROM account WHERE id=?", acc.id);
    expect(after?.staff_id).toBeNull();
  });
});
