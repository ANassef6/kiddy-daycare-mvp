// KID-2480: the founder's "who can pick what" rule is enforced on the server,
// not only by hiding UI. These tests call the server actions directly with a
// hand-built FormData — the same boundary a raw form POST reaches.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  host: "" as string,
  cookies: {} as Record<string, string>,
}));
vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.cookie) entries.cookie = mockState.cookie;
    if (mockState.host) entries.host = mockState.host;
    return new Headers(entries);
  },
  cookies: () => ({
    get: (name: string) => (mockState.cookies[name] ? { name, value: mockState.cookies[name] } : undefined),
    set: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));

import { createAccount, createSessionToken } from "@/lib/auth";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { createEvent, createStaff } from "@/lib/store";
import { seedFixture } from "../helpers";

let iid: string;
let toddlers: string;
let preschool: string;
let teacherId: string;
let ownerId: string;

function setCookie(accountId: string, role: string, email = "viewer@example.test"): void {
  const token = createSessionToken({ accountId, role, email, emailConfirmed: true });
  mockState.cookie = `kiddy_sess=${encodeURIComponent(token)}`;
  mockState.cookies = { kiddy_sess: token };
  mockState.host = "daycare.test";
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function expectRedirect(promise: Promise<unknown>, urlPart: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    digest: expect.stringContaining(urlPart),
  });
}

beforeEach(async () => {
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  toddlers = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers' LIMIT 1"))!.id);
  preschool = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool' LIMIT 1"))!.id);
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);

  const staff = await createStaff({
    instituteId: iid,
    fullName: "Kim Teacher",
    role: "carer",
    roomIds: [toddlers],
  });
  const teacher = await createAccount({
    email: "kid2480-actions-teacher@example.test",
    password: "kiddy-staff",
    fullName: "Kim Teacher",
    role: "staff",
  });
  teacherId = String(teacher.id);
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), teacherId);
});

afterEach(() => {
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
});

async function eventRows(): Promise<Array<Record<string, unknown>>> {
  return queryAll("SELECT * FROM event WHERE institute_id = ? ORDER BY event_date", iid);
}

describe("KID-2480: createEventAction server enforcement", () => {
  it("rejects a teacher posting a whole-center event", async () => {
    setCookie(teacherId, "staff");
    const { createEventAction } = await import("@/lib/actions");

    await expectRedirect(
      createEventAction(form({
        title: "Center-wide",
        eventDate: "2026-12-01",
        classroomId: "",
      })),
      "/portal/events?error=eventClass"
    );
    const rows = await eventRows();
    expect(rows.some((r) => String(r.title) === "Center-wide")).toBe(false);
  });

  it("rejects a teacher targeting a classroom they are not assigned to", async () => {
    setCookie(teacherId, "staff");
    const { createEventAction } = await import("@/lib/actions");

    await expectRedirect(
      createEventAction(form({
        title: "Wrong class",
        eventDate: "2026-12-01",
        classroomId: preschool,
      })),
      "/portal/events?error=eventClass"
    );
    const rows = await eventRows();
    expect(rows.some((r) => String(r.title) === "Wrong class")).toBe(false);
  });

  it("lets a teacher target their own classroom", async () => {
    setCookie(teacherId, "staff");
    const { createEventAction } = await import("@/lib/actions");

    await expectRedirect(
      createEventAction(form({
        title: "Toddler art",
        eventDate: "2026-12-01",
        classroomId: toddlers,
      })),
      "/portal/events"
    );
    const row = (await queryGet("SELECT * FROM event WHERE title = 'Toddler art'"))!;
    expect(String(row.classroom_id)).toBe(toddlers);
  });

  it("lets an admin post a whole-center event", async () => {
    setCookie(ownerId, "owner", "owner@example.test");
    const { createEventAction } = await import("@/lib/actions");

    await expectRedirect(
      createEventAction(form({
        title: "Whole center",
        eventDate: "2026-12-01",
        classroomId: "",
      })),
      "/portal/events"
    );
    const row = (await queryGet("SELECT * FROM event WHERE title = 'Whole center'"))!;
    expect(row.classroom_id).toBeNull();
  });
});

describe("KID-2480: updateEventAction server enforcement", () => {
  async function edit(eventId: string, classroomId: string): Promise<FormData> {
    return form({
      eventId,
      title: "Edited",
      eventDate: "2026-12-02",
      classroomId,
    });
  }

  it("rejects a teacher editing a center-wide event", async () => {
    const centre = await createEvent({ instituteId: iid, title: "Centre", eventDate: "2026-12-01" });
    setCookie(teacherId, "staff");
    const { updateEventAction } = await import("@/lib/actions");

    await expectRedirect(updateEventAction(await edit(String(centre.id), toddlers)), "/portal/events?error=eventClass");
    const row = (await queryGet("SELECT * FROM event WHERE id = ?", String(centre.id)))!;
    expect(row.classroom_id).toBeNull();
    expect(String(row.title)).toBe("Centre");
  });

  it("rejects a teacher editing another class's event or moving their own to it", async () => {
    const other = await createEvent({
      instituteId: iid,
      title: "Preschool trip",
      eventDate: "2026-12-01",
      classroomId: preschool,
    });
    const mine = await createEvent({
      instituteId: iid,
      title: "Toddler art",
      eventDate: "2026-12-01",
      classroomId: toddlers,
    });
    setCookie(teacherId, "staff");
    const { updateEventAction } = await import("@/lib/actions");

    await expectRedirect(updateEventAction(await edit(String(other.id), toddlers)), "/portal/events?error=eventClass");
    await expectRedirect(updateEventAction(await edit(String(mine.id), preschool)), "/portal/events?error=eventClass");

    expect(String((await queryGet("SELECT classroom_id FROM event WHERE id = ?", String(other.id)))!.classroom_id)).toBe(preschool);
    expect(String((await queryGet("SELECT classroom_id FROM event WHERE id = ?", String(mine.id)))!.classroom_id)).toBe(toddlers);
  });

  it("lets a teacher edit an event targeted at their own classroom", async () => {
    const mine = await createEvent({
      instituteId: iid,
      title: "Toddler art",
      eventDate: "2026-12-01",
      classroomId: toddlers,
    });
    setCookie(teacherId, "staff");
    const { updateEventAction } = await import("@/lib/actions");

    await expectRedirect(updateEventAction(await edit(String(mine.id), toddlers)), "/portal/events");
    const row = (await queryGet("SELECT * FROM event WHERE id = ?", String(mine.id)))!;
    expect(String(row.title)).toBe("Edited");
    expect(String(row.classroom_id)).toBe(toddlers);
  });
});
