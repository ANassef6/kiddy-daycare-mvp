// KID-2482: mandatory classroom for children, one admin "Everyone" audience,
// and search on every recipient list.
//
// These tests drive the real server actions (the session cookie is mocked, the
// only thing an action cannot read from the DB) and render the real picker, so
// the pins are behavioural rather than a restatement of the JSX.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mockState = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  headers: () => new Headers(),
  cookies: () => ({
    get: (name: string) => (mockState.cookies[name] ? { name, value: mockState.cookies[name] } : undefined),
    set: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
    err.digest = `NEXT_REDIRECT;replace;${url};`;
    throw err;
  },
}));

import * as store from "@/lib/store";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { getDictionary } from "@/lib/i18n";
import RecipientsPicker, { channelForRoomSelection } from "@/components/RecipientsPicker";
import { seedFixture } from "../helpers";

let iid: string;
let roomA: string;
let roomB: string;
let adminAcc: string;

function signInAs(accountId: string, role: string, email: string): void {
  mockState.cookies = {
    kiddy_sess: createSessionToken({ accountId, role, email, emailConfirmed: true }),
  };
}

async function redirectTargetFor(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (err) {
    const m = /NEXT_REDIRECT;replace;([^;]+);/.exec(String((err as Error & { digest?: string })?.digest ?? ""));
    if (m) return m[1];
    throw err;
  }
}

function addChildForm(roomId?: string): FormData {
  const form = new FormData();
  form.set("firstName", "New");
  form.set("lastName", "Child");
  if (roomId !== undefined) form.set("roomId", roomId);
  form.set("guardianName", "Guardian");
  form.set("guardianRelationship", "parent");
  form.set("guardianPhone", "01000000000");
  return form;
}

beforeEach(async () => {
  mockState.cookies = {};
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  roomB = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool'"))!.id);
  const staff = await store.createStaff({ instituteId: iid, fullName: "KID2482 Admin", role: "admin", roomIds: [] });
  adminAcc = String(
    (await createAccount({ email: "kid2482-admin@example.com", password: "x", fullName: "KID2482 Admin", role: "admin" })).id
  );
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), adminAcc);
  signInAs(adminAcc, "admin", "kid2482-admin@example.com");
});

describe("KID-2482 mandatory classroom", () => {
  it("refuses to create a child without a classroom and writes nothing", async () => {
    const before = Number((await queryGet("SELECT COUNT(*) AS n FROM child"))!.n);
    const { addChildAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() => addChildAction(addChildForm()));
    expect(target).toBe("/portal/children?error=classroom");
    expect(Number((await queryGet("SELECT COUNT(*) AS n FROM child"))!.n)).toBe(before);
  });

  it("creates a child when a classroom is supplied", async () => {
    const { addChildAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() => addChildAction(addChildForm(roomA)));
    expect(target).toMatch(/^\/portal\/children\/[^/?]+$/);
    const row = await queryGet("SELECT room_id FROM child WHERE first_name = 'New' AND last_name = 'Child'");
    expect(String(row?.room_id)).toBe(roomA);
  });

  it("refuses to edit a child into having no classroom", async () => {
    const childId = String((await queryGet("SELECT id FROM child WHERE room_id = ?", roomA))!.id);
    const form = new FormData();
    form.set("childId", childId);
    form.set("firstName", "Kept");
    form.set("lastName", "Room");
    form.set("roomId", "");
    const { updateChildDetailsAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() => updateChildDetailsAction(form));
    expect(target).toBe(`/portal/children/${childId}?error=classroom`);
    const row = await queryGet("SELECT room_id FROM child WHERE id = ?", childId);
    expect(String(row?.room_id)).toBe(roomA);
  });
});

describe("KID-2482 one admin audience option", () => {
  it("renders one Everyone option for admins and no All classrooms duplicate", () => {
    const dict = getDictionary("en");
    const html = renderToStaticMarkup(
      <RecipientsPicker
        dict={dict}
        defaultOpen
        role="admin"
        assignedRoomIds={[]}
        rooms={[
          { id: roomA, name: "Toddlers" },
          { id: roomB, name: "Preschool" },
        ]}
        childOptions={[]}
      />
    );
    expect(html).toContain("Everyone (whole center)");
    expect(html).not.toContain("All classrooms");
    expect(html).not.toContain("Center (everyone)");
  });

  it("keeps teachers on My classrooms only", () => {
    const dict = getDictionary("en");
    const html = renderToStaticMarkup(
      <RecipientsPicker
        dict={dict}
        defaultOpen
        role="staff"
        assignedRoomIds={[roomA]}
        rooms={[
          { id: roomA, name: "Toddlers" },
          { id: roomB, name: "Preschool" },
        ]}
        childOptions={[]}
      />
    );
    expect(html).toContain("My classrooms");
    expect(html).not.toContain("Everyone (whole center)");
    expect(html).not.toContain("All classrooms");
  });

  it("shows the classroom checklist above the child list before any channel is picked", () => {
    // KID-2482 review follow-up: the founder opened the newsfeed picker and
    // reported "still no rooms" because the checklist only rendered after a
    // channel had been selected.
    const dict = getDictionary("en");
    const html = renderToStaticMarkup(
      <RecipientsPicker
        dict={dict}
        defaultOpen
        role="admin"
        assignedRoomIds={[]}
        rooms={[
          { id: roomA, name: "Toddlers" },
          { id: roomB, name: "Preschool" },
        ]}
        childOptions={[
          { id: "child-a", first_name: "Layla", last_name: "Founder", room_id: roomA, room_name: "Toddlers" },
          { id: "child-b", first_name: "Omar", last_name: "Founder", room_id: roomB, room_name: "Preschool" },
        ]}
      />
    );
    expect(html).toContain("Classrooms");
    expect(html).toContain("Toddlers");
    expect(html).toContain("Preschool");
    expect(html.indexOf("Toddlers")).toBeLessThan(html.indexOf("Search children"));
    expect(html.indexOf("Toddlers")).toBeLessThan(html.indexOf("Layla"));
  });

  it("shows teachers only their assigned classrooms in the checklist", () => {
    const dict = getDictionary("en");
    const html = renderToStaticMarkup(
      <RecipientsPicker
        dict={dict}
        defaultOpen
        role="staff"
        assignedRoomIds={[roomA]}
        rooms={[
          { id: roomA, name: "Toddlers" },
          { id: roomB, name: "Preschool" },
        ]}
        childOptions={[
          { id: "child-a", first_name: "Layla", last_name: "Founder", room_id: roomA, room_name: "Toddlers" },
          { id: "child-b", first_name: "Omar", last_name: "Founder", room_id: roomB, room_name: "Preschool" },
        ]}
      />
    );
    expect(html).toContain("Toddlers");
    expect(html).not.toContain("Preschool");
    expect(html).not.toContain("Omar");
    expect(html).not.toContain("Everyone");
    expect(html).toContain("Pick the classrooms you teach to target.");
  });

  it("never maps a teacher's full room selection to the admin-only center channel", () => {
    expect(channelForRoomSelection(false, 2, 2)).toBe("rooms");
    expect(channelForRoomSelection(false, 1, 2)).toBe("rooms");
    expect(channelForRoomSelection(true, 2, 2)).toBe("center");
    expect(channelForRoomSelection(true, 1, 2)).toBe("rooms");
    expect(channelForRoomSelection(true, 0, 0)).toBe("rooms");
  });

  it("has the child-search labels in both locales", () => {
    for (const locale of ["en", "ar"] as const) {
      const dict = getDictionary(locale);
      expect(dict.childrenAdd.searchChildrenPlaceholder).toBeTruthy();
      expect(dict.parent.pickerNoChildrenFound).toBeTruthy();
      expect(dict.parent.pickerClassrooms).toBeTruthy();
      expect(dict.parent.pickerClassroomsHint).toBeTruthy();
      expect(dict.parent.pickerClassroomsHintStaff).toBeTruthy();
      expect(dict.messages.searchRecipientsPlaceholder).toBeTruthy();
    }
  });

  it("resolves Everyone through every classroom at submit time", async () => {
    // A classroom and child created after the picker would have rendered are
    // still in the audience because the action enumerates rooms at submit.
    const newRoom = await store.createRoom(iid, "KID2482 New Room", 10);
    const newChild = await store.createChild({
      instituteId: iid,
      firstName: "Fresh",
      lastName: "RoomChild",
      roomId: String(newRoom.id),
    });
    const all = await store.listChildren(iid);
    const expected = all.map((c) => String(c.id)).sort();

    const form = new FormData();
    form.set("title", "KID2482 Everyone post");
    form.set("eventDate", "2026-11-26");
    form.set("recipientChannel", "center");
    form.set("returnTo", "/portal/learning/activities");
    const { createEventAction } = await import("@/lib/actions");
    await redirectTargetFor(() => createEventAction(form));

    const post = await queryGet("SELECT id FROM newsfeed_post WHERE body LIKE 'Activity: KID2482 Everyone post%'");
    expect(post).toBeTruthy();
    const tags = await queryAll("SELECT child_id FROM newsfeed_tag WHERE post_id = ?", String(post!.id));
    expect(tags.map((t) => String(t.child_id)).sort()).toEqual(expected);
    expect(tags.map((t) => String(t.child_id))).toContain(String(newChild.id));
  });
});
