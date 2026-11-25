// KID-2480: events can target one classroom (event.classroom_id, nullable).
//
// Staff create a center-wide event or a classroom event; the staff listing
// carries the classroom name for the badge. Families see center-wide events
// plus events targeted at their own children's classrooms and nothing else.
// The scope fails closed: a parent with no family links (or children with no
// room) gets only the center-wide events.

import { beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { createChild, createEvent, getEvent, linkFamily, listEvents, updateEvent } from "@/lib/store";
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

  it("staff listing keeps every event and joins the classroom name", async () => {
    const centre = await createEvent({ instituteId: iid, title: "Centre", eventDate: "2026-12-01" });
    const targeted = await createEvent({
      instituteId: iid,
      title: "Toddlers only",
      eventDate: "2026-12-02",
      classroomId: toddlers,
    });

    const all = await listEvents(iid);
    expect(ours(all)).toEqual(["Centre", "Toddlers only"]);
    expect(all.find((e) => String(e.id) === String(centre.id))!.classroom_name).toBeNull();
    expect(String(all.find((e) => String(e.id) === String(targeted.id))!.classroom_name)).toBe("Toddlers");
  });

  it("a parent sees center-wide events plus their own child's classroom only", async () => {
    await createEvent({ instituteId: iid, title: "Centre", eventDate: "2026-12-01" });
    await createEvent({ instituteId: iid, title: "Toddlers only", eventDate: "2026-12-02", classroomId: toddlers });
    await createEvent({ instituteId: iid, title: "Preschool only", eventDate: "2026-12-03", classroomId: preschool });

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

    const visible = await listEvents(iid, false, { parentAccountId: String(parent.id) });
    expect(ours(visible)).toEqual(["Centre", "Toddlers only"]);
  });

  it("fails closed: a parent with no family links sees only center-wide events", async () => {
    await createEvent({ instituteId: iid, title: "Centre", eventDate: "2026-12-01" });
    await createEvent({ instituteId: iid, title: "Toddlers only", eventDate: "2026-12-02", classroomId: toddlers });

    const stranger = await createAccount({
      email: "kid2480-stranger@example.test",
      password: "kiddy-parent",
      fullName: "No Links",
      role: "parent",
    });
    const visible = await listEvents(iid, false, { parentAccountId: String(stranger.id) });
    expect(ours(visible)).toEqual(["Centre"]);
  });

  it("a child with no classroom does not widen the parent's scope", async () => {
    await createEvent({ instituteId: iid, title: "Centre", eventDate: "2026-12-01" });
    await createEvent({ instituteId: iid, title: "Toddlers only", eventDate: "2026-12-02", classroomId: toddlers });

    const parent = await createAccount({
      email: "kid2480-noroom@example.test",
      password: "kiddy-parent",
      fullName: "No Room Parent",
      role: "parent",
    });
    const child = await createChild({ instituteId: iid, firstName: "Nora", lastName: "NoRoom" });
    await linkFamily(String(parent.id), String(child.id));

    const visible = await listEvents(iid, false, { parentAccountId: String(parent.id) });
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
