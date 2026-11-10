// KID-1385: pickup-time set/change must notify the child's classroom teachers.
//
// KID-1372 confirmed the gap against the KID-215 spec: a parent registers (or
// changes) today's pickup time and NO in-app notification reached the assigned
// teachers. The fix wires the shared KID-474/KID-480 emitNotifications path
// into lib/store.ts registerCheckInOut (the user-facing pickup write both the
// web action and the mobile route take):
//
//   - recipients = classroom-assigned teacher accounts (account.role
//     staff|carer with a linked active staff row assigned to the child's
//     room); owners/admins (unscoped managers), family links and pickup links
//     are never recipients,
//   - a time change re-emits under a new ref; a SAME-VALUE retry (double tap,
//     network retry, "set it again") dedupes on one (account, ref) row,
//   - the ref is stable per (child, ledger day, registered minute):
//     `pickup-<childId>-<date>-<HH:MM>`,
//   - the payload carries childId/childName/pickupTime/pickupDate; every
//     surface renders a link to the child profile (portal child page, push
//     deep link),
//   - push rides the SAME emission path (emitNotifications →
//     sendPushToAccounts) — no separate push call is added,
//   - a registration refused by the boundary validation (lib/pickup-policy)
//     never reaches the write, so it emits nothing.
//
// Teacher scoping mirrors the KID-56/KID-103 classroom rule the portal
// attendance surface already uses (account → staff → staff_room).

process.env.TZ = "UTC";

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const pushState = vi.hoisted(() => ({
  sends: [] as Array<{ endpoint: string; payload: Record<string, unknown> }>,
}));
vi.mock("web-push", () => ({
  sendNotification: async (subscription: unknown, payload: string) => {
    const endpoint = String((subscription as { endpoint?: string })?.endpoint ?? "");
    pushState.sends.push({ endpoint, payload: JSON.parse(payload) });
  },
}));

// The web action runs a server action against the mocked cookie/headers
// boundary (same harness as the KID-1371 pickup-boundaries suite).
const SESSION_COOKIE = "kiddy_sess";
const sessionCookie = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (name === SESSION_COOKIE ? { value: sessionCookie.value } : undefined),
    set: () => undefined,
  }),
  headers: () =>
    new Headers(sessionCookie.value ? { cookie: `${SESSION_COOKIE}=${sessionCookie.value}` } : undefined),
}));

import { createAccount, createSessionToken } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { linkFamily, listNotificationsFor, notificationViewCopy, registerCheckInOut } from "@/lib/store";
import { pushDeepUrl, savePushSubscription } from "@/lib/push";
import { feedCopyFor } from "@/lib/i18n";
import { seedFixture } from "../helpers";

// The seeded center works Mon-Fri 07:00-18:00 (local = UTC under TZ=UTC); a
// pinned Wednesday keeps the action-level registrations deterministic.
const WEDNESDAY_MORNING = new Date("2026-11-11T10:00:00.000Z");

let iid = "";
let childId = "";
let childName = "";
let roomAId = "";
let teacherId = "";
let teacherOtherRoomId = "";
let carerId = "";
let ownerAccountId = "";
let familyAccountId = "";
let pickupAccountId = "";

/** Classroom teacher fixture: staff row (role 'teacher') + linked account. */
async function createClassroomTeacher(opts: {
  tag: string;
  roomId: string;
  accountRole: "staff" | "carer";
  staffRole?: string;
}): Promise<string> {
  const staffId = `kid1385-staff-${opts.tag}-${Math.random().toString(36).slice(2, 8)}`;
  await queryRun(
    "INSERT INTO staff (id, institute_id, full_name, role, active) VALUES (?, ?, ?, ?, 1)",
    staffId,
    iid,
    `KID-1385 ${opts.tag}`,
    opts.staffRole ?? "teacher"
  );
  await queryRun("INSERT INTO staff_room (staff_id, room_id) VALUES (?, ?) ON CONFLICT DO NOTHING", staffId, opts.roomId);
  const acc = await createAccount({
    email: `${opts.tag}-${Math.random().toString(36).slice(2, 8)}@test.local`,
    password: "teacher-pass",
    fullName: `KID-1385 ${opts.tag}`,
    role: opts.accountRole,
  });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", staffId, String(acc.id));
  return String(acc.id);
}

async function attendanceRows(accountId: string): Promise<any[]> {
  return (await listNotificationsFor(accountId)).filter(
    (r: any) => String(r.activity) === "attendance"
  );
}

beforeEach(async () => {
  pushState.sends = [];
  sessionCookie.value = "";
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const child = (await queryGet("SELECT id, first_name, last_name FROM child WHERE first_name = 'Ella'"))!;
  childId = String(child.id);
  childName = `${child.first_name} ${child.last_name}`;
  roomAId = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  const roomB = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool'"))!.id);
  ownerAccountId = String(
    (await queryGet("SELECT id FROM account WHERE email = 'trois4ever+admin@gmail.com'"))!.id
  );

  // The child's classroom: one teacher (account role 'staff') and one carer
  // (account role 'carer'), both assigned to room A.
  teacherId = await createClassroomTeacher({ tag: "teacher-a", roomId: roomAId, accountRole: "staff" });
  carerId = await createClassroomTeacher({ tag: "carer-a", roomId: roomAId, accountRole: "carer" });
  // A teacher assigned OUTSIDE the child's classroom (Preschool).
  teacherOtherRoomId = await createClassroomTeacher({ tag: "teacher-b", roomId: roomB, accountRole: "staff" });

  // Family + pickup links share the parent app and are never recipients.
  const familyAcc = await createAccount({
    email: `kid1385-family-${Math.random().toString(36).slice(2, 8)}@test.local`,
    password: "family-pass",
    fullName: "KID-1385 Family",
    role: "parent",
  });
  familyAccountId = String(familyAcc.id);
  await linkFamily(familyAccountId, childId, "family");
  const pickupAcc = await createAccount({
    email: `kid1385-pickup-${Math.random().toString(36).slice(2, 8)}@test.local`,
    password: "pickup-pass",
    fullName: "KID-1385 Pickup",
    role: "parent",
  });
  pickupAccountId = String(pickupAcc.id);
  await linkFamily(pickupAccountId, childId, "pickup");

  process.env.VAPID_PUBLIC_KEY = "vapid-public-test";
  process.env.VAPID_PRIVATE_KEY = "vapid-private-test";
  process.env.VAPID_SUBJECT = "mailto:kiddy-push@kiddy.local";
});

afterEach(() => {
  sessionCookie.value = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("KID-1385 store emission: set, change, retry dedup", () => {
  it("a pickup time SET notifies the assigned classroom teacher exactly once", async () => {
    const { row } = await registerCheckInOut({
      childId,
      accountId: pickupAccountId,
      type: "out",
      at: new Date("2026-11-11T15:30:00.000Z"),
    });
    expect(String(row.type)).toBe("out");

    for (const accountId of [teacherId, carerId]) {
      const rows = await attendanceRows(accountId);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].kind)).toBe("pickup_time");
      expect(String(rows[0].ref)).toBe(`pickup-${childId}-2026-11-11-15:30`);
      expect(String(rows[0].institute_id)).toBe(iid);
      const payload = JSON.parse(String(rows[0].payload));
      expect(payload.childId).toBe(childId);
      expect(payload.childName).toBe(childName);
      expect(payload.pickupTime).toBe("15:30");
      expect(payload.pickupDate).toBe("2026-11-11");
    }
  });

  it("a time CHANGE notifies the classroom teacher again under a fresh ref", async () => {
    await registerCheckInOut({ childId, accountId: pickupAccountId, type: "out", at: new Date("2026-11-11T15:30:00.000Z") });
    await registerCheckInOut({ childId, accountId: pickupAccountId, type: "out", at: new Date("2026-11-11T16:45:00.000Z") });
    const rows = await attendanceRows(teacherId);
    expect(rows).toHaveLength(2);
    const refs = new Set(rows.map((r) => String(r.ref)));
    expect(refs).toEqual(
      new Set([`pickup-${childId}-2026-11-11-15:30`, `pickup-${childId}-2026-11-11-16:45`])
    );
  });

  it("a SAME-VALUE retry does not duplicate — one row per (child, day, minute)", async () => {
    await registerCheckInOut({ childId, accountId: pickupAccountId, type: "out", at: new Date("2026-11-11T15:30:00.000Z") });
    // The double-tap retry: the in-place update path re-runs the emission,
    // but the dated-minute ref makes the second insert a no-op.
    const again = await registerCheckInOut({ childId, accountId: pickupAccountId, type: "out", at: new Date("2026-11-11T15:30:00.000Z") });
    expect(again.wasUpdate).toBe(true);
    const rows = await attendanceRows(teacherId);
    expect(rows).toHaveLength(1);
    expect(String(rows[0].ref)).toBe(`pickup-${childId}-2026-11-11-15:30`);
    // Same minute with different seconds is the same registered value.
    await registerCheckInOut({ childId, accountId: pickupAccountId, type: "out", at: new Date("2026-11-11T15:30:59.000Z") });
    expect(await attendanceRows(teacherId)).toHaveLength(1);
    expect(await attendanceRows(carerId)).toHaveLength(1);
  });

  it("a NEW day's same pickup time emits fresh (the date in the ref resets the dedup)", async () => {
    await registerCheckInOut({ childId, accountId: pickupAccountId, type: "out", at: new Date("2026-11-11T15:30:00.000Z") });
    expect(await attendanceRows(teacherId)).toHaveLength(1);
    // Thursday's ledger (KID-1371 same-day rule keeps the value on ITS day):
    // the dated ref differs, so Wednesday's row does not suppress it.
    await registerCheckInOut({ childId, accountId: pickupAccountId, type: "out", at: new Date("2026-11-12T09:30:00.000Z") });
    const rows = await attendanceRows(teacherId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => String(r.ref)))).toEqual(
      new Set([`pickup-${childId}-2026-11-11-15:30`, `pickup-${childId}-2026-11-12-09:30`])
    );
  });
});

describe("KID-1385 recipient scoping", () => {
  it("a teacher assigned OUTSIDE the classroom is never notified", async () => {
    await registerCheckInOut({ childId, accountId: pickupAccountId, type: "out", at: new Date("2026-11-11T15:30:00.000Z") });
    expect(await attendanceRows(teacherOtherRoomId)).toHaveLength(0);
  });

  it("family and pickup links, and the unscoped owner, are never notified", async () => {
    await registerCheckInOut({ childId, accountId: pickupAccountId, type: "out", at: new Date("2026-11-11T15:30:00.000Z") });
    for (const accountId of [familyAccountId, pickupAccountId, ownerAccountId]) {
      expect(await attendanceRows(accountId)).toHaveLength(0);
      expect(await listNotificationsFor(accountId)).toHaveLength(0);
    }
  });

  it("a check-in registration (type 'in') is not a pickup change — no emission", async () => {
    await registerCheckInOut({ childId, accountId: pickupAccountId, type: "in", at: new Date("2026-11-11T10:30:00.000Z") });
    expect(await attendanceRows(teacherId)).toHaveLength(0);
    expect(await attendanceRows(carerId)).toHaveLength(0);
  });

  it("an inactive staff assignment in the room is excluded", async () => {
    const staff = await queryGet("SELECT id FROM staff WHERE full_name = ?", "KID-1385 teacher-a");
    await queryRun("UPDATE staff SET active = 0 WHERE id = ?", String(staff!.id));
    await registerCheckInOut({ childId, accountId: pickupAccountId, type: "out", at: new Date("2026-11-11T15:30:00.000Z") });
    expect(await attendanceRows(teacherId)).toHaveLength(0);
    expect(await attendanceRows(carerId)).toHaveLength(1);
  });
});

describe("KID-1385 web action gate (checkInOutAction)", () => {
  type NextError = { digest?: unknown; message: string };
  async function digest(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
    } catch (err) {
      const digest = String((err as NextError)?.digest ?? "");
      if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
      throw err;
    }
    throw new Error("expected the action to redirect");
  }

  async function pickupSession(): Promise<void> {
    const acc = await createAccount({
      email: `kid1385-actor-${Math.random().toString(36).slice(2, 8)}@test.local`,
      password: "x",
      fullName: "KID-1385 Pickup Actor",
      role: "parent",
    });
    await linkFamily(String(acc.id), childId, "pickup");
    sessionCookie.value = createSessionToken({
      accountId: String(acc.id),
      role: "parent",
      email: String(acc.email),
      emailConfirmed: true,
    } as never);
  }

  it("a valid action registration reaches the classroom teacher", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(WEDNESDAY_MORNING);
    await pickupSession();
    const { checkInOutAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "out");
    fd.set("pickupAt", "2026-11-11T15:30");
    expect(await digest(() => checkInOutAction(fd))).toBe(`/child/${childId}`);
    const rows = await attendanceRows(teacherId);
    expect(rows).toHaveLength(1);
    expect(String(rows[0].ref)).toBe(`pickup-${childId}-2026-11-11-15:30`);
  });

  it("a validation failure (past pickup time) writes and emits NOTHING", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(WEDNESDAY_MORNING);
    await pickupSession();
    const { checkInOutAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "out");
    fd.set("pickupAt", "2026-11-11T08:30"); // before the pinned 10:00 clock
    const res = (await checkInOutAction(fd)) as { error?: string } | undefined;
    expect(res?.error).toContain("past");
    for (const accountId of [teacherId, carerId, teacherOtherRoomId]) {
      expect(await attendanceRows(accountId)).toHaveLength(0);
    }
  });
});

describe("KID-1385 push rides the existing emission path", () => {
  it("a subscribed teacher gets the push with the child-portal deep link and localized title — one send per fresh row", async () => {
    const endpoint = `https://push.test/sub-kid1385-${Math.random().toString(36).slice(2)}`;
    await savePushSubscription(teacherId, {
      endpoint,
      keys: { p256dh: "p256dh-test", auth: "auth-test" },
    });
    await registerCheckInOut({ childId, accountId: pickupAccountId, type: "out", at: new Date("2026-11-11T15:30:00.000Z") });
    expect(pushState.sends).toHaveLength(1);
    expect(pushState.sends[0].endpoint).toBe(endpoint);
    expect(pushState.sends[0].payload.url).toBe(`/portal/children/${childId}`);
    expect(pushState.sends[0].payload.tag).toBe(`pickup-${childId}-2026-11-11-15:30`);
    const payloadInRow = { childId, childName, pickupTime: "15:30", pickupDate: "2026-11-11" };
    const view = notificationViewCopy("pickup_time", payloadInRow, feedCopyFor("en"));
    expect(view.title).toBe(`Pickup time set for ${childName} at 15:30`);
    expect(pushState.sends[0].payload.title).toBe(view.title);
    // No extra body copy shipped for this kind (title carries name + time).

    // Same-value retry: no new row, and the push fan-out does not re-send.
    await registerCheckInOut({ childId, accountId: pickupAccountId, type: "out", at: new Date("2026-11-11T15:30:00.000Z") });
    expect(pushState.sends).toHaveLength(1);
  });

  it("pushDeepUrl resolves the child profile and falls back to the attendance board", () => {
    expect(pushDeepUrl("pickup_time", {})).toBe("/portal/attendance");
  });
});

describe("KID-1385 consistency: the notification links to the child profile", () => {
  it("the payload + view carry what the surfaces need (childId namespaced by pickupDate)", async () => {
    await registerCheckInOut({ childId, accountId: pickupAccountId, type: "out", at: new Date("2026-11-11T15:30:00.000Z") });
    const rows = await attendanceRows(teacherId);
    const payload = JSON.parse(String(rows[0].payload));
    expect(payload.childId).toBe(childId);
    // The portal row renders the child profile link from the payload.
    const page = (await import("node:fs")).readFileSync("app/portal/notifications/page.tsx", "utf8");
    expect(page).toContain('pickup_time');
    expect(page).toContain('/portal/children/${childId}');
  });
});
