// KID-2447: auto check-out at the END of the center's working hours.
//
// The founder reported children still marked "checked in" after the daycare
// closed. The old sweep only fired 3 hours after closing, so the roster stayed
// wrong for the whole evening. This suite pins the new behavior:
//
//   - children still checked in at close are checked out at the close instant,
//     with no pickup person and the distinct `auto_end_of_day` source,
//   - nothing happens before close or on a closed day,
//   - a manual checkout before the job is never duplicated,
//   - the job reads the current working-hours config at run time,
//   - admins/owners and the children's assigned teachers get one notification,
//   - repeated sweeps are idempotent (no duplicate ledger rows or notices).

process.env.TZ = "UTC";

import { beforeEach, describe, expect, it } from "vitest";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { createAccount } from "@/lib/auth";
import { seedFixture, mustGet } from "../helpers";
import {
  runAutoCheckoutSweep,
  saveWorkingHours,
  systemAccountId,
  AUTO_CHECKOUT_SOURCE,
  listNotificationsFor,
  createStaff,
} from "@/lib/store";

let iid: string;
let childId: string;
let roomId: string;

const MONDAY = new Date(2026, 0, 5, 0, 0, 0, 0);

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const child = (await queryGet("SELECT id, room_id FROM child WHERE first_name = 'Ella'"))!;
  childId = String(child.id);
  roomId = String(child.room_id);
});

async function checkedInAt(hour: number, minute = 0, day = MONDAY): Promise<string> {
  const at = new Date(day);
  at.setHours(hour, minute, 0, 0);
  await queryRun(
    "INSERT INTO check_in (id, child_id, account_id, type, is_edit, recorded_at) VALUES (?, ?, ?, 'in', 0, ?)",
    `in-${day.getTime()}-${hour}-${minute}`,
    childId,
    await systemAccountId(),
    at.toISOString()
  );
  return at.toISOString();
}

function at(hour: number, minute = 0, day = MONDAY): Date {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function outRows() {
  return queryAll(
    "SELECT * FROM check_in WHERE child_id = ? AND type = 'out' ORDER BY recorded_at DESC",
    childId
  );
}

describe("KID-2447 end-of-working-hours auto check-out", () => {
  it("checks a still-in child out at closing time with the auto source", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    await checkedInAt(8);

    const res = await runAutoCheckoutSweep(iid, at(18, 0));

    expect(res.children.map((c) => String(c.id))).toContain(childId);
    const out = await mustGet(
      "SELECT * FROM check_in WHERE child_id = ? AND type = 'out' ORDER BY recorded_at DESC LIMIT 1",
      childId
    );
    expect(String(out.source)).toBe(AUTO_CHECKOUT_SOURCE);
    expect(String(out.account_id)).toBe(await systemAccountId());
    expect(out.recorded_at).toBe(at(18, 0).toISOString());
  });

  it("does nothing before closing time", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    await checkedInAt(8);

    const res = await runAutoCheckoutSweep(iid, at(17, 59));

    expect(res.children).toHaveLength(0);
    expect(await outRows()).toHaveLength(0);
    expect(res.reason).toMatch(/before cutoff/);
  });

  it("also checks out a child checked in after closing, so nobody stays in all evening", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    await checkedInAt(18, 10);

    const res = await runAutoCheckoutSweep(iid, at(18, 15));

    expect(res.children.map((c) => String(c.id))).toContain(childId);
    const outs = await outRows();
    expect(outs).toHaveLength(1);
    expect(String(outs[0].source)).toBe(AUTO_CHECKOUT_SOURCE);
  });

  it("skips a closed day", async () => {
    // Only Monday is open; Tuesday is a closed day.
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    const tuesday = new Date(2026, 0, 6);
    await checkedInAt(8, 0, tuesday);

    const res = await runAutoCheckoutSweep(iid, at(19, 0, tuesday));

    expect(res.children).toHaveLength(0);
    expect(await outRows()).toHaveLength(0);
    expect(res.reason).toMatch(/no working hours/);
  });

  it("does not duplicate a manual checkout made before the job", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    await checkedInAt(8);
    await queryRun(
      "INSERT INTO check_in (id, child_id, account_id, type, is_edit, recorded_at) VALUES (?, ?, ?, 'out', 0, ?)",
      "manual-out",
      childId,
      await systemAccountId(),
      at(17, 30).toISOString()
    );

    const res = await runAutoCheckoutSweep(iid, at(18, 5));

    expect(res.children).toHaveLength(0);
    const outs = await outRows();
    expect(outs).toHaveLength(1);
    expect(outs[0].source ?? null).toBeNull();
  });

  it("reads the current working-hours config at run time", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    await checkedInAt(8);

    // 17:30 is before the stored 18:00 close.
    expect((await runAutoCheckoutSweep(iid, at(17, 30))).children).toHaveLength(0);

    // The admin shortens the day to 17:00; the next run must honor it.
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "17:00" } });
    const res = await runAutoCheckoutSweep(iid, at(17, 30));
    expect(res.children.map((c) => String(c.id))).toContain(childId);
  });

  it("is idempotent: a second sweep adds no ledger row or notification", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    await checkedInAt(8);

    await runAutoCheckoutSweep(iid, at(18, 1));
    const second = await runAutoCheckoutSweep(iid, at(18, 1));

    expect(second.children).toHaveLength(0);
    expect(await outRows()).toHaveLength(1);
  });
});

describe("KID-2447 auto check-out notifications", () => {
  it("notifies the center owner/admin and the child's assigned teacher once", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    await checkedInAt(8);

    // Assigned teacher: a staff row in the child's room plus a login.
    const teacherStaff = await createStaff({
      instituteId: iid,
      fullName: "Teacher One",
      role: "carer",
      roomIds: [roomId],
    });
    const teacher = await createAccount({
      email: "kid2447-teacher@example.test",
      password: "kiddy-teacher",
      fullName: "Teacher One",
      role: "staff",
    });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", teacherStaff.id as string, teacher.id);

    const owner = await mustGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1");

    await runAutoCheckoutSweep(iid, at(18, 1));
    // A repeat run must not emit a second summary (per-center/day ref).
    await runAutoCheckoutSweep(iid, at(18, 2));

    for (const accountId of [String(owner.id), String(teacher.id)]) {
      const rows = (await listNotificationsFor(accountId)).filter(
        (n) => String(n.kind) === "auto_checkout"
      );
      expect(rows).toHaveLength(1);
      const payload = JSON.parse(String(rows[0].payload));
      expect(payload.count).toBe(1);
      expect(payload.childNames).toEqual(["Ella Nguyen"]);
      expect(payload.autoSource).toBe(AUTO_CHECKOUT_SOURCE);
    }
  });

  it("does not notify a teacher assigned to another room", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    await checkedInAt(8);

    const otherRoom = (await queryGet(
      "SELECT id FROM room WHERE id <> ? AND institute_id = ? LIMIT 1",
      roomId,
      iid
    ))!;
    const otherStaff = await createStaff({
      instituteId: iid,
      fullName: "Other Room Teacher",
      role: "carer",
      roomIds: [String(otherRoom.id)],
    });
    const other = await createAccount({
      email: "kid2447-other@example.test",
      password: "kiddy-other",
      fullName: "Other Room Teacher",
      role: "staff",
    });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", otherStaff.id as string, other.id);

    await runAutoCheckoutSweep(iid, at(18, 1));

    const rows = (await listNotificationsFor(String(other.id))).filter(
      (n) => String(n.kind) === "auto_checkout"
    );
    expect(rows).toHaveLength(0);
  });
});
