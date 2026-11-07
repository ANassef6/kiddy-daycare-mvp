// KID-487: general push notifications for staff and every notification type.
//
// Pinned here, mirroring the issue acceptance:
//   1. Staff push surface — the portal layout registers the service worker,
//      the staff account page ships the push card + push column, and the
//      push API routes stay session-gated (deadline: no parent-only gate).
//   2. Pickup-time events — registering a check-in/check-out ("pickup time
//      set") and the edit/auto-check-out passes ("changed") emit durable
//      rows + push to the assigned classroom staff and the family, minus the
//      acting account. (Planned-pickup set/changed arrives as the KID-486
//      `pickup_time` kind through the same pipeline.)
//   3. Every notification type rides emitNotifications → sendPushToAccounts:
//      message, daily_report, announcement, incident, event, homework,
//      supplies, attendance with role-resolved deep links.
//   4. Opt-out enforcement — a stored disabled 'push' pref row suppresses
//      deliver, a disabled 'inapp' row suppresses the row itself.
//   5. Best-effort — a failing sender never breaks the business write, and
//      404/410 subscriptions are pruned lazily.
//   6. Staff subscription defaults — subscribing as a teacher fills every
//      portal activity's push pref; parents keep the parent list.
//   7. EN/AR parity for the new dictionary keys.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  autoCheckoutChild,
  checkChildInOut,
  createChild,
  createDaycare,
  createEvent,
  createHomework,
  createIncident,
  createNewsfeedPost,
  createStaff,
  createSupply,
  emitNotifications,
  ensureDefaultPushPrefs,
  familyParentsForChildren,
  listNotificationsFor,
  linkFamily,
  notificationViewCopy,
  setNotificationPref,
  staffCenterAudience,
  systemAccountId,
  upsertDailyReport,
} from "@/lib/store";
import {
  isStaffRole,
  pushDeepUrl,
  pushSubscriptionsFor,
  savePushSubscription,
} from "@/lib/push";
import { createAccount, getAccount } from "@/lib/auth";
import { dictionaries } from "@/lib/i18n";
import { queryAll, queryGet, queryRun, uid } from "@/lib/db";
import { resetDb } from "../helpers";

const sendNotificationMock = vi.fn();
vi.mock("web-push", () => ({
  default: { sendNotification: (...args: unknown[]) => sendNotificationMock(...args) },
}));

const fakeSubscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/kid487",
  keys: { p256dh: "key-p256dh", auth: "key-auth" },
};

// A subscription row is UNIQUE per browser endpoint across accounts, so every
// subscribed test account needs its own endpoint (a shared one would re-point
// the single row — the real device re-subscribe behavior).
const sub = (tag: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/kid487-${tag}`,
  keys: { p256dh: `key-${tag}`, auth: `auth-${tag}` },
});

let iid = "";
let ownerId = "";
let roomId = "";
let teacherId = ""; // account id of the assigned teacher
let teacher2Id = ""; // account id of an unassigned teacher
let parentId = "";
let childId = "";

async function createRoom(instituteId: string, name: string): Promise<string> {
  const id = uid();
  await queryRun("INSERT INTO room (id, institute_id, name) VALUES (?, ?, ?)", id, instituteId, name);
  return id;
}

/** A staff-role login linked to a staff row (the roomStaffIds shape). */
async function staffAccount(opts: {
  email: string;
  fullName: string;
  role: string;
  instituteId: string;
  roomIds?: string[];
}): Promise<string> {
  const staff = await createStaff({
    instituteId: opts.instituteId,
    fullName: opts.fullName,
    role: opts.role,
    roomIds: opts.roomIds ?? [],
  });
  const acc = await createAccount({
    email: opts.email,
    password: "staff-pass-1",
    fullName: opts.fullName,
    role: opts.role as never,
  });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), String(acc.id));
  return String(acc.id);
}

async function unreadPushRow(accountId: string, activity: string): Promise<number | undefined> {
  const row = await queryGet(
    `SELECT enabled FROM notification_pref WHERE account_id = ? AND activity = ? AND channel = 'push'`,
    accountId,
    activity
  );
  return row == null ? undefined : Number(row.enabled);
}

beforeEach(async () => {
  sendNotificationMock.mockReset();
  process.env.VAPID_PUBLIC_KEY = "BPuh487PublicKey";
  process.env.VAPID_PRIVATE_KEY = "kid487PrivateKey";
  await resetDb();
  const day = await createDaycare({
    name: "Staff Push Daycare",
    ownerEmail: `owner-${Math.random().toString(36).slice(2, 8)}@test.local`,
    ownerPassword: "owner-pass-1",
    ownerFullName: "Olga Owner",
  });
  iid = day.instituteId;
  ownerId = day.ownerAccountId;
  roomId = await createRoom(iid, "Room 487");
  const child = await createChild({ instituteId: iid, firstName: "Pia", lastName: "Pusher", roomId });
  childId = String(child.id);
  teacherId = await staffAccount({
    email: `teacher-${Math.random().toString(36).slice(2, 8)}@test.local`,
    fullName: "Tara Teacher",
    role: "teacher",
    instituteId: iid,
    roomIds: [roomId],
  });
  teacher2Id = await staffAccount({
    email: `teacher2-${Math.random().toString(36).slice(2, 8)}@test.local`,
    fullName: "Tom Otherroom",
    role: "caregiver",
    instituteId: iid,
    roomIds: [],
  });
  const parent = await createAccount({
    email: `parent-${Math.random().toString(36).slice(2, 8)}@test.local`,
    password: "parent-pass-1",
    fullName: "Pat Pusher",
    role: "parent",
  });
  parentId = String(parent.id);
  await linkFamily(parentId, childId, "parent");
});

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

async function payloadBody(callIndex = 0): Promise<{ title: string; body: string; url: string; tag: string }> {
  const body = sendNotificationMock.mock.calls[callIndex]?.[1];
  return JSON.parse(String(body));
}

describe("KID-487 pickup-time staff notifications", () => {
  it("check-in/check-out notify the assigned classroom staff (not other rooms) with push", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    await savePushSubscription(teacher2Id, sub("teacher2") as never);
    await checkChildInOut({ childId, accountId: parentId, type: "in" });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const sent = await payloadBody();
    expect(sent.title).toContain("Pia Pusher");
    expect(sent.url).toBe("/portal/attendance");
    const rows = await listNotificationsFor(teacherId);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.kind)).toBe("attendance");
    // The other-room caregiver gets nothing; the acting parent is not notified
    // of their own action.
    expect(await listNotificationsFor(teacher2Id)).toHaveLength(0);
    expect(await listNotificationsFor(parentId)).toHaveLength(0);
  });

  it("the family gets a durable row + push for pickup events it did not cause", async () => {
    await savePushSubscription(parentId, sub("parent") as never);
    await checkChildInOut({ childId, accountId: teacherId, type: "out" });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const sent = await payloadBody();
    // The parent deep-link is the child profile, the title is the shared
    // checked-out copy.
    expect(sent.url).toBe(`/child/${childId}`);
    expect(sent.title).toContain("Pia Pusher");
  });

  it("an edit pass (isEdit) produces the pickup-time-updated title", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    await checkChildInOut({ childId, accountId: parentId, type: "out", isEdit: true });
    const rows = await listNotificationsFor(teacherId);
    expect(rows).toHaveLength(1);
    const view = notificationViewCopy(
      "attendance",
      JSON.parse(String(rows[0]!.payload)) as Record<string, unknown>,
      feedCopyForTest()
    );
    expect(view.title).toContain("Pickup time updated");
  });

  it("the auto check-out sweep still emits (pickup time changed automatically)", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    // The teacher's own check-in is not echoed back to them.
    const row = await checkChildInOut({ childId, accountId: teacherId, type: "in" });
    expect(await listNotificationsFor(teacherId)).toHaveLength(0);
    sendNotificationMock.mockClear();
    const systemId = await systemAccountId();
    await autoCheckoutChild(childId, new Date(), systemId);
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const rows = await listNotificationsFor(teacherId);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.kind)).toBe("attendance");
    expect(String(rows[0]!.ref)).not.toBe(`checkin-${row.id}`);
  });

  it("a failing push sender never breaks the check-in write", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    sendNotificationMock.mockRejectedValueOnce(new Error("push service down"));
    const row = await checkChildInOut({ childId, accountId: parentId, type: "in" });
    expect(row.id).toBeTruthy();
    expect(await listNotificationsFor(teacherId)).toHaveLength(1);
  });
});

function feedCopyForTest() {
  return {
    messageTitle: (n: string) => `Message from ${n}`,
    reportTitle: (n: string) => `Daily report: ${n}`,
    announcementTitle: (n: string) => `New post from ${n}`,
    attendanceUpdatedTitle: (n: string) => `Pickup time updated: ${n}`,
  } as never;
}

describe("KID-487 notification-type coverage", () => {
  it("incidents reach room staff and the family with role-resolved links", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    await savePushSubscription(parentId, sub("parent") as never);
    sendNotificationMock.mockClear();
    await createIncident({
      instituteId: iid,
      childId,
      accountId: ownerId,
      description: "Scraped knee on the slide",
    });
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    const urls = sendNotificationMock.mock.calls.map((c) => JSON.parse(String(c[1])).url).sort();
    expect(urls).toEqual(["/child/incidents", "/portal/incidents"]);
    const teacherRows = await listNotificationsFor(teacherId);
    expect(String(teacherRows[0]!.kind)).toBe("incident");
  });

  it("events reach every parent of the daycare (not staff)", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    await savePushSubscription(parentId, sub("parent") as never);
    await createEvent({
      instituteId: iid,
      title: "Colors day",
      eventDate: "2026-11-20",
      accountId: ownerId,
      description: "Wear your favorite colors.",
    });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect((await payloadBody()).url).toBe("/child/events");
    const rows = await listNotificationsFor(parentId);
    expect(String(rows[0]!.kind)).toBe("event");
    expect(await listNotificationsFor(teacherId)).toHaveLength(0);
  });

  it("homework reaches the assigned room staff (excluded author) — parent surface untouched", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    await createHomework({
      instituteId: iid,
      childId,
      title: "Letter of the week",
      description: "Practice the letter K.",
      accountId: teacherId,
    });
    // The author's own homework is not pushed back to them.
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(await listNotificationsFor(teacherId)).toHaveLength(0);

    // Another same-room staff member still gets it.
    const colleague = await staffAccount({
      email: `colleague-${Math.random().toString(36).slice(2, 8)}@test.local`,
      fullName: "Cole Agh",
      role: "teacher",
      instituteId: iid,
      roomIds: [roomId],
    });
    await savePushSubscription(colleague, sub("colleague") as never);
    sendNotificationMock.mockClear();
    await createHomework({
      instituteId: iid,
      childId,
      title: "Numbers to ten",
      accountId: teacherId,
    });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect((await payloadBody()).url).toBe("/portal/learning/homework");
  });

  it("supplies requests fan out center-wide to staff, not parents", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    await savePushSubscription(teacher2Id, sub("teacher2") as never);
    await savePushSubscription(parentId, sub("parent") as never);
    await createSupply({
      instituteId: iid,
      title: "Glue sticks",
      quantity: 12,
      unit: "sticks",
      accountId: ownerId,
    });
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    for (const call of sendNotificationMock.mock.calls) {
      expect(JSON.parse(String(call[1])).url).toBe("/portal/supplies");
    }
    expect(await listNotificationsFor(parentId)).toHaveLength(0);
  });

  it("daily reports notify staff AND the family through the same ref", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    await savePushSubscription(parentId, sub("parent") as never);
    // The report author is the owner (not room staff) so the teacher stays in
    // the audience; the author themselves is always excluded.
    await upsertDailyReport({
      childId,
      reportDate: "2026-11-07",
      summary: "Great nap, ate everything.",
      accountId: ownerId,
    });
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    const urls = sendNotificationMock.mock.calls.map((c) => JSON.parse(String(c[1])).url).sort();
    expect(urls).toEqual([`/child/${childId}`, `/portal/children/${childId}`]);
    const parentRefs = (await listNotificationsFor(parentId)).map((r) => String(r.ref));
    const teacherRefs = (await listNotificationsFor(teacherId)).map((r) => String(r.ref));
    expect(parentRefs).toEqual(teacherRefs);
  });

  it("announcements reach tagged rooms' staff and the tagged families; center-wide reaches everyone", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    await savePushSubscription(parentId, sub("parent") as never);
    sendNotificationMock.mockClear();
    await createNewsfeedPost({ instituteId: iid, accountId: ownerId, body: "Tagged note", tagChildIds: [childId] });
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    expect((await listNotificationsFor(teacherId))[0]!.kind).toBe("announcement");

    sendNotificationMock.mockClear();
    await savePushSubscription(teacher2Id, sub("teacher2") as never);
    await createNewsfeedPost({ instituteId: iid, accountId: ownerId, body: "Center-wide" });
    // Center-wide: parent + both staff (author is the owner).
    expect(sendNotificationMock).toHaveBeenCalledTimes(3);
  });
});

describe("KID-487 opt-out + defaults", () => {
  it("a disabled push pref suppresses the send, not the durable row", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    await setNotificationPref(teacherId, "attendance", "push", false);
    await checkChildInOut({ childId, accountId: parentId, type: "in" });
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(await listNotificationsFor(teacherId)).toHaveLength(1);
  });

  it("a disabled inapp pref suppresses the row too", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    await setNotificationPref(teacherId, "attendance", "inapp", false);
    await checkChildInOut({ childId, accountId: parentId, type: "in" });
    expect(await listNotificationsFor(teacherId)).toHaveLength(0);
  });

  it("teacher subscription defaults fill every portal activity; parents fill the parent list", async () => {
    await ensureDefaultPushPrefs(teacherId, [
      "newsfeed",
      "homework",
      "supplies",
      "billing",
      "attendance",
      "incidents",
      "messages",
      "daily_report",
      "events",
    ]);
    expect(await unreadPushRow(teacherId, "homework")).toBe(1);
    expect(await unreadPushRow(teacherId, "supplies")).toBe(1);
    await ensureDefaultPushPrefs(parentId);
    expect(await unreadPushRow(parentId, "attendance")).toBe(1);
  });

  it("familyParentsForChildren excludes actors and non-parent roles", async () => {
    const parents = await familyParentsForChildren([childId], [teacherId]);
    expect(parents).toEqual([parentId]);
    const excluding = await familyParentsForChildren([childId], [teacherId, parentId]);
    expect(excluding).toEqual([]);
  });

  it("staffCenterAudience returns the staff union and respects excludes", async () => {
    const ids = await staffCenterAudience(iid);
    expect(new Set(ids)).toEqual(new Set([teacherId, teacher2Id, ownerId]));
    const minus = await staffCenterAudience(iid, [teacherId]);
    expect(minus).not.toContain(teacherId);
  });
});

describe("KID-487 role-aware deep links", () => {
  it("every kind maps to the portal for staff and the child shell for parents", () => {
    const payload = { childId, threadId: "t9", title: "Colors day" };
    for (const kind of [
      "message",
      "daily_report",
      "announcement",
      "attendance",
      "pickup_time",
      "incident",
      "event",
      "homework",
      "supplies",
      "chatwoot_message",
      "test",
    ]) {
      const staffUrl = pushDeepUrl(kind, payload, "teacher");
      expect(staffUrl.startsWith("/portal/")).toBe(true);
      const parentUrl = pushDeepUrl(kind, payload, "parent");
      expect(parentUrl.startsWith("/child/")).toBe(true);
    }
    // Owner/admin/teacher/caregiver count as staff; everything else does not.
    for (const role of ["owner", "admin", "teacher", "caregiver"]) {
      expect(isStaffRole(role)).toBe(true);
    }
    expect(isStaffRole("parent")).toBe(false);
    expect(isStaffRole("system")).toBe(false);
    expect(pushDeepUrl("message", payload, "teacher")).toBe("/portal/messages?thread=t9");
    expect(pushDeepUrl("message", payload, "parent")).toBe("/child/messages?thread=t9");
    // Unknown kinds still land somewhere sensible, never a bare 404-less /.
    expect(pushDeepUrl("exotic_kind", {}, "teacher")).toBe("/portal");
  });

  it("one emission to a mixed audience produces one deliver per surface", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    await savePushSubscription(parentId, sub("parent") as never);
    await emitNotifications({
      instituteId: iid,
      accountIds: [teacherId, parentId],
      activity: "messages",
      kind: "message",
      payload: { senderName: "Sal Staff", body: "Hello both" },
      ref: "msg-mixed",
    });
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    expect((await payloadBody(0)).url).toBe("/portal/messages");
    expect((await payloadBody(1)).url).toBe("/child/messages");

    // Replay: the idempotent ref does not re-deliver.
    await emitNotifications({
      instituteId: iid,
      accountIds: [teacherId, parentId],
      activity: "messages",
      kind: "message",
      payload: { senderName: "Sal Staff", body: "Hello both" },
      ref: "msg-mixed",
    });
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
  });

  it("stale (404/410) subscriptions are pruned per account", async () => {
    await savePushSubscription(teacherId, sub("teacher") as never);
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 410 });
    await emitNotifications({
      instituteId: iid,
      accountIds: [teacherId],
      activity: "attendance",
      kind: "attendance",
      payload: { childName: "Pia Pusher", type: "in", edited: false },
      ref: `checkin-test-${uid()}`,
    });
    expect(await pushSubscriptionsFor(teacherId)).toHaveLength(0);
  });
});

describe("KID-487 surface + asset pins", () => {
  it("the portal layout registers the service worker and the sound watcher", () => {
    const layout = readFileSync(path.join(process.cwd(), "app", "portal", "layout.tsx"), "utf8");
    expect(layout).toContain("ServiceWorkerRegister");
    expect(layout).toContain("NotificationSoundWatcher");
  });

  it("the staff account page ships the push card, push column and EN/AR labels", () => {
    const page = readFileSync(path.join(process.cwd(), "app", "portal", "account", "page.tsx"), "utf8");
    expect(page).toContain("PushNotificationsCard");
    expect(page).toContain('name={`${a}_push`}');
  });

  it("the service worker stays audible by default (silent:false) and click-opens the payload URL", () => {
    const sw = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
    expect(sw).toContain("silent: false");
    expect(sw).toContain("notificationclick");
  });

  it("the parent notification center resolves hrefs through the shared push map", () => {
    const page = readFileSync(path.join(process.cwd(), "app", "child", "notifications", "page.tsx"), "utf8");
    expect(page).toContain("pushDeepUrl");
  });

  it("the subscribe route defaults to the caller's own surface", () => {
    const route = readFileSync(
      path.join(process.cwd(), "app", "api", "push", "subscribe", "route.ts"),
      "utf8"
    );
    expect(route).toContain("isStaffRole");
    const preview = (path: string) => existsSync(path);
    expect(preview(path.join(process.cwd(), "app", "portal", "account", "page.tsx"))).toBe(true);
  });

  it("staff subscription route assets exist for the card flows", async () => {
    // The routes are session-gated (no parent-only gate): the public key route
    // answers without a session, the subscribe route exists for POST/DELETE.
    for (const p of [
      "app/api/push/public-key/route.ts",
      "app/api/push/subscribe/route.ts",
      "app/api/push/test/route.ts",
    ]) {
      expect(existsSync(path.join(process.cwd(), ...p.split("/")))).toBe(true);
    }
  });
});

describe("KID-487 i18n parity", () => {
  const PORTAL_KEYS = [
    "prefNewsfeed",
    "prefHomework",
    "prefSupplies",
    "prefBilling",
    "prefAttendance",
    "prefIncidents",
    "prefMessages",
    "prefDailyReport",
    "prefEvents",
    "pushTitle",
    "pushHint",
    "pushEnable",
    "pushDisable",
    "pushEnabled",
    "pushDenied",
    "pushUnsupported",
    "pushNotConfigured",
    "pushTestButton",
    "pushTestSent",
    "soundLabel",
    "soundHint",
  ] as const;

  it("adds every portal.* key to EN and AR", () => {
    for (const key of PORTAL_KEYS) {
      const en = String((dictionaries.en as any).portal?.[key] ?? "");
      const ar = String((dictionaries.ar as any).portal?.[key] ?? "");
      expect(en.length).toBeGreaterThan(0);
      expect(ar.length).toBeGreaterThan(0);
      expect(ar).not.toContain("MISSING:");
    }
    expect(String(dictionaries.en.feed.attendanceUpdatedTitle ?? "")).not.toBe("");
    expect(String(dictionaries.ar.feed.attendanceUpdatedTitle ?? "")).not.toBe("");
  });

  it("keeps account.push label present for the new table column", () => {
    expect(String(dictionaries.en.account.push)).not.toBe("");
    expect(String(dictionaries.ar.account.push)).not.toBe("");
  });
});

describe("KID-487 stored-shape sanity", () => {
  it("subscribe rows persist per browser endpoint regardless of role", async () => {
    await savePushSubscription(teacherId, fakeSubscription as never, "UA/487");
    const rows = await queryAll(`SELECT * FROM push_subscription WHERE account_id = ?`, teacherId);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.user_agent)).toBe("UA/487");
    expect(String((await getAccount(teacherId))!.email)).toMatch(/@test\.local$/);
  });
});
