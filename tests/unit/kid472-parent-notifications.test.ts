// KID-474: parent notification center, preferences, unread badge, and the
// message / daily-report notification events.
//
// Pinned here, mirroring the issue acceptance:
//   1. Preference enforcement — the emit path honors notification_pref
//      (activity / channel 'inapp'): a stored disabled row suppresses
//      delivery, a missing row defaults to enabled, and disabling only
//      email never suppresses in-app delivery.
//   2. Read state — listNotificationsFor / unreadNotificationCount /
//      markNotificationRead / markAllNotificationsRead behave per account,
//      and markRead / markThreadRead bridge back to the durable rows so a
//      read conversation clears its badge immediately.
//   3. Audience scoping — a new daily report reaches ONLY the child's
//      linked parent accounts (family_member role parent); an unrelated
//      parent, message senders, and staff never self-notify; message rows
//      go to the recipient of that message only.
//   4. No duplicates — a replayed emission for the same ref keeps exactly
//      one row per account, and a second same-day report save emits nothing.
//   5. The staff derived feed (recentActivityFeed) emits the two previously
//      missing slices — messages addressed to the account and daily reports
//      inside its room scope.
//   6. EN/AR key parity for the new parent-notification dictionaries plus
//      the new FeedCopy resolvers, and view-time rendering of the durable
//      row payload copies per account locale.

import { beforeEach, describe, expect, it } from "vitest";
import {
  createMessageThread,
  createDaycare,
  createChild,
  linkFamily,
  emitNotifications,
  listNotificationsFor,
  markAllNotificationsRead,
  markNotificationRead,
  markRead,
  markThreadRead,
  NOTIFICATION_ACTIVITIES,
  PARENT_NOTIFICATION_ACTIVITIES,
  notificationViewCopy,
  recentActivityFeed,
  sendMessage,
  unreadNotificationCount,
  upsertDailyReport,
} from "@/lib/store";
import { createAccount } from "@/lib/auth";
import { dictionaries, feedCopyFor, tr, type Locale } from "@/lib/i18n";
import { queryGet, queryRun } from "@/lib/db";
import { resetDb } from "../helpers";

const unique = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}@test.local`;

let iid = "";
let ownerId = "";
let ownerName = "";
let staffAccId = "";
let parentAId = "";
let parentBId = "";
let childId = "";

beforeEach(async () => {
  await resetDb();
  const ownerFullName = "Omar Poplar";
  const day = await createDaycare({
    name: "Poplar Notifications",
    ownerEmail: unique("owner"),
    ownerPassword: "owner-pass-1",
    ownerFullName,
  });
  iid = day.instituteId;
  ownerId = day.ownerAccountId;
  ownerName = ownerFullName;

  const staffAcc = await createAccount({
    email: unique("staff"),
    password: "staff-pass-1",
    fullName: "Sara Staff",
    role: "teacher",
  });
  staffAccId = String(staffAcc.id);

  const child = await createChild({
    instituteId: iid,
    firstName: "Leo",
    lastName: "Notified",
  });
  childId = String(child.id);

  const parentA = await createAccount({
    email: unique("parenta"),
    password: "parent-pass-1",
    fullName: "Alice Parent A",
    role: "parent",
    pin: "1234",
  });
  parentAId = String(parentA.id);
  await linkFamily(parentAId, childId, "parent");

  // Unrelated parent: linked to another child, never to childId.
  const other = await createChild({ instituteId: iid, firstName: "Una", lastName: "Other" });
  const parentB = await createAccount({
    email: unique("parentb"),
    password: "parent-pass-1",
    fullName: "Bob Parent B",
    role: "parent",
    pin: "5678",
  });
  parentBId = String(parentB.id);
  await linkFamily(parentBId, String(other.id), "parent");
});

async function disablePref(accountId: string, activity: string, channel = "inapp"): Promise<void> {
  await queryRun(
    `INSERT INTO notification_pref (account_id, activity, channel, enabled)
     VALUES (?, ?, ?, 0)`,
    accountId,
    activity,
    channel
  );
}

describe("KID-474 notification prefs gate", () => {
  it("delivers by default (no pref row) and honors a disabled in-app row", async () => {
    const msg = await sendMessage({
      instituteId: iid,
      senderAccountId: ownerId,
      recipientAccountId: parentAId,
      body: "Default delivery",
    });
    expect(await unreadNotificationCount(parentAId)).toBe(1);
    expect(
      (await listNotificationsFor(parentAId)).filter((r) => String(r.ref) === `msg-${msg.id}`)
    ).toHaveLength(1);

    await disablePref(parentAId, "messages");
    await sendMessage({
      instituteId: iid,
      senderAccountId: ownerId,
      recipientAccountId: parentAId,
      body: "Suppressed me",
    });
    expect(await unreadNotificationCount(parentAId)).toBe(1);
  });

  it("keeps in-app delivery when only the email channel is disabled", async () => {
    await disablePref(parentAId, "messages", "email");
    await sendMessage({
      instituteId: iid,
      senderAccountId: ownerId,
      recipientAccountId: parentAId,
      body: "In-app still on",
    });
    expect(await unreadNotificationCount(parentAId)).toBe(1);
  });

  it("lists every activities key including the two new ones", () => {
    const keys = NOTIFICATION_ACTIVITIES as readonly string[];
    for (const needed of ["daily_report", "events"]) {
      expect(keys).toContain(needed);
    }
    for (const key of PARENT_NOTIFICATION_ACTIVITIES as readonly string[]) {
      expect(keys).toContain(key);
    }
  });
});

describe("KID-474 daily report audience", () => {
  it("reaches only the linked parent accounts of the child", async () => {
    const day = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    await upsertDailyReport({
      childId,
      reportDate: day,
      summary: "Great sandcastle.",
      accountId: ownerId,
    });

    const reportRows = (await listNotificationsFor(parentAId)).filter(
      (r) => String(r.kind) === "daily_report"
    );
    expect(reportRows).toHaveLength(1);
    expect(String(reportRows[0]!.ref)).toBe(`report-${childId}-${day}`);
    expect(await unreadNotificationCount(parentAId)).toBe(1);

    expect(await unreadNotificationCount(parentBId)).toBe(0);
    expect(await unreadNotificationCount(ownerId)).toBe(0);
  });

  it("never duplicates the report on a second save for the same child+date", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await upsertDailyReport({ childId, reportDate: day, summary: "one", accountId: ownerId });
    await upsertDailyReport({ childId, reportDate: day, summary: "two", accountId: ownerId });
    const rows = await listNotificationsFor(parentAId);
    expect(rows.filter((r) => String(r.kind) === "daily_report")).toHaveLength(1);
  });

  it("suppresses the report event when the parent disabled daily_report", async () => {
    await disablePref(parentAId, "daily_report");
    await upsertDailyReport({
      childId,
      reportDate: new Date().toISOString().slice(0, 10),
      summary: "Quiet please.",
      accountId: ownerId,
    });
    expect(await unreadNotificationCount(parentAId)).toBe(0);
  });
});

describe("KID-474 message audience + read state", () => {
  it("emits to the recipient only — the sender never self-notifies", async () => {
    await sendMessage({
      instituteId: iid,
      senderAccountId: ownerId,
      recipientAccountId: staffAccId,
      body: "Staff ping",
    });
    expect(await unreadNotificationCount(staffAccId)).toBe(1);
    expect(await unreadNotificationCount(ownerId)).toBe(0);
  });

  it("marks one row read, then all rows read; counts drop per account", async () => {
    const m1 = await sendMessage({
      instituteId: iid,
      senderAccountId: ownerId,
      recipientAccountId: parentAId,
      body: "First",
    });
    await sendMessage({
      instituteId: iid,
      senderAccountId: ownerId,
      recipientAccountId: parentAId,
      body: "Second",
    });
    expect(await unreadNotificationCount(parentAId)).toBe(2);

    const rows = await listNotificationsFor(parentAId);
    const target = rows.find((r) => String(r.ref) === `msg-${m1.id}`);
    expect(target).toBeDefined();
    await markNotificationRead(parentAId, String(target!.id));

    const after = await listNotificationsFor(parentAId);
    const stillUnread = after.filter((r) => !r.read_at);
    expect(stillUnread).toHaveLength(1);
    expect(String(stillUnread[0]!.ref)).not.toBe(`msg-${m1.id}`);
    expect(await unreadNotificationCount(parentAId)).toBe(1);

    await markAllNotificationsRead(parentAId);
    expect(await unreadNotificationCount(parentAId)).toBe(0);

    expect(await unreadNotificationCount(parentBId)).toBe(0);
  });

  it("bridges markRead / markThreadRead so a read conversation clears its badge", async () => {
    await sendMessage({
      instituteId: iid,
      senderAccountId: ownerId,
      recipientAccountId: parentAId,
      body: "Direct",
    });
    const thread = await createMessageThread({
      instituteId: iid,
      createdBy: ownerId,
      participantIds: [parentAId, ownerId],
      isGroup: false,
      title: "Bridge thread",
    });
    await sendMessage({
      instituteId: iid,
      senderAccountId: ownerId,
      recipientAccountId: parentAId,
      body: "Threaded",
      threadId: String(thread.id),
    });

    await markThreadRead(String(thread.id), parentAId);
    await markRead(ownerId, parentAId);
    expect(await unreadNotificationCount(parentAId)).toBe(0);
  });

  it("replaying the same ref keeps exactly one row per account", async () => {
    for (let i = 0; i < 2; i++) {
      await emitNotifications({
        instituteId: iid,
        accountIds: [parentAId, parentAId],
        activity: "newsfeed",
        kind: "activity",
        payload: { title: "same ref" },
        ref: "dup-test-1",
      });
    }
    const rows = await listNotificationsFor(parentAId);
    expect(rows.filter((r) => String(r.ref) === "dup-test-1")).toHaveLength(1);
  });
});

describe("KID-474 staff derived feed slices", () => {
  it("emits message and daily-report items to the addressed account only", async () => {
    const thread = await createMessageThread({
      instituteId: iid,
      createdBy: ownerId,
      participantIds: [ownerId, staffAccId],
      isGroup: true,
      title: "Room chat",
    });
    await sendMessage({
      instituteId: iid,
      senderAccountId: ownerId,
      recipientAccountId: staffAccId,
      body: "Cover the 3pm pickup",
      threadId: String(thread.id),
    });
    await upsertDailyReport({
      childId,
      reportDate: new Date().toISOString().slice(0, 10),
      summary: "Napped well.",
      accountId: ownerId,
    });

    const feed = await recentActivityFeed(iid, staffAccId, 50, feedCopyFor("en"));
    const kinds = feed.filter((i) => i.type === "messages" || i.type === "daily_report");
    expect(kinds.map((i) => i.type).sort()).toEqual(["daily_report", "messages"]);
    expect(kinds.find((i) => i.type === "messages")!.title).toContain(ownerName.split(" ")[0]);
    expect(kinds.find((i) => i.type === "daily_report")!.title).toContain("Leo");

    const staffFeed = await recentActivityFeed(iid, parentAId, 50, feedCopyFor("en"));
    expect(staffFeed.filter((i) => i.type === "messages")).toHaveLength(0);
  });
});

describe("KID-474 i18n parity", () => {
  it("ships the parent-notification page + prefs keys in EN and AR", () => {
    const keys = [
      "parent.notificationsTitle",
      "parent.notificationsSubtitle",
      "parent.notificationsEmpty",
      "parent.notificationsMarkAll",
      "parent.notificationsMarkOne",
      "parent.notificationsUnreadAria",
      "parent.notificationsBadgeAria",
      "parent.notifPrefsTitle",
      "parent.notifPrefsHint",
      "parent.notifPrefsSaved",
      "parent.savePrefs",
      "parent.prefMessages",
      "parent.prefDailyReport",
      "parent.prefNewsfeed",
      "parent.prefEvents",
      "parent.prefAttendance",
      "parent.prefIncidents",
      "parent.prefBilling",
    ];
    for (const key of keys) {
      for (const [locale, dict] of Object.entries(dictionaries) as [Locale, typeof dictionaries[Locale]][]) {
        const text = tr(dict, key);
        expect(text, `${locale} missing or empty for ${key}`).not.toBe("");
        expect(text, `${locale} key missing: ${key}`).not.toContain("MISSING:");
      }
    }
  });

  it("exposes the new FeedCopy resolvers localized, not hardcoded English", () => {
    const en = feedCopyFor("en");
    const ar = feedCopyFor("ar");
    expect(en.messageTitle("Sara")).toBe("Message from Sara");
    expect(ar.messageTitle("سارة")).toBe("رسالة من سارة");
    expect(en.reportTitle("Leo")).toBe("Daily report: Leo");
    expect(ar.reportTitle("ليو")).toBe("تقرير يومي: ليو");
    expect(en.reportBody("Napped")).toBe("Napped");
    expect(en.reportMeta("2026-01-02")).toBe("Report for 2026-01-02");
    expect(ar.reportMeta("2026-01-02")).toBe("تقرير يوم 2026-01-02");
  });

  it("renders the durable row copy at view time for both locales", async () => {
    await upsertDailyReport({
      childId,
      reportDate: "2026-01-02",
      summary: "Made a tower.",
      accountId: ownerId,
    });
    const rows = await listNotificationsFor(parentAId);
    const reportRow = rows.find((r) => String(r.kind) === "daily_report");
    const payload = JSON.parse(String(reportRow!.payload));
    expect(notificationViewCopy("daily_report", payload, feedCopyFor("en")).title).toBe(
      "Daily report: Leo Notified"
    );
    expect(notificationViewCopy("daily_report", payload, feedCopyFor("ar")).title).toBe(
      "تقرير يومي: Leo Notified"
    );
  });
});
