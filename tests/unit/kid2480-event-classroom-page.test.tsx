// KID-2480: the staff events surface must offer the optional classroom
// dropdown, show the classroom badge on targeted events, and prefill the edit
// form. The rendered page is checked against the real SQLite fixture (same
// mocked-headers harness as kid221/kid368).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mockState = vi.hoisted(() => ({ cookie: "", host: "" }));
vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.cookie) entries.cookie = mockState.cookie;
    if (mockState.host) entries.host = mockState.host;
    return new Headers(entries);
  },
  cookies: () => ({ get: () => undefined, set: () => undefined }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    redirect: (url: string) => {
      throw new Error(`NEXT_REDIRECT: ${url}`);
    },
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  };
});

import { createAccount, createSessionToken } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { createEvent, createStaff } from "@/lib/store";
import { seedFixture } from "../helpers";

let iid: string;
let toddlerRoom: string;
let preschoolRoom: string;
let ownerId: string;

function signIn(accountId: string, role: string, email = "viewer@example.test"): void {
  mockState.host = "daycare.test";
  mockState.cookie = `kiddy_sess=${encodeURIComponent(
    createSessionToken({ accountId, role, email, emailConfirmed: true })
  )}`;
}

async function makeTeacher(roomIds: string[]): Promise<string> {
  const staff = await createStaff({
    instituteId: iid,
    fullName: "Kim Teacher",
    role: "carer",
    roomIds,
  });
  const account = await createAccount({
    email: `teacher-${Math.random().toString(36).slice(2, 8)}@example.test`,
    password: "kiddy-staff",
    fullName: "Kim Teacher",
    role: "staff",
  });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), String(account.id));
  return String(account.id);
}

beforeEach(async () => {
  mockState.cookie = "";
  mockState.host = "";
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  toddlerRoom = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers' LIMIT 1"))!.id);
  preschoolRoom = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool' LIMIT 1"))!.id);
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
  signIn(ownerId, "owner");
});

afterEach(() => {
  mockState.cookie = "";
  mockState.host = "";
});

async function renderEvents(params: Record<string, string> = {}): Promise<string> {
  const page = await import("@/app/portal/events/page");
  return renderToStaticMarkup(await page.default({ searchParams: Promise.resolve(params) }));
}

describe("KID-2480: staff events page", () => {
  it("offers the recipients picker instead of the old single-class select", async () => {
    // KID-2482 review follow-up: the standalone Events composer now uses the
    // same classroom-aware picker as newsfeed/activities. The picker is closed
    // until clicked (same as the other composers); the open checklist itself is
    // pinned in kid2482-recipients-picker.test.tsx.
    const html = await renderEvents();
    expect(html).toContain("Recipients");
    expect(html).toContain("Choose recipients…");
    expect(html).not.toContain("Class (optional)");
  });

  it("shows the classroom name badge on a targeted event", async () => {
    await createEvent({
      instituteId: iid,
      title: "Toddler picnic",
      eventDate: "2026-12-01",
      classroomId: toddlerRoom,
    });
    const html = await renderEvents();
    expect(html).toContain("Toddler picnic");
    // The badge is the room name as an inline element next to the date badge.
    expect(html).toContain('style="margin-inline-start:6px">Toddlers</span>');
  });

  it("prefills the edit form and preselects the event's classroom", async () => {
    const event = await createEvent({
      instituteId: iid,
      title: "Preschool trip",
      eventDate: "2026-12-04",
      location: "Museum",
      classroomId: toddlerRoom,
    });
    const html = await renderEvents({ edit: String(event.id) });
    expect(html).toContain("Edit event");
    expect(html).toContain('value="Preschool trip"');
    expect(html).toContain('value="Museum"');
    expect(html).toContain('name="eventId"');
    expect(html).toContain(`value="${event.id}"`);
  });

  it("a teacher gets only their own room and no whole-center option", async () => {
    const teacherId = await makeTeacher([toddlerRoom]);
    signIn(teacherId, "staff");

    const centre = await createEvent({ instituteId: iid, title: "Centre fair", eventDate: "2026-12-01" });
    const toddlerEvent = await createEvent({
      instituteId: iid,
      title: "Toddler picnic",
      eventDate: "2026-12-02",
      classroomId: toddlerRoom,
    });
    await createEvent({
      instituteId: iid,
      title: "Preschool trip",
      eventDate: "2026-12-03",
      classroomId: preschoolRoom,
    });

    const html = await renderEvents();
    expect(html).not.toContain("Everyone (whole center)");
    expect(html).not.toContain("Whole center");
    expect(html).toContain("Recipients");
    expect(html).toContain("Choose recipients…");

    // Audience: center-wide + their own room; another class is not rendered.
    expect(html).toContain("Centre fair");
    expect(html).toContain("Toddler picnic");
    expect(html).not.toContain("Preschool trip");

    // A teacher may edit only the class event they are assigned to.
    expect(html).toContain(`/portal/events?edit=${toddlerEvent.id}`);
    expect(html).not.toContain(`/portal/events?edit=${centre.id}`);
  });

  it("a teacher with no classroom assignment cannot open the create form", async () => {
    const teacherId = await makeTeacher([]);
    signIn(teacherId, "staff");

    const html = await renderEvents();
    expect(html).toContain("You are not assigned to a classroom yet.");
    expect(html).not.toContain("Add an event");
  });
});
