// KID-2467: the drive is a documents-only area.
//
// Pins the server boundary (the presign ticket and the multipart fallback),
// the file/pf classification kept from before, and the EN/AR copy. The UI
// pin reads the portal page source because a full render needs a live
// request scope; the behavioral guarantees live in the action/presign tests.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "@/lib/auth";
import { queryRun } from "@/lib/db";
import { driveFilesFor } from "@/lib/store";
import { mustGet, seedFixture } from "../helpers";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_MIME_EXT,
  MAX_DRIVE_FILE_BYTES,
  isDocumentMime,
} from "@/lib/media-limits";
import { ar, en } from "@/lib/i18n";

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

async function driveCount(): Promise<number> {
  return Number((await mustGet("SELECT COUNT(*) c FROM drive_file")).c);
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

describe("KID-2467: drive document whitelist", () => {
  it("rejects photo, video and image intents", async () => {
    const m = await import("@/lib/media-upload");
    for (const contentType of ["image/jpeg", "image/png", "video/mp4", "video/quicktime", "application/octet-stream"]) {
      const out = m.validateUploadIntent({ purpose: "drive", contentType, size: 1024 });
      expect(out, contentType).toEqual({ ok: false, code: "type" });
    }
  });

  it("accepts documents and keeps the extension mapping", async () => {
    const m = await import("@/lib/media-upload");
    const cases: Array<[string, string]> = [
      ["application/pdf", "pdf"],
      ["application/msword", "doc"],
      ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
      ["application/vnd.ms-excel", "xls"],
      ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
      ["application/vnd.ms-powerpoint", "ppt"],
      ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
      ["text/plain", "txt"],
      ["text/csv", "csv"],
    ];
    for (const [contentType, ext] of cases) {
      expect(m.validateUploadIntent({ purpose: "drive", contentType, size: 1024 }), contentType).toEqual({
        ok: true,
        ext,
      });
    }
    for (const mime of Object.keys(DOCUMENT_MIME_EXT)) expect(isDocumentMime(mime)).toBe(true);
    expect(DOCUMENT_ACCEPT).toContain(".pdf");
    expect(DOCUMENT_ACCEPT).toContain(".docx");
    expect(DOCUMENT_ACCEPT).not.toContain("image");
  });

  it("refuses a presigned drive ticket for a photo before signing", async () => {
    const m = await import("@/lib/media-upload");
    const ticket = await m.presignMediaUpload(
      { purpose: "drive", contentType: "image/jpeg", size: 200_000 },
      "inst-1"
    );
    expect(ticket.ok).toBe(false);
    if (!ticket.ok) expect(ticket.code).toBe("type");
  });

  it("refuses a multipart photo upload and writes nothing", async () => {
    const before = await driveCount();
    const { addDriveFileAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("file", new File([Buffer.alloc(2048, 1)], "class-photo.jpg", { type: "image/jpeg" }));
    form.set("kind", "photo");
    const target = await redirectTargetOf(() => addDriveFileAction(form));
    expect(target).toContain("error=document");
    expect(await driveCount()).toBe(before);
  });

  it("refuses a multipart video upload and writes nothing", async () => {
    const before = await driveCount();
    const { addDriveFileAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("file", new File([Buffer.alloc(2048, 1)], "clip.mp4", { type: "video/mp4" }));
    form.set("kind", "video");
    const target = await redirectTargetOf(() => addDriveFileAction(form));
    expect(target).toContain("error=document");
    expect(await driveCount()).toBe(before);
  });

  it("still stores and shares a PDF with the pdf kind", async () => {
    const before = await driveCount();
    const child = await mustGet("SELECT id, institute_id FROM child LIMIT 1");
    const { addDriveFileAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("filename", "Handbook.pdf");
    form.set("file", new File([Buffer.from("%PDF-1.4 test")], "Handbook.pdf", { type: "application/pdf" }));
    form.set("kind", "file");
    form.set("childId", String(child.id));
    await redirectTargetOf(() => addDriveFileAction(form));
    expect(await driveCount()).toBe(before + 1);
    const row = await mustGet("SELECT filename, kind, child_id FROM drive_file ORDER BY id DESC LIMIT 1");
    expect(String(row.filename)).toBe("Handbook.pdf");
    expect(String(row.kind)).toBe("pdf");
    expect(String(row.child_id)).toBe(String(child.id));
    const shared = await driveFilesFor(String(child.institute_id), String(child.id));
    expect(shared.some((f) => String(f.filename) === "Handbook.pdf")).toBe(true);
  });

  it("keeps photo rows shared before the change visible to the parent", async () => {
    const child = await mustGet("SELECT id, institute_id FROM child LIMIT 1");
    await queryRun(
      `INSERT INTO drive_file (id, institute_id, filename, url, kind, size_bytes, child_id)
       VALUES ('legacy-photo', ?, 'Beach day.jpg', 'data:image/jpeg;base64,AA==', 'photo', 1, ?)`,
      String(child.institute_id),
      String(child.id)
    );
    const shared = await driveFilesFor(String(child.institute_id), String(child.id));
    const legacy = shared.find((f) => String(f.id) === "legacy-photo");
    expect(legacy).toBeTruthy();
    expect(String(legacy?.kind)).toBe("photo");
  });

  it("still stores a Word document with the file kind", async () => {
    const before = await driveCount();
    const { addDriveFileAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("filename", "Form.docx");
    form.set(
      "file",
      new File([Buffer.from("docx bytes")], "Form.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
    );
    form.set("kind", "file");
    await redirectTargetOf(() => addDriveFileAction(form));
    expect(await driveCount()).toBe(before + 1);
    const row = await mustGet("SELECT kind FROM drive_file ORDER BY id DESC LIMIT 1");
    expect(String(row.kind)).toBe("file");
  });

  it("refuses an oversized document with the existing attachment error", async () => {
    const before = await driveCount();
    const { addDriveFileAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("file", new File([Buffer.alloc(MAX_DRIVE_FILE_BYTES + 1, 1)], "huge.pdf", { type: "application/pdf" }));
    const target = await redirectTargetOf(() => addDriveFileAction(form));
    expect(target).toContain("error=attachment");
    expect(await driveCount()).toBe(before);
  });

  it("offers only document choices in the portal upload form", () => {
    const page = readFileSync(resolve(process.cwd(), "app/portal/drive/page.tsx"), "utf8");
    expect(page).toContain("accept={DOCUMENT_ACCEPT}");
    expect(page).toContain('name="kind"');
    expect(page).toContain('value="file"');
    expect(page).toContain('value="pdf"');
    expect(page).not.toContain('value="photo"');
    expect(page).not.toContain('value="video"');
  });

  it("has EN and AR documents-only copy", () => {
    expect(en.drive.errorDocumentOnly).toMatch(/only documents/i);
    expect(ar.drive.errorDocumentOnly).toContain("المستندات فقط");
    expect(en.driveAdmin.documentsOnly).toMatch(/documents only/i);
    expect(ar.driveAdmin.documentsOnly).toContain("المستندات فقط");
    expect(existsSync(resolve(process.cwd(), "app/child/drive/page.tsx"))).toBe(true);
  });
});
