// KID-2482 review follow-up: the founder reported "on events, parent drive and
// homework, still no classrooms. On supplies, no recipient list at all."
// These tests drive the real server actions for the four surfaces and pin that
// a classroom pick reaches exactly that classroom's children.

import { beforeAll, describe, expect, it, vi } from "vitest";

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
import { createSessionToken } from "@/lib/auth";
import { queryAll, queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";

let iid: string;
let roomA: string;
let roomB: string;
let ownerId: string;
let ownerEmail: string;

function signInAsOwner(): void {
  mockState.cookies = {
    kiddy_sess: createSessionToken({ accountId: ownerId, role: "owner", email: ownerEmail, emailConfirmed: true }),
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

async function roomChildIds(roomId: string): Promise<string[]> {
  return (await store.listChildren(iid))
    .filter((c) => String(c.room_id) === roomId)
    .map((c) => String(c.id))
    .sort();
}

function roomAudienceForm(roomId: string): FormData {
  const form = new FormData();
  form.set("recipientChannel", "rooms");
  form.append("recipientRoomIds", roomId);
  return form;
}

beforeAll(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  roomB = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool'"))!.id);
  const owner = await queryGet("SELECT id, email FROM account WHERE role = 'owner' LIMIT 1");
  ownerId = String(owner!.id);
  ownerEmail = String(owner!.email);
  signInAsOwner();
});

describe("KID-2482 homework classroom audience", () => {
  it("assigns one homework row per child in the picked classroom", async () => {
    signInAsOwner();
    const title = `KID2482 homework room ${Date.now()}`;
    const form = roomAudienceForm(roomA);
    form.set("title", title);
    form.set("dueDate", "2026-12-01");
    const { assignHomeworkAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() => assignHomeworkAction(form));
    expect(target).toBe("/portal/learning/homework");

    const rows = await queryAll("SELECT child_id FROM homework WHERE title = ?", title);
    const expected = await roomChildIds(roomA);
    expect(expected.length).toBeGreaterThan(0);
    expect(rows.map((r) => String(r.child_id)).sort()).toEqual(expected);

    const post = await queryGet("SELECT id FROM newsfeed_post WHERE body LIKE ?", `Homework: ${title}%`);
    expect(post).toBeTruthy();
    const tags = await queryAll("SELECT child_id FROM newsfeed_tag WHERE post_id = ?", String(post!.id));
    expect(tags.map((t) => String(t.child_id)).sort()).toEqual(expected);
  });

  it("keeps centre-wide homework as a single all-children row", async () => {
    signInAsOwner();
    const title = `KID2482 homework all ${Date.now()}`;
    const form = new FormData();
    form.set("recipientChannel", "center");
    form.set("title", title);
    const { assignHomeworkAction } = await import("@/lib/actions");
    await redirectTargetFor(() => assignHomeworkAction(form));
    const rows = await queryAll("SELECT child_id FROM homework WHERE title = ?", title);
    expect(rows).toHaveLength(1);
    expect(rows[0].child_id).toBeNull();
  });
});

describe("KID-2482 parent drive classroom audience", () => {
  it("shares one row per child in the picked classroom", async () => {
    signInAsOwner();
    const filename = `KID2482-room-${Date.now()}.pdf`;
    const form = roomAudienceForm(roomA);
    form.set("filename", filename);
    form.set("file", new File([Buffer.from("%PDF-1.4 room")], "room.pdf", { type: "application/pdf" }));
    form.set("kind", "file");
    const { addDriveFileAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() => addDriveFileAction(form));
    expect(target).toBe("/portal/drive");

    const rows = await queryAll("SELECT child_id FROM drive_file WHERE filename = ?", filename);
    const expected = await roomChildIds(roomA);
    expect(expected.length).toBeGreaterThan(0);
    expect(rows.map((r) => String(r.child_id)).sort()).toEqual(expected);
  });
});

describe("KID-2482 supplies recipients", () => {
  it("tags the supply newsfeed post to the picked classroom", async () => {
    signInAsOwner();
    const title = `KID2482 supplies room ${Date.now()}`;
    const form = roomAudienceForm(roomA);
    form.set("title", title);
    form.set("quantity", "3");
    form.set("unit", "pcs");
    const { createSupplyAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() => createSupplyAction(form));
    expect(target).toBe("/portal/supplies");

    const post = await queryGet("SELECT id FROM newsfeed_post WHERE body LIKE ?", `Supplies needed: ${title}%`);
    expect(post).toBeTruthy();
    const tags = await queryAll("SELECT child_id FROM newsfeed_tag WHERE post_id = ?", String(post!.id));
    const expected = await roomChildIds(roomA);
    expect(expected.length).toBeGreaterThan(0);
    expect(tags.map((t) => String(t.child_id)).sort()).toEqual(expected);
  });
});

describe("KID-2482 events classroom audience", () => {
  it("creates the event on the picked classroom only", async () => {
    signInAsOwner();
    const title = `KID2482 event room ${Date.now()}`;
    const form = roomAudienceForm(roomB);
    form.set("title", title);
    form.set("eventDate", "2026-12-05");
    const { createEventAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() => createEventAction(form));
    expect(target).toBe("/portal/events");

    const events = await queryAll("SELECT classroom_id FROM event WHERE title = ?", title);
    expect(events).toHaveLength(1);
    expect(String(events[0].classroom_id)).toBe(roomB);
  });
});
