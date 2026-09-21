// Classroom scoping for staff across child-related surfaces (KID-103).

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { createAccount } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let iid: string;
let roomA: string;
let roomB: string;
let childA: string;
let childB: string;
let ownerAcc: string;
let staffAcc: string;
let emptyStaffAcc: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  roomB = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool'"))!.id);
  childA = String((await queryGet("SELECT id FROM child WHERE room_id = ?", roomA))!.id);
  childB = String((await queryGet("SELECT id FROM child WHERE room_id = ?", roomB))!.id);

  ownerAcc = String((await queryGet("SELECT id FROM account WHERE role = 'owner'"))!.id);

  const s = await store.createStaff({ instituteId: iid, fullName: "Room A Carer", role: "carer", roomIds: [roomA] });
  const acc = await createAccount({ email: "carer-a@test", password: "x", fullName: "Room A Carer", role: "staff" });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(s.id), String(acc.id));
  staffAcc = String(acc.id);

  const empty = await store.createStaff({ instituteId: iid, fullName: "Unassigned Carer", role: "carer", roomIds: [] });
  const emptyAcc = await createAccount({ email: "carer-empty@test", password: "x", fullName: "Unassigned Carer", role: "staff" });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(empty.id), String(emptyAcc.id));
  emptyStaffAcc = String(emptyAcc.id);
});

describe("scopedRoomIds and listRoomsScoped", () => {
  it("owners are unscoped", async () => {
    expect(await store.scopedRoomIds(iid, ownerAcc)).toBeNull();
    expect((await store.listRoomsScoped(iid, ownerAcc)).map((r) => String(r.id))).toContain(roomA);
  });

  it("staff see only assigned rooms", async () => {
    expect(await store.scopedRoomIds(iid, staffAcc)).toEqual([roomA]);
    const rooms = await store.listRoomsScoped(iid, staffAcc);
    expect(rooms.length).toBe(1);
    expect(String(rooms[0].id)).toBe(roomA);
  });

  it("staff with no assigned rooms get an empty scope", async () => {
    expect(await store.scopedRoomIds(iid, emptyStaffAcc)).toEqual([]);
    expect(await store.listRoomsScoped(iid, emptyStaffAcc)).toEqual([]);
  });
});

describe("isChildInScope", () => {
  it("owner can access every child", async () => {
    expect(await store.isChildInScope(iid, ownerAcc, childA)).toBe(true);
    expect(await store.isChildInScope(iid, ownerAcc, childB)).toBe(true);
  });

  it("staff can access only children in assigned rooms", async () => {
    expect(await store.isChildInScope(iid, staffAcc, childA)).toBe(true);
    expect(await store.isChildInScope(iid, staffAcc, childB)).toBe(false);
  });

  it("unassigned staff cannot access any child", async () => {
    expect(await store.isChildInScope(iid, emptyStaffAcc, childA)).toBe(false);
    expect(await store.isChildInScope(iid, emptyStaffAcc, childB)).toBe(false);
  });
});

describe("listChildren", () => {
  it("returns all children for owners", async () => {
    const ids = (await store.listChildren(iid, { accountId: ownerAcc })).map((c) => String(c.id));
    expect(ids).toContain(childA);
    expect(ids).toContain(childB);
  });

  it("returns only assigned-classroom children for staff", async () => {
    const ids = (await store.listChildren(iid, { accountId: staffAcc })).map((c) => String(c.id));
    expect(ids).toContain(childA);
    expect(ids).not.toContain(childB);
  });

  it("returns no children for staff with no rooms", async () => {
    expect(await store.listChildren(iid, { accountId: emptyStaffAcc })).toEqual([]);
  });
});

describe("checkedInNow", () => {
  it("scopes checked-in children to assigned classrooms", async () => {
    await store.checkChildInOut({ childId: childA, accountId: ownerAcc, type: "in" });
    await store.checkChildInOut({ childId: childB, accountId: ownerAcc, type: "in" });

    const ownerView = await store.checkedInNow(iid, ownerAcc);
    expect(ownerView.length).toBe(2);

    const staffView = await store.checkedInNow(iid, staffAcc);
    expect(staffView.length).toBe(1);
    expect(String(staffView[0].id)).toBe(childA);

    expect(await store.checkedInNow(iid, emptyStaffAcc)).toEqual([]);
  });
});

describe("recentReports", () => {
  it("scopes daily reports to assigned classrooms", async () => {
    await store.upsertDailyReport({ childId: childA, reportDate: "2026-01-01", summary: "A", accountId: ownerAcc });
    await store.upsertDailyReport({ childId: childB, reportDate: "2026-01-01", summary: "B", accountId: ownerAcc });

    const staffView = await store.recentReports(iid, 10, staffAcc);
    expect(staffView.some((r) => r.summary === "A")).toBe(true);
    expect(staffView.some((r) => r.summary === "B")).toBe(false);

    expect(await store.recentReports(iid, 10, emptyStaffAcc)).toEqual([]);
  });
});

describe("listNewsfeed", () => {
  it("scopes visible posts to assigned-classroom tags", async () => {
    await store.createNewsfeedPost({ instituteId: iid, accountId: ownerAcc, body: "for A", tagChildIds: [childA] });
    await store.createNewsfeedPost({ instituteId: iid, accountId: ownerAcc, body: "for B", tagChildIds: [childB] });

    const staffView = await store.listNewsfeed(iid, staffAcc);
    expect(staffView.some((p) => p.body === "for A")).toBe(true);
    expect(staffView.some((p) => p.body === "for B")).toBe(false);

    expect(await store.listNewsfeed(iid, emptyStaffAcc)).toEqual([]);
  });
});

describe("listDriveFiles", () => {
  it("scopes child-specific files to assigned classrooms but keeps center-wide files", async () => {
    await store.addDriveFile({ instituteId: iid, filename: "handbook.pdf", url: "http://example.com/h", childId: undefined, accountId: ownerAcc });
    await store.addDriveFile({ instituteId: iid, filename: "a.pdf", url: "http://example.com/a", childId: childA, accountId: ownerAcc });
    await store.addDriveFile({ instituteId: iid, filename: "b.pdf", url: "http://example.com/b", childId: childB, accountId: ownerAcc });

    const staffView = await store.listDriveFiles(iid, staffAcc);
    const staffNames = staffView.map((f) => f.filename);
    expect(staffNames).toContain("handbook.pdf");
    expect(staffNames).toContain("a.pdf");
    expect(staffNames).not.toContain("b.pdf");

    const emptyView = await store.listDriveFiles(iid, emptyStaffAcc);
    const emptyNames = emptyView.map((f) => f.filename);
    expect(emptyNames).toContain("handbook.pdf");
    expect(emptyNames).not.toContain("a.pdf");
    expect(emptyNames).not.toContain("b.pdf");
  });
});

describe("listObservations", () => {
  it("scopes observations to assigned classrooms", async () => {
    await store.createObservation({ instituteId: iid, childId: childA, body: "A", accountId: ownerAcc });
    await store.createObservation({ instituteId: iid, childId: childB, body: "B", accountId: ownerAcc });

    const staffView = await store.listObservations(iid, staffAcc);
    expect(staffView.some((o) => o.body === "A")).toBe(true);
    expect(staffView.some((o) => o.body === "B")).toBe(false);

    expect(await store.listObservations(iid, emptyStaffAcc)).toEqual([]);
  });
});

describe("listHomework", () => {
  it("scopes child-specific homework to assigned classrooms", async () => {
    await store.createHomework({ instituteId: iid, childId: childA, title: "A", accountId: ownerAcc });
    await store.createHomework({ instituteId: iid, childId: childB, title: "B", accountId: ownerAcc });

    const ownerView = await store.listHomework(iid, ownerAcc);
    expect(ownerView.length).toBe(2);

    const staffView = await store.listHomework(iid, staffAcc);
    expect(staffView.length).toBe(1);
    expect(staffView[0].title).toBe("A");

    expect(await store.listHomework(iid, emptyStaffAcc)).toEqual([]);
  });
});
