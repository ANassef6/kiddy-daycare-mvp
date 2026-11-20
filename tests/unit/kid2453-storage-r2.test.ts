// KID-2453: R2 provider, REF compatibility and the presigned-upload boundary.
//
// These are unit-level pins on the contract the app relies on:
//   * the REF format never silently changes for existing rows;
//   * a configured R2 becomes the write provider without breaking legacy
//     "kiddy-private:" reads;
//   * the direct-upload ticket is capped exactly like the multipart path;
//   * a forged/oversized direct upload is refused before it becomes a row.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const R2_ENV = {
  R2_ACCOUNT_ID: "acct-unittest",
  R2_ACCESS_KEY_ID: "key-unittest",
  R2_SECRET_ACCESS_KEY: "secret-unittest-placeholder",
  R2_BUCKET: "kiddy-media-unittest",
};

function clearR2() {
  for (const key of Object.keys(R2_ENV)) delete process.env[key];
  delete process.env.R2_ENDPOINT;
}

function setR2() {
  for (const [key, value] of Object.entries(R2_ENV)) process.env[key] = value;
}

describe("KID-2453: storage provider and REF compatibility", () => {
  beforeEach(() => {
    vi.resetModules();
    clearR2();
  });
  afterEach(() => {
    clearR2();
    vi.unstubAllGlobals();
  });

  it("keeps the legacy Supabase REF when R2 is not configured", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://storage-unittest.example";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-key-unittest-placeholder";
    const s = await import("../../lib/storage");
    expect(s.r2Configured()).toBe(false);
    expect(s.storageProvider()).toBe("supabase");
    expect(s.privateRef("child/c-1/photo.png")).toBe("kiddy-private:child/c-1/photo.png");
    expect(s.isPrivateRef("kiddy-private:child/c-1/photo.png")).toBe(true);
    expect(s.isPrivateRef("r2-private:child/c-1/photo.png")).toBe(true);
    expect(s.isPrivateRef("https://example.com/a.png")).toBe(false);
    expect(s.privateRefPath("r2-private:a/b.png")).toBe("a/b.png");
    expect(s.privateRefPath("kiddy-private:a/b.png")).toBe("a/b.png");
  });

  it("switches new writes to R2 when configured, without abandoning legacy refs", async () => {
    setR2();
    const s = await import("../../lib/storage");
    expect(s.r2Configured()).toBe(true);
    expect(s.storageProvider()).toBe("r2");
    expect(s.privateRef("child/c-2/photo.webp")).toBe("r2-private:child/c-2/photo.webp");
    // Legacy rows stay readable/resolvable by the same helpers.
    expect(s.isPrivateRef("kiddy-private:child/c-1/photo.png")).toBe(true);
    expect(s.privateRefPath("kiddy-private:child/c-1/photo.png")).toBe("child/c-1/photo.png");
  });

  it("mints a short-lived signed R2 GET without exposing the raw key", async () => {
    setR2();
    const s = await import("../../lib/storage");
    const url = await s.signedUrlForRef("r2-private:child/c-3/photo.webp", 600);
    expect(url).toBeTruthy();
    expect(String(url)).toContain("kiddy-media-unittest");
    expect(String(url)).toContain("child/c-3/photo.webp");
    expect(String(url)).toContain("X-Amz-Signature=");
    expect(String(url)).toContain("X-Amz-Expires=600");
    expect(String(url)).not.toContain("r2-private:");
  });

  it("uploads through R2 and returns the r2 REF (PUT is signed, not public)", async () => {
    setR2();
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const s = await import("../../lib/storage");
    const result = await s.uploadPrivateObject("photos/i-1/child/c-1/photo.png", Buffer.from("abc"), "image/png");
    expect(result.error).toBeNull();
    expect(result.ref).toBe("r2-private:photos/i-1/child/c-1/photo.png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("kiddy-media-unittest/photos/i-1/child/c-1/photo.png");
    expect(init.method).toBe("PUT");
    expect((init.headers as Headers).get("authorization")).toContain("AWS4-HMAC-SHA256");
  });
});

describe("KID-2453: presigned upload tickets enforce the same caps", () => {
  beforeEach(() => {
    vi.resetModules();
    setR2();
  });
  afterEach(() => {
    clearR2();
    vi.unstubAllGlobals();
  });

  it("issues a scoped ticket for an allowed photo", async () => {
    const m = await import("../../lib/media-upload");
    const ticket = await m.presignMediaUpload(
      {
        purpose: "photo",
        entityType: "child",
        entityId: "child-9",
        contentType: "image/jpeg",
        size: 200_000,
      },
      "inst-1"
    );
    expect(ticket.ok).toBe(true);
    if (!ticket.ok) return;
    expect(ticket.ref.startsWith("r2-private:photos/inst-1/child/child-9/")).toBe(true);
    expect(ticket.url).toContain("X-Amz-Signature=");
    expect(ticket.headers["Content-Type"]).toBe("image/jpeg");
  });

  it("refuses oversize and wrong-type tickets before signing anything", async () => {
    const m = await import("../../lib/media-upload");
    const oversize = await m.presignMediaUpload(
      { purpose: "photo", entityType: "child", entityId: "c", contentType: "image/jpeg", size: 9_000_000 },
      "inst-1"
    );
    expect(oversize.ok).toBe(false);
    if (!oversize.ok) expect(oversize.code).toBe("size");

    const wrongType = await m.presignMediaUpload(
      { purpose: "proof", entityId: "b-1", contentType: "image/svg+xml", size: 1000 },
      "inst-1"
    );
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) expect(wrongType.code).toBe("type");
  });

  it("refuses a REF outside the caller's tenant/purpose folder", async () => {
    const m = await import("../../lib/media-upload");
    const form = new FormData();
    form.set("fileRef", "r2-private:photos/other-tenant/child/c-1/photo.png");
    const out = await m.takeUploadedRef(form, { purpose: "photo", instituteId: "inst-1" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("invalid");
  });

  it("HEAD-verifies size/type and returns the REF when valid", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "content-length": "1024", "content-type": "image/webp" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const m = await import("../../lib/media-upload");
    const form = new FormData();
    form.set("fileRef", "r2-private:photos/inst-1/child/c-1/photo.webp");
    const out = await m.takeUploadedRef(form, { purpose: "photo", instituteId: "inst-1" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.ref).toBe("r2-private:photos/inst-1/child/c-1/photo.webp");
      expect(out.size).toBe(1024);
    }
  });

  it("deletes and refuses an oversize object found by HEAD", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, { status: 200, headers: { "content-length": "9999999" } });
      }
      if (init?.method === "DELETE") return new Response("", { status: 204 });
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const m = await import("../../lib/media-upload");
    const form = new FormData();
    form.set("fileRef", "r2-private:photos/inst-1/child/c-1/photo.png");
    const out = await m.takeUploadedRef(form, { purpose: "photo", instituteId: "inst-1" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("size");
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(true);
  });
});
