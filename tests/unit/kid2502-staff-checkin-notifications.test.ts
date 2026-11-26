// KID-2502: staff check-in / check-out notify the center's owner + admin
// accounts in-app, exactly once per recipient, and never notify the acting
// account. Every other staff status (sick, vacation, absent, child_sick) stays
// silent.

process.env.TZ = "UTC";

import { beforeEach, describe, expect, it } from "vitest";

import { createAccount } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { dictionaries, feedCopyFor } from "@/lib/i18n";
import {
  createStaff,
  listNotificationsFor,
  logStaffStatus,
  notificationViewCopy,
} from "@/lib/store";
import { pushDeepUrl } from "@/lib/push";
import { seedFixture } from "../helpers";

let iid = "";
let ownerId = "";
let adminId = "";
let actorId = "";
let actorStaffId = "";
let actorName = "";

async function linkAccountToStaff(accountId: string, staffId: string): Promise<void> {
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", staffId, accountId);
}

async function staffNotifications(accountId: string): Promise<any[]> {
  return (await listNotificationsFor(accountId)).filter((r) =>
    String(r.kind).startsWith("staff_")
  );
}

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  ownerId = String(
    (await queryGet("SELECT id FROM account WHERE email = 'trois4ever+admin@gmail.com'"))!.id
  );

  const adminStaff = await queryGet(
    "SELECT id FROM staff WHERE institute_id = ? AND role = 'admin' LIMIT 1",
    iid
  );
  const adminAcc = await createAccount({
    email: `kid2502-admin-${Math.random().toString(36).slice(2)}@test.local`,
    password: "admin-pass",
    fullName: "KID-2502 Admin",
    role: "admin",
  });
  adminId = String(adminAcc.id);
  await linkAccountToStaff(adminId, String(adminStaff!.id));

  actorName = "KID-2502 Teacher";
  const actorStaff = await createStaff({
    instituteId: iid,
    fullName: actorName,
    role: "teacher",
  });
  actorStaffId = String(actorStaff.id);
  const actorAcc = await createAccount({
    email: `kid2502-actor-${Math.random().toString(36).slice(2)}@test.local`,
    password: "actor-pass",
    fullName: actorName,
    role: "staff",
  });
  actorId = String(actorAcc.id);
  await linkAccountToStaff(actorId, actorStaffId);
});

describe("KID-2502 notification fan-out", () => {
  it("notifies the owner and admin accounts once for a check-in, excluding the actor", async () => {
    const log = await logStaffStatus({
      staffId: actorStaffId,
      kind: "checkin",
      note: "Arrived early",
      accountId: actorId,
    });

    for (const accountId of [ownerId, adminId]) {
      const rows = await staffNotifications(accountId);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].kind)).toBe("staff_checkin");
      expect(String(rows[0].activity)).toBe("attendance");
      expect(String(rows[0].ref)).toBe(`staff-status-${String(log.id)}`);
      expect(String(rows[0].institute_id)).toBe(iid);
      const payload = JSON.parse(String(rows[0].payload));
      expect(payload.staffId).toBe(actorStaffId);
      expect(payload.staffName).toBe(actorName);
      expect(payload.status).toBe("checkin");
      expect(payload.note).toBe("Arrived early");
      expect(typeof payload.at).toBe("string");
    }

    expect(await staffNotifications(actorId)).toHaveLength(0);
  });

  it("notifies on check-out with the staff_checkout kind", async () => {
    await logStaffStatus({
      staffId: actorStaffId,
      kind: "out",
      note: "Left at 16:00",
      accountId: actorId,
    });

    for (const accountId of [ownerId, adminId]) {
      const rows = await staffNotifications(accountId);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].kind)).toBe("staff_checkout");
      const payload = JSON.parse(String(rows[0].payload));
      expect(payload.status).toBe("out");
      expect(payload.note).toBe("Left at 16:00");
    }
    expect(await staffNotifications(actorId)).toHaveLength(0);
  });

  it("keeps sick/vacation/absent/child_sick silent", async () => {
    for (const kind of ["sick", "vacation", "absent", "child_sick"]) {
      await logStaffStatus({ staffId: actorStaffId, kind, accountId: actorId });
    }
    for (const accountId of [ownerId, adminId, actorId]) {
      expect(await staffNotifications(accountId)).toHaveLength(0);
    }
  });

  it("does not self-notify an admin who checks in on their own profile", async () => {
    const adminStaffId = String(
      (await queryGet("SELECT staff_id FROM account WHERE id = ?", adminId))!.staff_id
    );
    await logStaffStatus({
      staffId: adminStaffId,
      kind: "checkin",
      accountId: adminId,
    });
    expect(await staffNotifications(adminId)).toHaveLength(0);
    expect(await staffNotifications(ownerId)).toHaveLength(1);
  });
});

describe("KID-2502 notification copy", () => {
  const payload = {
    staffId: "staff-1",
    staffName: "Mona Hassan",
    status: "checkin",
    at: "2026-11-26T08:15:00.000Z",
    note: "Front room",
  };

  it("renders English and Arabic copy from the same payload", () => {
    const en = notificationViewCopy("staff_checkin", payload, feedCopyFor("en"));
    expect(en.title).toBe("Staff check-in: Mona Hassan");
    expect(en.body).toContain("Front room");
    expect(en.body).not.toContain("MISSING:");

    const ar = notificationViewCopy("staff_checkin", payload, feedCopyFor("ar"));
    expect(ar.title).toContain("Mona Hassan");
    expect(ar.title).toBe(dictionaries.ar.feed.staffCheckInTitle.replace("{name}", "Mona Hassan"));
    expect(ar.body).toContain("Front room");
    expect(ar.body).not.toContain("MISSING:");
    expect(ar.title).not.toBe(en.title);
  });

  it("renders the check-out title without a note when the note is empty", () => {
    const view = notificationViewCopy(
      "staff_checkout",
      { ...payload, status: "out", note: "" },
      feedCopyFor("en")
    );
    expect(view.title).toBe("Staff check-out: Mona Hassan");
    expect(view.body).not.toContain("Note:");
  });

  it("deep links to the staff profile in the portal for push and the bell", () => {
    expect(pushDeepUrl("staff_checkin", payload)).toBe("/portal/staff/staff-1");
    expect(pushDeepUrl("staff_checkout", payload)).toBe("/portal/staff/staff-1");
  });
});
