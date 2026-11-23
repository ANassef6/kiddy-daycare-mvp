// KID-2466: events accept real photo/video attachments.
//
// Pins the boundary the portal relies on:
//   * the new "event" upload purpose is photo/video only and capped at 4 MB;
//   * the action refuses bad sizes/types/over-long video and never writes a row;
//   * a valid photo and a valid video land in media_event;
//   * a row can only be attached to an event that belongs to the caller's tenant;
//   * both event pages render event media through signed URLs, never raw REFs.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSessionToken } from "@/lib/auth";
import { createEvent } from "@/lib/store";
import { seedFixture, mustGet } from "../helpers";
import {
  MAX_EVENT_ATTACHMENT_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
} from "@/lib/media-limits";

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

function box(type: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}

function mp4(timescale: number, duration: number): Uint8Array<ArrayBuffer> {
  const ftyp = box("ftyp", new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]));
  const body = new Uint8Array(20);
  const view = new DataView(body.buffer);
  view.setUint32(12, timescale);
  view.setUint32(16, duration);
  const moov = box("moov", box("mvhd", body));
  const out = new Uint8Array(ftyp.length + moov.length);
  out.set(ftyp, 0);
  out.set(moov, ftyp.length);
  return out;
}

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

async function mediaCountFor(eventId: string): Promise<number> {
  const row = await mustGet(
    "SELECT COUNT(*) c FROM media_event WHERE event_id = ?",
    eventId
  );
  return Number(row.c);
}

let iid: string;
let eventId: string;

beforeEach(async () => {
  await seedFixture();
  const owner = await mustGet("SELECT id FROM account WHERE role = 'owner'");
  iid = String((await mustGet("SELECT id FROM institute LIMIT 1")).id);
  sessionCookie.value = createSessionToken({
    accountId: String(owner.id),
    role: "owner",
    email: "trois4ever+admin@gmail.com",
    accountConfirmed: true,
  } as never);
  const event = await createEvent({
    instituteId: iid,
    title: "Sports day",
    eventDate: "2026-12-01",
    accountId: String(owner.id),
  });
  eventId = String(event.id);
});

describe("KID-2466 event upload purpose", () => {
  it("accepts photos and videos, refuses documents and oversize files", async () => {
    const m = await import("@/lib/media-upload");
    expect(
      m.validateUploadIntent({ purpose: "event", contentType: "image/jpeg", size: 1000 })
    ).toMatchObject({ ok: true, ext: "jpg" });
    expect(
      m.validateUploadIntent({ purpose: "event", contentType: "video/mp4", size: 1000 })
    ).toMatchObject({ ok: true, ext: "mp4" });
    expect(
      m.validateUploadIntent({ purpose: "event", contentType: "application/pdf", size: 1000 })
    ).toEqual({ ok: false, code: "type" });
    expect(
      m.validateUploadIntent({
        purpose: "event",
        contentType: "image/jpeg",
        size: MAX_EVENT_ATTACHMENT_BYTES + 1,
      })
    ).toEqual({ ok: false, code: "size" });
  });

  it("scopes the object key to the events folder and the tenant", async () => {
    const m = await import("@/lib/media-upload");
    const key = m.uploadKeyFor(
      { purpose: "event", contentType: "video/mp4", size: 1000 },
      "inst-1",
      "mp4",
      "uuid-1"
    );
    expect(key).toBe("events/inst-1/uuid-1.mp4");
  });

  it("refuses a REF minted for another purpose", async () => {
    const m = await import("@/lib/media-upload");
    const form = new FormData();
    form.set("fileRef", "r2-private:newsfeed/inst-1/uuid-1.jpg");
    const out = await m.takeUploadedRef(form, {
      purpose: "event",
      instituteId: "inst-1",
      field: "fileRef",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("invalid");
  });
});

describe("KID-2466 addEventMediaAction server boundary", () => {
  it("stores a valid photo attachment", async () => {
    const { addEventMediaAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("eventId", eventId);
    form.set(
      "attachment",
      new File([Buffer.from("jpeg-bytes")], "photo.jpg", { type: "image/jpeg" })
    );
    const target = await redirectTargetOf(() => addEventMediaAction(form));
    expect(target).toContain(`open=${eventId}`);
    expect(await mediaCountFor(eventId)).toBe(1);
    const row = await mustGet("SELECT kind, url FROM media WHERE id = (SELECT media_id FROM media_event WHERE event_id = ?)", eventId);
    expect(String(row.kind)).toBe("image");
    expect(String(row.url)).toMatch(/^(data:image\/jpeg;base64,|kiddy-private:|r2-private:)/);
  });

  it("stores a valid short video attachment", async () => {
    const { addEventMediaAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("eventId", eventId);
    form.set("attachment", new File([mp4(1000, 12_000)], "clip.mp4", { type: "video/mp4" }));
    const target = await redirectTargetOf(() => addEventMediaAction(form));
    expect(target).toContain(`open=${eventId}`);
    expect(await mediaCountFor(eventId)).toBe(1);
    const row = await mustGet("SELECT kind FROM media WHERE id = (SELECT media_id FROM media_event WHERE event_id = ?)", eventId);
    expect(String(row.kind)).toBe("video");
  });

  it("refuses an oversized photo and writes nothing", async () => {
    const { addEventMediaAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("eventId", eventId);
    form.set(
      "attachment",
      new File([Buffer.alloc(MAX_EVENT_ATTACHMENT_BYTES + 1, 1)], "huge.jpg", { type: "image/jpeg" })
    );
    const target = await redirectTargetOf(() => addEventMediaAction(form));
    expect(target).toContain("error=eventMedia");
    expect(await mediaCountFor(eventId)).toBe(0);
  });

  it("refuses a document attachment and writes nothing", async () => {
    const { addEventMediaAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("eventId", eventId);
    form.set("attachment", new File([Buffer.from("%PDF-1.7")], "notes.pdf", { type: "application/pdf" }));
    const target = await redirectTargetOf(() => addEventMediaAction(form));
    expect(target).toContain("error=eventMedia");
    expect(await mediaCountFor(eventId)).toBe(0);
  });

  it("refuses an over-long video and writes nothing", async () => {
    const { addEventMediaAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("eventId", eventId);
    form.set(
      "attachment",
      new File([mp4(1000, (MAX_VIDEO_DURATION_SECONDS + 30) * 1000)], "long.mp4", {
        type: "video/mp4",
      })
    );
    const target = await redirectTargetOf(() => addEventMediaAction(form));
    expect(target).toContain("error=eventMedia");
    expect(await mediaCountFor(eventId)).toBe(0);
  });

  it("refuses a forged direct-upload REF and writes nothing", async () => {
    const { addEventMediaAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("eventId", eventId);
    form.set("attachmentRef", "r2-private:events/other-tenant/uuid-1.jpg");
    const target = await redirectTargetOf(() => addEventMediaAction(form));
    expect(target).toContain("error=eventMedia");
    expect(await mediaCountFor(eventId)).toBe(0);
  });

  it("refuses an event from another tenant or a missing event", async () => {
    const { addEventMediaAction } = await import("@/lib/actions");
    const before = Number((await mustGet("SELECT COUNT(*) c FROM media_event")).c);
    const form = new FormData();
    form.set("eventId", "no-such-event");
    form.set("attachment", new File([Buffer.from("jpeg-bytes")], "photo.jpg", { type: "image/jpeg" }));
    const target = await redirectTargetOf(() => addEventMediaAction(form));
    expect(target).toContain("error=eventMedia");
    expect(Number((await mustGet("SELECT COUNT(*) c FROM media_event")).c)).toBe(before);
  });
});

describe("KID-2466 event pages render signed media only", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("parent page signs event media and the video shelf", () => {
    const src = read("app/child/events/page.tsx");
    expect(src).toContain("signedUrlsForRefs");
    expect(src).not.toMatch(/src=\{m\.url\}/);
    expect(src).not.toMatch(/src=\{v\.url\}/);
    expect(src).not.toMatch(/href=\{m\.url\}/);
    expect(src).not.toMatch(/href=\{v\.url\}/);
    expect(src).toMatch(/mediaSrcs\.get\(String\(m\.url/);
    expect(src).toMatch(/mediaSrcs\.get\(String\(v\.url/);
  });

  it("staff page uploads through MediaUploadForm and signs stored media", () => {
    const src = read("app/portal/events/page.tsx");
    expect(src).toContain("MediaUploadForm");
    expect(src).toContain('purpose: "event"');
    expect(src).toContain("signedUrlsForRefs");
    // The form must be reachable from the page, not only via a hand-built URL.
    expect(src).toContain("/portal/events?open=");
    expect(src).toContain("closeAttach");
    expect(src).not.toContain('name="url"');
    expect(src).not.toMatch(/src=\{m\.url\}/);
    expect(src).toMatch(/mediaSrcs\.get\(String\(m\.url/);
  });
});
