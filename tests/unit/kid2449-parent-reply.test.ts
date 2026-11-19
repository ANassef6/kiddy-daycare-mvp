// KID-2449 regression: a parent must be able to reply to a thread a
// staff/admin side opened with them, regardless of room assignment.
//
// Production repro (KID-215 comment d19efc36): the company admin messaged a
// parent from trois4ever+admin@gmail.com; the parent's reply was refused with
// "you can only reply to a staff assigned to your children room". KID-144's
// room rule is correct for parent-initiated threads and must stay enforced in
// the other direction.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "@/lib/store";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { parentMayUseThread } from "@/lib/parent-thread-policy";
import { seedFixture } from "../helpers";

const sessionCookie = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (name === "kiddy_sess" ? sessionCookie : undefined) }),
  headers: () => new Headers(),
}));

type NextError = { digest?: unknown; message: string };

async function redirectTarget(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const digest = String((err as NextError)?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw err;
  }
  throw new Error("expected the action to redirect");
}

let iid: string;
let roomA: string;
let roomB: string;
let parentId: string;
let childId: string;

async function accountFor(email: string, fullName: string, role: string): Promise<string> {
  const acc = await createAccount({ email, password: "x", fullName, role });
  return String(acc.id);
}

async function staffAccount(
  email: string,
  fullName: string,
  role: string,
  roomIds: string[]
): Promise<string> {
  const staff = await store.createStaff({ instituteId: iid, fullName, role, roomIds });
  const acc = await createAccount({ email, password: "x", fullName, role: "staff" });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), String(acc.id));
  return String(acc.id);
}

function signIn(accountId: string, role: "parent" | "owner" | "admin" | "staff"): void {
  sessionCookie.value = createSessionToken({
    accountId,
    role,
    email: "kid2449@example.test",
    accountConfirmed: true,
  } as never);
}

async function replyAsParent(threadId: string, recipientId: string, body: string): Promise<string> {
  signIn(parentId, "parent");
  const { sendParentMessageAction } = await import("@/lib/actions");
  const fd = new FormData();
  fd.set("threadId", threadId);
  fd.set("recipientId", recipientId);
  fd.set("body", body);
  return redirectTarget(() => sendParentMessageAction(fd));
}

async function sendNewAsParent(recipientId: string, body: string): Promise<string> {
  signIn(parentId, "parent");
  const { sendParentMessageAction } = await import("@/lib/actions");
  const fd = new FormData();
  fd.set("recipientId", recipientId);
  fd.set("body", body);
  return redirectTarget(() => sendParentMessageAction(fd));
}

beforeEach(async () => {
  sessionCookie.value = "";
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  roomB = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool'"))!.id);
  childId = String((await store.createChild({ instituteId: iid, firstName: "Nour", lastName: "Hisham", roomId: roomA })).id);
  parentId = await accountFor("nouranhisham22@example.test", "Nouran Hisham", "parent");
  await store.linkFamily(parentId, childId);
});

describe("KID-2449 parent replies on staff/admin-initiated threads", () => {
  it("(a) admin-initiated thread: parent reply is accepted and visible", async () => {
    const adminId = await accountFor("trois4ever+admin@example.test", "Company Admin", "admin");
    const thread = await store.createMessageThread({
      instituteId: iid,
      title: "Hello from the centre",
      isGroup: false,
      createdBy: adminId,
      participantIds: [parentId],
    });
    const threadId = String(thread.id);
    await store.sendMessage({
      instituteId: iid,
      senderAccountId: adminId,
      recipientAccountId: parentId,
      body: "Welcome to Sunshine Daycare",
      threadId,
    });

    // The parent's thread list must include the admin's thread.
    const visible = (await store.threadsForAccountScoped(parentId)).map((t) => String(t.id));
    expect(visible).toContain(threadId);

    // The exact post the thread composer makes: threadId + hidden recipient.
    expect(await replyAsParent(threadId, adminId, "Thank you!")).toBe(`/child/messages?thread=${threadId}`);

    const stored = await queryAll(
      "SELECT sender_account_id, recipient_account_id, body FROM message WHERE thread_id = ? ORDER BY created_at",
      threadId
    );
    expect(stored.map((m) => String(m.body))).toEqual(["Welcome to Sunshine Daycare", "Thank you!"]);
    expect(String(stored[1].sender_account_id)).toBe(parentId);
    expect(String(stored[1].recipient_account_id)).toBe(adminId);
  });

  it("(b) parent-initiated thread with a classroom teacher still works", async () => {
    const teacherId = await staffAccount("teacher-room-a@example.test", "Room A Teacher", "carer", [roomA]);
    const thread = await store.createMessageThread({
      instituteId: iid,
      isGroup: false,
      createdBy: parentId,
      participantIds: [teacherId],
    });
    const threadId = String(thread.id);
    await store.sendMessage({
      instituteId: iid,
      senderAccountId: parentId,
      recipientAccountId: teacherId,
      body: "Question about nap time",
      threadId,
    });

    expect(await replyAsParent(threadId, teacherId, "Thank you, noted")).toBe(`/child/messages?thread=${threadId}`);
    const rows = await queryAll("SELECT body FROM message WHERE thread_id = ? ORDER BY created_at", threadId);
    expect(rows.map((r) => String(r.body))).toEqual(["Question about nap time", "Thank you, noted"]);

    // The same teacher is a valid new-conversation recipient.
    expect(await sendNewAsParent(teacherId, "Hello teacher")).toBe("/child/messages");
  });

  it("(c) parent-initiated thread with non-assigned staff is refused", async () => {
    const otherRoomTeacher = await staffAccount("teacher-room-b@example.test", "Room B Teacher", "carer", [roomB]);
    const thread = await store.createMessageThread({
      instituteId: iid,
      isGroup: false,
      createdBy: parentId,
      participantIds: [otherRoomTeacher],
    });
    const threadId = String(thread.id);

    expect(await replyAsParent(threadId, otherRoomTeacher, "Can I talk to you?")).toBe(
      "/child/messages?error=thread-reply"
    );
    expect(await sendNewAsParent(otherRoomTeacher, "Can I talk to you?")).toBe(
      "/child/messages?error=recipient"
    );
    expect(await queryAll("SELECT id FROM message")).toEqual([]);
  });

  it("(d) parent reply to an unrelated third party in a parent thread is blocked", async () => {
    const strangerId = await accountFor("stranger@example.test", "Unrelated Person", "parent");
    const thread = await store.createMessageThread({
      instituteId: iid,
      isGroup: false,
      createdBy: parentId,
      participantIds: [strangerId],
    });

    expect(await replyAsParent(String(thread.id), strangerId, "hello")).toBe(
      "/child/messages?error=thread-reply"
    );
    expect(await queryAll("SELECT id FROM message WHERE thread_id = ?", String(thread.id))).toEqual([]);

    // The parent-initiated thread with a stranger is not listed either.
    const visible = (await store.threadsForAccountScoped(parentId)).map((t) => String(t.id));
    expect(visible).not.toContain(String(thread.id));
  });

  it("(e) family role still cannot message at all", async () => {
    const teacherId = await staffAccount("teacher-family@example.test", "Room A Teacher", "carer", [roomA]);
    const familyId = await accountFor("family-kid2449@example.test", "Family Link", "parent");
    await store.linkFamily(familyId, childId, "family");
    signIn(familyId, "parent");

    const { sendParentMessageAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("recipientId", teacherId);
    fd.set("body", "family cannot send");
    expect(await redirectTarget(() => sendParentMessageAction(fd))).toBe("/child?error=role");
  });
});

describe("KID-2449 thread policy unit", () => {
  it("falls back to the room rule for legacy threads with no creator role", () => {
    const allowed = new Set(["teacher"]);
    expect(
      parentMayUseThread({
        viewerId: "parent",
        participantIds: ["parent", "teacher"],
        creatorRole: null,
        allowedStaffIds: allowed,
      })
    ).toBe(true);
    expect(
      parentMayUseThread({
        viewerId: "parent",
        participantIds: ["parent", "stranger"],
        creatorRole: null,
        allowedStaffIds: allowed,
      })
    ).toBe(false);
  });

  it("rejects a thread with no other participant", () => {
    expect(
      parentMayUseThread({
        viewerId: "parent",
        participantIds: ["parent"],
        creatorRole: "admin",
        allowedStaffIds: new Set(),
      })
    ).toBe(false);
  });
});
