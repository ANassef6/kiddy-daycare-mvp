// KID-2480: events can target one classroom (event.classroom_id, nullable).
//
// Founder rules (KID-215 comment d5db93bd):
//   - only owner/admin may post a whole-center event;
//   - teachers/caregivers may target only their staff_room classrooms;
//   - a targeted event is visible only to that class's families, its assigned
//     staff, and admins/owner — never to other parents or other classes' staff.
//
// The store scope fails closed: an account with no matching room sees only the
// center-wide events.

import { beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import {
  canTargetClassroom,
  canTargetWholeCenter,
  createChild,
  createEvent,
  createStaff,
  eventAudienceRoomIds,
  eventEditableBy,
  getEvent,
  linkFamily,
  listEvents,
  updateEvent,
} from "@/lib/store";
import { seedFixture } from "../helpers";

let iid: string;
let toddlers: string;
let preschool: string;

function titles(rows: Awaited<ReturnType<typeof listEvents>>): string[] {
  return rows.map((r) => String(r.title));
}

// The demo fixture already ships two center-wide events; these tests compare
// only the events they create.
const TEST_TITLES = new Set(["Centre", "Toddlers only", "Preschool only", "Move me", "Moved"]);
function ours(rows: Awaited<ReturnType<typeof listEvents>>): string[] {
  return titles(rows).filter((t) => TEST_TITLES.has(t));
}

async function seedThreeEvents(): Promise<void> {
  await createEvent({ instituteId: iid, title: "Centre", eventDate: "2026-12-01" });
  await createEvent({ instituteId: iid, title: "Toddlers only", eventDate: "2026-12-02", classroomId: toddlers });
  await createEvent({ instituteId: iid, title: "Preschool only", eventDate: "2026-12-03", classroomId: preschool });
}

async function staffAccount(roomIds: string[]): Promise<string> {
  const email = `kid2480-staff-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const staff = await createStaff({
    instituteId: iid,
    fullName: "Test Teacher",
    role: "carer",
    roomIds,
  });
  const account = await createAccount({ email, password: "kiddy-staff", fullName: "Test Teacher", role: "staff" });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), String(account.id));
  return String(account.id);
}

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  toddlers = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers' LIMIT 1"))!.id);
  preschool = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool' LIMIT 1"))!.id);
});

describe("KID-2480: event classroom target", () => {
  it("defaults to a center-wide event and persists an explicit classroom", async () => {
    const centre = await createEvent({ instituteId: iid, title: "Centre", eventDate: "2026-12-01" });
    const targeted = await createEvent({
      instituteId: iid,
      title: "Toddlers only",
      eventDate: "2026-12-02",
      classroomId: toddlers,
    });
    expect(centre.classroom_id).toBeNull();
    expect(String(targeted.classroom_id)).toBe(toddlers);
  });

  it("owner/admin listing keeps every event and joins the classroom name", async () => {
    const centre = await createEvent({ instituteId: iid, title: "Centre", eventDate: "2026-12-01" });
    const targeted = await createEvent({
      instituteId: iid,
      title: "Toddlers only",
      eventDate: "2026-12-02",
      classroomId: toddlers,
    });
    const owner = await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1");

    const all = await listEvents(iid, false, {
      viewerAccountId: String(owner!.id),
      viewerRole: "owner",
    });
    expect(ours(all)).toEqual(["Centre", "Toddlers only"]);
    expect(all.find((e) => String(e.id) === String(centre.id))!.classroom_name).toBeNull();
    expect(String(all.find((e) => String(e.id) === String(targeted.id))!.classroom_name)).toBe("Toddlers");
  });

  it("a parent sees center-wide events plus their own child's classroom only", async () => {
    await seedThreeEvents();
    const parent = await createAccount({
      email: "kid2480-toddler@example.test",
      password: "kiddy-parent",
      fullName: "Toddler Parent",
      role: "parent",
    });
    const child = await createChild({
      instituteId: iid,
      firstName: "Tia",
      lastName: "Toddler",
      roomId: toddlers,
    });
    await linkFamily(String(parent.id), String(child.id));

    const visible = await listEvents(iid, false, {
      viewerAccountId: String(parent.id),
      viewerRole: "parent",
    });
    expect(ours(visible)).toEqual(["Centre", "Toddlers only"]);
  });

  it("a parent without a child in the class sees only center-wide events", async () => {
    await seedThreeEvents();
    const parent = await createAccount({
      email: "kid2480-preschool@example.test",
      password: "kiddy-parent",
      fullName: "Preschool Parent",
      role: "parent",
    });
    const child = await createChild({
      instituteId: iid,
      firstName: "Pia",
      lastName: "Preschool",
      roomId: preschool,
    });
    await linkFamily(String(parent.id), String(child.id));

    const visible = await listEvents(iid, false, {
      viewerAccountId: String(parent.id),
      viewerRole: "parent",
    });
    expect(ours(visible)).toEqual(["Centre", "Preschool only"]);
  });

  it("fails closed: a parent with no family links sees only center-wide events", async () => {
    await seedThreeEvents();
    const stranger = await createAccount({
      email: "kid2480-stranger@example.test",
      password: "kiddy-parent",
      fullName: "No Links",
      role: "parent",
    });
    const visible = await listEvents(iid, false, {
      viewerAccountId: String(stranger.id),
      viewerRole: "parent",
    });
    expect(ours(visible)).toEqual(["Centre"]);
  });

  it("a child with no classroom does not widen the parent's scope", async () => {
    await seedThreeEvents();
    const parent = await createAccount({
      email: "kid2480-noroom@example.test",
      password: "kiddy-parent",
      fullName: "No Room Parent",
      role: "parent",
    });
    const child = await createChild({ instituteId: iid, firstName: "Nora", lastName: "NoRoom" });
    await linkFamily(String(parent.id), String(child.id));

    const visible = await listEvents(iid, false, {
      viewerAccountId: String(parent.id),
      viewerRole: "parent",
    });
    expect(ours(visible)).toEqual(["Centre"]);
  });

  it("a teacher sees center-wide events plus only their assigned classroom", async () => {
    await seedThreeEvents();
    const teacher = await staffAccount([toddlers]);

    expect(await eventAudienceRoomIds(iid, teacher, "staff")).toEqual([toddlers]);
    const visible = await listEvents(iid, false, { viewerAccountId: teacher, viewerRole: "staff" });
    expect(ours(visible)).toEqual(["Centre", "Toddlers only"]);
  });

  it("a teacher with no classroom assignment sees only center-wide events", async () => {
    await seedThreeEvents();
    const teacher = await staffAccount([]);

    const visible = await listEvents(iid, false, { viewerAccountId: teacher, viewerRole: "carer" });
    expect(ours(visible)).toEqual(["Centre"]);
  });

  it("updateEvent can move an event between classrooms and back to center-wide", async () => {
    const event = await createEvent({
      instituteId: iid,
      title: "Move me",
      eventDate: "2026-12-01",
      classroomId: toddlers,
    });
    const id = String(event.id);

    await updateEvent(id, { classroomId: preschool, title: "Moved" });
    let row = (await getEvent(id))!;
    expect(String(row.classroom_id)).toBe(preschool);
    expect(String(row.title)).toBe("Moved");
    expect(String(row.classroom_name)).toBe("Preschool");

    await updateEvent(id, { classroomId: null });
    row = (await getEvent(id))!;
    expect(row.classroom_id).toBeNull();
    expect(row.classroom_name).toBeNull();
  });
});

describe("KID-2480: who may pick/change a classroom", () => {
  it("only owner/admin may post a whole-center event", () => {
    expect(canTargetWholeCenter("owner")).toBe(true);
    expect(canTargetWholeCenter("admin")).toBe(true);
    expect(canTargetWholeCenter("staff")).toBe(false);
    expect(canTargetWholeCenter("carer")).toBe(false);
    expect(canTargetWholeCenter("parent")).toBe(false);
  });

  it("teachers are limited to their assigned rooms", () => {
    expect(canTargetClassroom("staff", [toddlers], toddlers)).toBe(true);
    expect(canTargetClassroom("staff", [toddlers], preschool)).toBe(false);
    expect(canTargetClassroom("staff", [toddlers], null)).toBe(false);
    expect(canTargetClassroom("carer", [], null)).toBe(false);
    expect(canTargetClassroom("admin", null, preschool)).toBe(true);
  });

  it("teachers may edit only events already targeted at their rooms", () => {
    expect(eventEditableBy("staff", [toddlers], toddlers)).toBe(true);
    expect(eventEditableBy("staff", [toddlers], preschool)).toBe(false);
    expect(eventEditableBy("staff", [toddlers], null)).toBe(false);
    expect(eventEditableBy("admin", null, null)).toBe(true);
    expect(eventEditableBy("admin", null, preschool)).toBe(true);
  });
});
