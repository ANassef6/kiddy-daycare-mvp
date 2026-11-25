// KID-2481: room photos (upload + remove) and child-photo removal.
//
// Pins the server boundary: only room editors may change a room photo, only
// child editors may change/remove a child photo, and removal writes NULL so
// every render surface falls back to colour/initials.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture, mustGet } from "../helpers";

const sessionCookie = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (name === "kiddy_sess" ? sessionCookie : undefined) }),
  headers: () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
    err.digest = `NEXT_REDIRECT;replace;${url};`;
    throw err;
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));
vi.mock("@/lib/storage", async () => {
  const helper = await import("../helpers/kid1177-storage");
  return {
    ...helper.kid1177StorageMock,
    r2Configured: () => false,
    r2PrivateRef: (key: string) => `${helper.PREFIX}${key}`,
    r2PublicRef: (key: string) => `r2-public:${key}`,
    storageProvider: () => "supabase",
    r2PublicUrl: () => null,
    headPrivateObject: async () => null,
    signedPrivateUpload: async () => null,
    deletePrivateObject: async () => undefined,
  };
});

async function redirectTargetOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const message = String((err as Error).message ?? "");
    if (message.startsWith("NEXT_REDIRECT")) return message.slice("NEXT_REDIRECT: ".length);
    throw err;
  }
  throw new Error("action did not redirect");
}

async function signInAs(accountId: string, role: string, email: string) {
  sessionCookie.value = createSessionToken({
    accountId,
    role,
    email,
    accountConfirmed: true,
  } as never);
}

async function ownerSession() {
  const owner = await mustGet("SELECT id, email FROM account WHERE role = 'owner' LIMIT 1");
  await signInAs(String(owner.id), "owner", String(owner.email));
  return owner;
}

async function staffSessionForRoom(roomId: string) {
  const iid = String((await mustGet("SELECT id FROM institute LIMIT 1")).id);
  const { createStaff } = await import("@/lib/store");
  const staff = await createStaff({
    instituteId: iid,
    fullName: "Room Teacher",
    role: "staff",
    roomIds: [roomId],
  });
  const account = await createAccount({
    email: "kid2481-staff@example.test",
    password: "kiddy-staff-2481",
    fullName: "Room Teacher",
    role: "staff",
  });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), String(account.id));
  await signInAs(String(account.id), "staff", "kid2481-staff@example.test");
  return { staff, account };
}

beforeEach(async () => {
  await seedFixture();
  const { storage1177 } = await import("../helpers/kid1177-storage");
  storage1177.uploads = [];
  storage1177.removed = [];
  storage1177.uploadError = null;
});

describe("KID-2481 room photos", () => {
  it("uploads a room photo through the private image pipeline and stores the REF", async () => {
    await ownerSession();
    const room = await mustGet("SELECT id, name, institute_id FROM room LIMIT 1");
    const { uploadRoomPhotoAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("roomId", String(room.id));
    form.set(
      "file",
      new File([Buffer.from("fake-png-bytes")], "room.png", { type: "image/png" })
    );
    const target = await redirectTargetOf(() => uploadRoomPhotoAction(form));
    expect(target).toBe(`/portal/rooms/${String(room.id)}`);

    const after = await mustGet("SELECT photo_url FROM room WHERE id = ?", String(room.id));
    expect(String(after.photo_url)).toMatch(
      new RegExp(`^kiddy-private:photos/${String(room.institute_id)}/room/${String(room.id)}/photo-.*\\.png$`)
    );
    const { storage1177 } = await import("../helpers/kid1177-storage");
    expect(storage1177.uploads).toHaveLength(1);
    expect(storage1177.uploads[0].path.startsWith(`photos/${String(room.institute_id)}/room/${String(room.id)}/`)).toBe(true);
  });

  it("removes a room photo so the room falls back to its colour", async () => {
    await ownerSession();
    const room = await mustGet("SELECT id FROM room LIMIT 1");
    const { updateRoomPhoto } = await import("@/lib/store");
    await updateRoomPhoto(String(room.id), "kiddy-private:photos/i/r/photo.png");
    const { removeRoomPhotoAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("roomId", String(room.id));
    const target = await redirectTargetOf(() => removeRoomPhotoAction(form));
    expect(target).toBe(`/portal/rooms/${String(room.id)}`);
    const after = await mustGet("SELECT photo_url FROM room WHERE id = ?", String(room.id));
    expect(after.photo_url ?? null).toBeNull();
  });

  it("rejects a non-admin room photo upload server-side", async () => {
    const room = await mustGet("SELECT id FROM room LIMIT 1");
    await staffSessionForRoom(String(room.id));
    const { uploadRoomPhotoAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("roomId", String(room.id));
    form.set("file", new File([Buffer.from("fake-png-bytes")], "room.png", { type: "image/png" }));
    const target = await redirectTargetOf(() => uploadRoomPhotoAction(form));
    expect(target).toBe("/portal/dashboard");
    const after = await mustGet("SELECT photo_url FROM room WHERE id = ?", String(room.id));
    expect(after.photo_url ?? null).toBeNull();
  });

  it("scopes a direct-upload photo key to the room folder", async () => {
    const { uploadKeyFor } = await import("@/lib/media-upload");
    const key = uploadKeyFor(
      { purpose: "photo", entityType: "room", entityId: "room-1", contentType: "image/png", size: 10 },
      "inst-1",
      "png",
      "uuid-1"
    );
    expect(key).toMatch(/^photos\/inst-1\/room\/room-1\/photo-\d+-uuid-1\.png$/);
  });
});

describe("KID-2481 child photo removal", () => {
  it("lets an in-scope staff member remove a child photo", async () => {
    const room = await mustGet("SELECT id FROM room LIMIT 1");
    const child = await mustGet("SELECT id FROM child WHERE room_id = ? LIMIT 1", String(room.id));
    const { updateChildPhoto } = await import("@/lib/store");
    await updateChildPhoto(String(child.id), "kiddy-private:child/photo.png");
    await staffSessionForRoom(String(room.id));

    const { removeChildPhotoAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("childId", String(child.id));
    const target = await redirectTargetOf(() => removeChildPhotoAction(form));
    expect(target).toBe(`/portal/children/${String(child.id)}`);
    const after = await mustGet("SELECT photo_url FROM child WHERE id = ?", String(child.id));
    expect(after.photo_url ?? null).toBeNull();
  });

  it("rejects a parent account server-side and leaves the photo intact", async () => {
    const parent = await mustGet("SELECT id, email FROM account WHERE role = 'parent' LIMIT 1");
    await signInAs(String(parent.id), "parent", String(parent.email));
    const child = await mustGet("SELECT id FROM child LIMIT 1");
    const { updateChildPhoto } = await import("@/lib/store");
    await updateChildPhoto(String(child.id), "kiddy-private:child/photo.png");

    const { removeChildPhotoAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("childId", String(child.id));
    const target = await redirectTargetOf(() => removeChildPhotoAction(form));
    expect(target).toBe("/portal/children?error=scope");
    const after = await mustGet("SELECT photo_url FROM child WHERE id = ?", String(child.id));
    expect(after.photo_url).toBe("kiddy-private:child/photo.png");
  });
});
