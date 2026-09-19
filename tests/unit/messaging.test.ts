// Messaging threads + classroom scoping (KID-56): group/private threads,
// per-recipient unread counts, staff classroom scoping, and class channels.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { createAccount } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let iid: string;
let roomA: string;
let roomB: string;
let staffAcc: string;
let parentA: string;
let parentB: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  roomB = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool'"))!.id);
  const childA = String((await queryGet("SELECT id FROM child WHERE room_id = ?", roomA))!.id);
  const childB = String((await queryGet("SELECT id FROM child WHERE room_id = ?", roomB))!.id);

  // Staff member assigned to Toddlers only.
  const s = await store.createStaff({ instituteId: iid, fullName: "Room A Carer", role: "carer", roomIds: [roomA] });
  const acc = await createAccount({ email: "carer-a@test", password: "x", fullName: "Room A Carer", role: "staff" });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(s.id), String(acc.id));
  staffAcc = String(acc.id);

  // One parent per room.
  const pA = await createAccount({ email: "pa@test", password: "x", fullName: "Parent A", role: "parent" });
  const pB = await createAccount({ email: "pb@test", password: "x", fullName: "Parent B", role: "parent" });
  await store.linkFamily(String(pA.id), childA);
  await store.linkFamily(String(pB.id), childB);
  parentA = String(pA.id);
  parentB = String(pB.id);
});

describe("classroom scoping", () => {
  it("staff see only parents in their assigned rooms", async () => {
    const names = (await store.parentAccountsScoped(iid, staffAcc)).map((p) => String(p.full_name));
    expect(names).toContain("Parent A");
    expect(names).not.toContain("Parent B");
  });

  it("owner accounts keep the full parent list", async () => {
    const owner = String((await queryGet("SELECT id FROM account WHERE role = 'owner'"))!.id);
    const names = (await store.parentAccountsScoped(iid, owner)).map((p) => String(p.full_name));
    expect(names).toContain("Parent A");
    expect(names).toContain("Parent B");
  });

  it("class channels match the staffer's rooms with parent counts", async () => {
    const channels = await store.roomChannelsForAccount(iid, staffAcc);
    expect(channels.map((c) => String(c.name))).toEqual(["Toddlers"]);
    expect(Number(channels[0].parent_count)).toBeGreaterThan(0);
  });
});

describe("threads + unread", () => {
  it("group fan-out shares one thread; unread clears per recipient", async () => {
    const thread = await store.createMessageThread({
      instituteId: iid,
      title: "Toddlers",
      isGroup: true,
      createdBy: staffAcc,
      participantIds: [parentA, parentB],
    });
    await store.sendMessage({ instituteId: iid, senderAccountId: staffAcc, recipientAccountId: parentA, body: "hi all", threadId: String(thread.id) });
    await store.sendMessage({ instituteId: iid, senderAccountId: staffAcc, recipientAccountId: parentB, body: "hi all", threadId: String(thread.id) });

    expect((await store.threadMessages(String(thread.id))).length).toBe(2);
    const forA = await store.threadsForAccount(parentA);
    expect(forA.length).toBe(1);
    expect(Number(forA[0].unread_count)).toBe(1);
    expect(await store.unreadCountForAccount(parentA)).toBe(1);

    await store.markThreadRead(String(thread.id), parentA);
    expect(await store.unreadCountForAccount(parentA)).toBe(0);
    // Parent B still has theirs.
    expect(await store.unreadCountForAccount(parentB)).toBe(1);
  });

  it("private threads re-attach 1:1 replies via latestPairThread", async () => {
    const thread = await store.createMessageThread({
      instituteId: iid, isGroup: false, createdBy: staffAcc, participantIds: [parentA],
    });
    await store.sendMessage({ instituteId: iid, senderAccountId: staffAcc, recipientAccountId: parentA, body: "private", threadId: String(thread.id) });
    expect(await store.latestPairThread(staffAcc, parentA)).toBe(String(thread.id));

    const convos = await store.conversationsForAccount(parentA);
    const mine = convos.find((c) => String(c.other_account_id) === staffAcc);
    expect(Number(mine?.unread_count)).toBe(1);
  });

  it("thread access is limited to participants", async () => {
    const thread = await store.createMessageThread({
      instituteId: iid, isGroup: true, createdBy: staffAcc, participantIds: [parentA],
    });
    expect(await store.threadForViewer(String(thread.id), parentA)).toBeDefined();
    expect(await store.threadForViewer(String(thread.id), parentB)).toBeUndefined();
  });
});
