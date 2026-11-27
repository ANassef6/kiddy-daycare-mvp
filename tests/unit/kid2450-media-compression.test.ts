// KID-2450: client-side media compression + mirrored server caps.
//
// The browser half is exercised by the shared pure helpers (resize math,
// byte formatting, file validation) and by the MP4/MOV duration parser the
// server uses to reject over-long videos from old clients. The action half
// proves the server boundary refuses an oversized/wrong-type photo, an
// over-long video and an oversized drive file BEFORE any row is written.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { seedFixture, mustGet } from "../helpers";
import {
  MAX_DRIVE_FILE_BYTES,
  MAX_PHOTO_UPLOAD_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  formatBytes,
  mediaKind,
  targetDimensions,
  validateBrandingFile,
  validateMediaAttachment,
  validatePhotoFile,
  MAX_NEWSFEED_ATTACHMENT_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
} from "@/lib/media-limits";
import { mp4DurationSeconds } from "@/lib/video-duration";

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

function mvhd(version: 0 | 1, timescale: number, duration: number): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(version === 0 ? 20 : 32);
  const view = new DataView(body.buffer);
  body[0] = version;
  if (version === 0) {
    view.setUint32(12, timescale);
    view.setUint32(16, duration);
  } else {
    view.setUint32(20, timescale);
    view.setBigUint64(24, BigInt(duration));
  }
  return box("mvhd", body);
}

function mp4(timescale: number, duration: number, version: 0 | 1 = 0): Uint8Array<ArrayBuffer> {
  const ftyp = box("ftyp", new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]));
  const moov = box("moov", mvhd(version, timescale, duration));
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

beforeEach(async () => {
  await seedFixture();
  const owner = await mustGet("SELECT id FROM account WHERE role = 'owner'");
  sessionCookie.value = createSessionToken({
    accountId: String(owner.id),
    role: "owner",
    email: "trois4ever+admin@gmail.com",
    accountConfirmed: true,
  } as never);
});

describe("KID-2450 media limit helpers", () => {
  it("resizes only above the 1280px longest edge, never upscales", () => {
    expect(targetDimensions(4032, 3024)).toEqual({ width: 1280, height: 960 });
    expect(targetDimensions(3024, 4032)).toEqual({ width: 960, height: 1280 });
    expect(targetDimensions(640, 480)).toEqual({ width: 640, height: 480 });
    expect(targetDimensions(0, 0)).toEqual({ width: 1, height: 1 });
  });

  it("formats byte sizes for the localized refusals", () => {
    expect(formatBytes(200 * 1024)).toBe("200 KB");
    expect(formatBytes(4 * 1024 * 1024)).toBe("4 MB");
    expect(formatBytes(2_500_000)).toBe("2.4 MB");
  });

  it("accepts photo formats and enforces the 4 MB boundary", () => {
    expect(validatePhotoFile({ type: "image/jpeg", size: 1024 })).toEqual({
      ok: true,
      ext: "jpg",
      kind: "image",
    });
    expect(validatePhotoFile({ type: "image/heic", size: 1024 }).ok).toBe(true);
    expect(validatePhotoFile({ type: "application/pdf", size: 1024 })).toEqual({
      ok: false,
      code: "type",
    });
    expect(validatePhotoFile({ type: "image/jpeg", size: MAX_PHOTO_UPLOAD_BYTES + 1 })).toEqual({
      ok: false,
      code: "size",
    });
    expect(validatePhotoFile({ type: "image/jpeg", size: 0 })).toEqual({ ok: false, code: "empty" });
  });

  it("lets branding keep SVG but refuses other non-images", () => {
    expect(validateBrandingFile({ type: "image/svg+xml", size: 512 }).ok).toBe(true);
    expect(validateBrandingFile({ type: "image/png", size: 512 }).ok).toBe(true);
    expect(validateBrandingFile({ type: "text/html", size: 512 })).toEqual({
      ok: false,
      code: "type",
    });
  });

  it("classifies and caps attachments/images/videos/PDF", () => {
    expect(mediaKind("video/quicktime")).toBe("video");
    expect(validateMediaAttachment({ type: "image/webp", size: 800 }, MAX_NEWSFEED_ATTACHMENT_BYTES)).toEqual({
      ok: true,
      ext: "webp",
      kind: "image",
    });
    expect(validateMediaAttachment({ type: "video/mp4", size: 800 }, MAX_NEWSFEED_ATTACHMENT_BYTES)).toMatchObject({
      ok: true,
      ext: "mp4",
      kind: "video",
    });
    expect(validateMediaAttachment({ type: "application/pdf", size: 800 }, MAX_NEWSFEED_ATTACHMENT_BYTES)).toMatchObject({
      ok: true,
      kind: "pdf",
    });
    expect(validateMediaAttachment({ type: "application/msword", size: 800 }, MAX_NEWSFEED_ATTACHMENT_BYTES)).toEqual({
      ok: false,
      code: "type",
    });
    expect(
      validateMediaAttachment({ type: "video/mp4", size: MAX_NEWSFEED_ATTACHMENT_BYTES + 1 }, MAX_NEWSFEED_ATTACHMENT_BYTES)
    ).toEqual({ ok: false, code: "size" });
  });
});

describe("KID-2450 MP4/MOV duration parser", () => {
  it("reads version 0 and version 1 mvhd durations", () => {
    expect(mp4DurationSeconds(mp4(1000, 15_000))).toBeCloseTo(15, 5);
    expect(mp4DurationSeconds(mp4(600, 90_000, 1))).toBeCloseTo(150, 5);
  });

  it("returns null for unparseable or invalid files", () => {
    expect(mp4DurationSeconds(box("ftyp", new Uint8Array([1, 2, 3, 4])))).toBeNull();
    expect(mp4DurationSeconds(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(mp4DurationSeconds(mp4(0, 15_000))).toBeNull();
  });
});

describe("KID-2450 server-side upload caps", () => {
  it("refuses a non-image child photo and writes nothing", async () => {
    const child = await mustGet("SELECT id, photo_url FROM child LIMIT 1");
    const before = child.photo_url ?? null;
    const { uploadPhotoAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("entityType", "child");
    form.set("entityId", String(child.id));
    form.set("file", new File([Buffer.from("%PDF-1.7")], "notes.pdf", { type: "application/pdf" }));
    const target = await redirectTargetOf(() => uploadPhotoAction(form));
    expect(target).toContain("error=photoType");
    const after = await queryGet("SELECT photo_url FROM child WHERE id = ?", String(child.id));
    expect(after?.photo_url ?? null).toBe(before);
  });

  it("refuses an oversized child photo and writes nothing", async () => {
    const child = await mustGet("SELECT id, photo_url FROM child LIMIT 1");
    const before = child.photo_url ?? null;
    const { uploadPhotoAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("entityType", "child");
    form.set("entityId", String(child.id));
    form.set(
      "file",
      new File([Buffer.alloc(MAX_PHOTO_UPLOAD_BYTES + 1, 1)], "huge.jpg", { type: "image/jpeg" })
    );
    const target = await redirectTargetOf(() => uploadPhotoAction(form));
    expect(target).toContain("error=photoSize");
    const after = await queryGet("SELECT photo_url FROM child WHERE id = ?", String(child.id));
    expect(after?.photo_url ?? null).toBe(before);
  });

  it("rejects a newsfeed video over the 30 MB cap before creating a post", async () => {
    const before = Number((await mustGet("SELECT COUNT(*) c FROM newsfeed_post")).c);
    const { createNewsfeedWithAttachmentAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("body", "Too big");
    form.set(
      "attachment",
      new File([Buffer.alloc(MAX_VIDEO_UPLOAD_BYTES + 1, 1)], "big.mp4", { type: "video/mp4" })
    );
    const target = await redirectTargetOf(() => createNewsfeedWithAttachmentAction(form));
    expect(target).toContain("error=attachment");
    const after = Number((await mustGet("SELECT COUNT(*) c FROM newsfeed_post")).c);
    expect(after).toBe(before);
  });

  it("rejects an over-long MP4 newsfeed video before creating a post", async () => {
    const before = Number((await mustGet("SELECT COUNT(*) c FROM newsfeed_post")).c);
    const { createNewsfeedWithAttachmentAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("body", "Long clip");
    form.set(
      "attachment",
      new File([mp4(1000, (MAX_VIDEO_DURATION_SECONDS + 30) * 1000)], "long.mp4", { type: "video/mp4" })
    );
    const target = await redirectTargetOf(() => createNewsfeedWithAttachmentAction(form));
    expect(target).toContain("error=attachment");
    const after = Number((await mustGet("SELECT COUNT(*) c FROM newsfeed_post")).c);
    expect(after).toBe(before);
  });

  it("accepts a short MP4 newsfeed video and stores the post", async () => {
    const before = Number((await mustGet("SELECT COUNT(*) c FROM newsfeed_post")).c);
    const { createNewsfeedWithAttachmentAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("body", "Short clip");
    form.set("attachment", new File([mp4(1000, 12_000)], "clip.mp4", { type: "video/mp4" }));
    await redirectTargetOf(() => createNewsfeedWithAttachmentAction(form));
    const after = Number((await mustGet("SELECT COUNT(*) c FROM newsfeed_post")).c);
    expect(after).toBe(before + 1);
  });

  it("refuses an oversized drive file and writes nothing", async () => {
    const before = Number((await mustGet("SELECT COUNT(*) c FROM drive_file")).c);
    const { addDriveFileAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("file", new File([Buffer.alloc(MAX_DRIVE_FILE_BYTES + 1, 1)], "huge.pdf", { type: "application/pdf" }));
    const target = await redirectTargetOf(() => addDriveFileAction(form));
    expect(target).toContain("error=attachment");
    const after = Number((await mustGet("SELECT COUNT(*) c FROM drive_file")).c);
    expect(after).toBe(before);
  });
});
