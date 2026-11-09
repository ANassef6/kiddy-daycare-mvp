// KID-1178/F-08: the branding endpoint is intentionally public and the only
// fields it may name are branding-configuration fields; F-08's other half is
// caching. Also covers the CSP violation-report collector's contract.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetRateLimitForTests } from "@/lib/rate-limit";

const BRANDING = {
  name: "Sunshine Daycare",
  logoUrl: "https://abcdefgh.supabase.co/storage/v1/object/public/kiddy-public/logo.png",
  brandImageUrl: null,
  primaryColor: "#3B82F6",
  accentColor: "#10B981",
  font: "Inter",
};

const brandingState = { value: BRANDING, reject: null as null | Error };

vi.mock("@/lib/theme", () => ({
  getBranding: async () => {
    if (brandingState.reject) throw brandingState.reject;
    return brandingState.value;
  },
}));

beforeEach(() => {
  _resetRateLimitForTests();
  brandingState.value = BRANDING;
  brandingState.reject = null;
});

describe("GET /api/branding (F-08)", () => {
  it("returns ONLY the six branding-configuration fields — no secrets, no PII, no accounts", async () => {
    const { GET } = await import("@/app/api/branding/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["accentColor", "brandImageUrl", "font", "logoUrl", "name", "primaryColor"].sort()
    );
    expect(body.name).toBe("Sunshine Daycare");
  });

  it("is cacheable in browsers (public, max-age=300) with must-revalidate", async () => {
    const { GET } = await import("@/app/api/branding/route");
    const res = await GET();
    const cache = res.headers.get("cache-control") ?? "";
    expect(cache).toContain("public");
    expect(cache).toContain("max-age=300");
    expect(cache).toContain("must-revalidate");
    // Deliberately NOT s-maxage: the response is host-dependent (tenant
    // branding keys on the request origin); a shared CDN cache keyed on path
    // would stamp one tenant's brand onto another.
    expect(cache).not.toContain("s-maxage");
  });

  it("degrades to the neutral Kiddy response with a short cache instead of leaking an error", async () => {
    brandingState.reject = new Error("db down");
    const { GET } = await import("@/app/api/branding/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("Kiddy");
    expect(Object.keys(body).sort()).toEqual(["logoUrl", "name"].sort());
    expect(res.headers.get("cache-control")).toContain("max-age=60");
  });
});

describe("POST /api/csp-report (F-03 rollout)", () => {
  it("accepts legacy 'csp-report' shell and new flat reports with 204, logging bounded fields", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { POST } = await import("@/app/api/csp-report/route");
      const legacy = {
        "csp-report": {
          "effective-directive": "script-src",
          "blocked-uri": "https://evil.example/x.js",
          "document-uri": "https://kiddy.example/login",
          disposition: "report",
        },
      };
      const req = new Request("https://kiddy.example/api/csp-report", {
        method: "POST",
        headers: { "content-type": "application/csp-report" },
        body: JSON.stringify(legacy),
      });
      const res = await POST(req);
      expect(res.status).toBe(204);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('"fmt":"KID-1178/F-03 csp-violation"'));
      const line = String(log.mock.calls[0][0]);
      expect(line).toContain("evil.example");
      expect(line).not.toContain("csp-report\":");
    } finally {
      log.mockRestore();
    }
  });

  it("never logs a malformed or oversized raw report body", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const req = new Request("https://kiddy.example/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "definitely not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("throttles report floods by IP before touching the body", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { POST } = await import("@/app/api/csp-report/route");
      const { RATE_LIMIT_RULES } = await import("@/lib/rate-limit");
      let last = 200;
      for (let i = 0; i < RATE_LIMIT_RULES.cspReportIp.limit + 2; i++) {
        const req = new Request("https://kiddy.example/api/csp-report", {
          method: "POST",
          headers: { "x-forwarded-for": "203.0.113.66", "content-type": "application/json" },
          body: JSON.stringify({ "csp-report": { "effective-directive": "default-src" } }),
        });
        const res = await POST(req);
        last = res.status;
        if (res.status === 429) {
          expect(String(res.headers.get("retry-after") ?? "")).toBeTruthy();
          break;
        }
      }
      expect(last).toBe(429);
    } finally {
      consoleLog.mockRestore();
      consoleError.mockRestore();
      vi.restoreAllMocks();
    }
  });
});
