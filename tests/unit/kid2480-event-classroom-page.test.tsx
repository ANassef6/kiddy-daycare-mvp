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

import { createSessionToken } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { createEvent } from "@/lib/store";
import { seedFixture } from "../helpers";

let iid: string;
let toddlerRoom: string;
let ownerId: string;

beforeEach(async () => {
  mockState.cookie = "";
  mockState.host = "";
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  toddlerRoom = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers' LIMIT 1"))!.id);
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
  mockState.host = "daycare.test";
  mockState.cookie = `kiddy_sess=${encodeURIComponent(
    createSessionToken({ accountId: ownerId, role: "owner", email: "owner@example.test", emailConfirmed: true })
  )}`;
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
  it("offers the optional class dropdown on the create form", async () => {
    const html = await renderEvents();
    expect(html).toContain("Class (optional)");
    expect(html).toContain("Whole center");
    expect(html).toContain('name="classroomId"');
    expect(html).toContain(`value="${toddlerRoom}"`);
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
});
