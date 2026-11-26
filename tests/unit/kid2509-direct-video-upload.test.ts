// KID-2509: direct-to-R2 videos on the newsfeed and event attachments.
//
// Pins the approved 15 MB / 5-minute cap and the record-after-success flow:
//   * constants stay the single source of truth for client and server;
//   * a 15 MB video gets a presigned ticket while a photo on the same purpose
//     keeps its old ceiling;
//   * HEAD verification accepts a 15 MB video and deletes anything larger;
//   * the newsfeed action writes the post only after the REF verifies, and a
//     failed REF never becomes a post without its attachment;
//   * message video stays at the old 60-second limit.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSessionToken } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { seedFixture, mustGet } from "../helpers";
import {
  MAX_MESSAGE_VIDEO_DURATION_SECONDS,
  MAX_NEWSFEED_ATTACHMENT_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_UPLOAD_BYTES,
} from "@/lib/media-limits";
import { prepareMediaFormData } from "@/lib/media-prepare-client";

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

const R2_ENV = {
  R2_ACCOUNT_ID: "acct-kid2509",
  R2_ACCESS_KEY_ID: "key-kid2509",
  R2_SECRET_ACCESS_KEY: "secret-kid2509-placeholder",
  R2_BUCKET: "kiddy-media-kid2509",
};

function setR2() {
  for (const [key, value] of Object.entries(R2_ENV)) process.env[key] = value;
}

function clearR2() {
  for (const key of Object.keys(R2_ENV)) delete process.env[key];
  delete process.env.R2_ENDPOINT;
}

function headResponse(size: number, contentType: string) {
  return new Response(null, {
    status: 200,
    headers: { "content-length": String(size), "content-type": contentType },
  });
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
  vi.resetModules();
  clearR2();
  setR2();
  await seedFixture();
  const owner = await mustGet("SELECT id FROM account WHERE role = 'owner'");
  sessionCookie.value = createSessionToken({
    accountId: String(owner.id),
    role: "owner",
    email: "trois4ever+admin@gmail.com",
    accountConfirmed: true,
  } as never);
});

afterEach(() => {
  clearR2();
  vi.unstubAllGlobals();
});

describe("KID-2509 video limits", () => {
  it("uses 15 MB and 300 seconds as the shared video constants", () => {
    expect(MAX_VIDEO_UPLOAD_BYTES).toBe(15 * 1024 * 1024);
    expect(MAX_VIDEO_DURATION_SECONDS).toBe(300);
    // Messages deliberately keep their old cap.
    expect(MAX_MESSAGE_VIDEO_DURATION_SECONDS).toBe(60);
    // Photos on the newsfeed keep their old ceiling.
    expect(MAX_NEWSFEED_ATTACHMENT_BYTES).toBe(2_500_000);
  });

  it("issues a ticket for a 15 MB newsfeed video but refuses 15 MB + 1", async () => {
    const m = await import("@/lib/media-upload");
    const max = await m.presignMediaUpload(
      { purpose: "newsfeed", contentType: "video/mp4", size: MAX_VIDEO_UPLOAD_BYTES },
      "inst-1"
    );
    expect(max.ok).toBe(true);
    if (max.ok) expect(max.maxBytes).toBe(MAX_VIDEO_UPLOAD_BYTES);

    const over = await m.presignMediaUpload(
      { purpose: "newsfeed", contentType: "video/mp4", size: MAX_VIDEO_UPLOAD_BYTES + 1 },
      "inst-1"
    );
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe("size");
  });

  it("keeps the old photo ceiling on the same purpose", async () => {
    const m = await import("@/lib/media-upload");
    expect(
      m.validateUploadIntent({
        purpose: "newsfeed",
        contentType: "image/jpeg",
        size: MAX_NEWSFEED_ATTACHMENT_BYTES + 1,
      })
    ).toEqual({ ok: false, code: "size" });
    expect(
      m.validateUploadIntent({
        purpose: "event",
        contentType: "video/mp4",
        size: MAX_VIDEO_UPLOAD_BYTES,
      })
    ).toMatchObject({ ok: true, ext: "mp4" });
  });

  it("refuses a video over 15 MB on the client before any upload", async () => {
    const form = new FormData();
    form.set(
      "attachment",
      new File([new Uint8Array(MAX_VIDEO_UPLOAD_BYTES + 1)], "big.webm", {
        type: "video/webm",
      })
    );
    const out = await prepareMediaFormData(form, {
      maxImageBytes: MAX_NEWSFEED_ATTACHMENT_BYTES,
      maxVideoBytes: MAX_VIDEO_UPLOAD_BYTES,
      maxVideoSeconds: MAX_VIDEO_DURATION_SECONDS,
      labels: {
        preparing: "Preparing…",
        optimizing: "Optimizing…",
        prepared: "Prepared",
        imageTooLarge: "Photo larger than {limit}.",
        videoTooLarge: "Video larger than {limit}.",
        videoTooLong: "Video is {seconds}s; limit {limit}s.",
        fileTooLarge: "File larger than {limit}.",
        compressFailed: "Could not prepare.",
        uploading: "Uploading… {percent}%",
      },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("15 MB");
  });

  it("HEAD-verifies a 15 MB video and deletes a larger object", async () => {
    const allowed = vi.fn(async () => headResponse(MAX_VIDEO_UPLOAD_BYTES, "video/mp4"));
    vi.stubGlobal("fetch", allowed);
    const m = await import("@/lib/media-upload");
    const okForm = new FormData();
    okForm.set("fileRef", "r2-private:newsfeed/inst-1/uuid-ok.mp4");
    const ok = await m.takeUploadedRef(okForm, {
      purpose: "newsfeed",
      instituteId: "inst-1",
      field: "fileRef",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.size).toBe(MAX_VIDEO_UPLOAD_BYTES);

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return headResponse(MAX_VIDEO_UPLOAD_BYTES + 1, "video/mp4");
      }
      if (init?.method === "DELETE") return new Response("", { status: 204 });
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const badForm = new FormData();
    badForm.set("fileRef", "r2-private:newsfeed/inst-1/uuid-bad.mp4");
    const bad = await m.takeUploadedRef(badForm, {
      purpose: "newsfeed",
      instituteId: "inst-1",
      field: "fileRef",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("size");
    expect(
      fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "DELETE")
    ).toBe(true);
  });
});

describe("KID-2509 presign issuance auth", () => {
  it("refuses a video ticket without a session", async () => {
    const { POST } = await import("@/app/api/media/presign/route");
    const res = await POST(
      new NextRequest("https://staging.kiddyapp.net/api/media/presign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "newsfeed", contentType: "video/mp4", size: 1024 }),
      })
    );
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("unauthorized");
  });

  it("issues a scoped 15 MB newsfeed video ticket for the signed-in tenant", async () => {
    const { POST } = await import("@/app/api/media/presign/route");
    const res = await POST(
      new NextRequest("https://staging.kiddyapp.net/api/media/presign", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `kiddy_sess=${sessionCookie.value}`,
        },
        body: JSON.stringify({
          purpose: "newsfeed",
          contentType: "video/mp4",
          size: MAX_VIDEO_UPLOAD_BYTES,
        }),
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ref: string;
      uploadUrl: string;
      maxBytes: number;
      headers: Record<string, string>;
    };
    expect(json.ref.startsWith("r2-private:newsfeed/")).toBe(true);
    expect(json.uploadUrl).toContain("X-Amz-Signature=");
    expect(json.maxBytes).toBe(MAX_VIDEO_UPLOAD_BYTES);
    expect(json.headers["Content-Type"]).toBe("video/mp4");
  });
});

describe("KID-2509 record-after-success", () => {
  it("creates the newsfeed post only after a verified video REF", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => headResponse(10 * 1024 * 1024, "video/mp4")));
    const iid = String((await mustGet("SELECT id FROM institute LIMIT 1")).id);
    const before = Number((await mustGet("SELECT COUNT(*) c FROM newsfeed_post")).c);
    const { createNewsfeedWithAttachmentAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("body", "Sports day clip");
    form.set("attachmentRef", `r2-private:newsfeed/${iid}/uuid-clip.mp4`);
    await redirectTargetOf(() => createNewsfeedWithAttachmentAction(form));
    const after = Number((await mustGet("SELECT COUNT(*) c FROM newsfeed_post")).c);
    expect(after).toBe(before + 1);
    const row = await queryGet(
      "SELECT COUNT(*) c FROM newsfeed_post WHERE media_url = ?",
      `r2-private:newsfeed/${iid}/uuid-clip.mp4`
    );
    expect(Number(row?.c ?? 0)).toBe(1);
  });

  it("refuses an unverifiable REF and writes no post", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    const before = Number((await mustGet("SELECT COUNT(*) c FROM newsfeed_post")).c);
    const { createNewsfeedWithAttachmentAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("body", "Missing clip");
    form.set("attachmentRef", "r2-private:newsfeed/inst-1/uuid-missing.mp4");
    const target = await redirectTargetOf(() => createNewsfeedWithAttachmentAction(form));
    expect(target).toContain("error=attachment");
    const after = Number((await mustGet("SELECT COUNT(*) c FROM newsfeed_post")).c);
    expect(after).toBe(before);
  });
});
