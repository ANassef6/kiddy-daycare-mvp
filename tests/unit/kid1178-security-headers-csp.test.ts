// KID-1178/F-03: baseline security headers + tailored CSP on next.config.
// Pins:
//  - every route (/... path source) gets X-Content-Type-Options, Referrer-Policy,
//    a restrictive Permissions-Policy, X-Frame-Options SAMEORIGIN, and the CSP
//  - rollout default is REPORT-ONLY (Content-Security-Policy-Report-Only); the
//    enforce switch flips the header name to Content-Security-Policy without a
//    code change (KIDDY_CSP_MODE=enforce)
//  - the policy is tailored to this app's actual origins: Supabase
//    (REST/storAGE + realtime WSS), the Chatwoot widget host (script, frame,
//    socket), FCM's push endpoint, plus the frame-ancestors / object-src /
//    base-uri hardening
//  - HSTS is NOT re-declared in the app (the hosting layer already serves it;
//    a duplicate could conflict)

import { describe, expect, it } from "vitest";
import config, { contentSecurityPolicy, securityHeaders } from "../../next.config.mjs";

const HEADER_SOURCE = config.headers ?? null;

describe("KID-1178/F-03 baseline security headers", () => {
  it("covers every route with one rule set", async () => {
    expect(HEADER_SOURCE).toBeTruthy();
    const rules = await HEADER_SOURCE!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
  });

  it("ships every required baseline header on all routes", async () => {
    const rules = await HEADER_SOURCE!();
    const got = Object.fromEntries(
      rules[0].headers.map(
        (h: { key: string; value: string }) => [h.key, h.value]
      )
    );
    expect(got["X-Content-Type-Options"]).toBe("nosniff");
    expect(got["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(got["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(got["Permissions-Policy"]).toContain("camera=()");
    expect(got["Permissions-Policy"]).toContain("microphone=()");
    expect(got["Permissions-Policy"]).toContain("geolocation=()");
    expect(got["Permissions-Policy"]).toContain("interest-cohort=()");
    // CSP rides either the enforcing or the report-only header name.
    const cspName = Object.keys(got).find((k) => k.startsWith("Content-Security-Policy"));
    expect(cspName).toBeTruthy();
  });

  it("defaults to the report-only rollout and can be switched to enforce", () => {
    expect(securityHeaders("report-only").some((h) => h.key === "Content-Security-Policy-Report-Only")).toBe(true);
    expect(securityHeaders("report-only").some((h) => h.key === "Content-Security-Policy")).toBe(false);
    expect(securityHeaders("enforce").some((h) => h.key === "Content-Security-Policy")).toBe(true);
    expect(securityHeaders("enforce").some((h) => h.key === "Content-Security-Policy-Report-Only")).toBe(false);
  });

  it("does not touch HSTS — the hosting layer already serves it and duplicates can conflict", async () => {
    const rules = await HEADER_SOURCE!();
    const keys = rules[0].headers.map((h: { key: string }) => h.key);
    expect(keys.some((k: string) => /^Strict-Transport-Security$/i.test(k))).toBe(false);
  });
});

describe("KID-1178/F-03 the CSP is tailored to this app", () => {
  it("hardens the loading context (frames, objects, base, forms) and reports violations", () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("report-uri /api/csp-report");
  });

  it("allows the inline theme tokens and Next's inline bootstrap scripts only inside style/script", () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    // …but the style exception never leaks to other directives.
    expect(csp.split("img-src")[1] ?? "").not.toContain("'unsafe-inline'");
  });

  it("accounts for the Supabase project when configured (REST, storage, realtime WSS)", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefgh.supabase.co";
    try {
      const csp = contentSecurityPolicy();
      expect(csp).toContain("img-src 'self' data: blob: https://abcdefgh.supabase.co");
      expect(csp).toContain("https://*.supabase.co https://*.supabase.in");
      expect(csp).toContain("wss://abcdefgh.supabase.co");
      expect(csp).toContain("wss://*.supabase.co");
      expect(csp.split("img-src")[1]?.split(";")[0]).not.toContain("wss:");
    } finally {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    }
  });

  it("accounts for the Chatwoot widget host when configured (script, frame, socket)", () => {
    process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL = "https://chat.example.com";
    try {
      const csp = contentSecurityPolicy();
      expect(csp).toContain("script-src 'self' 'unsafe-inline' https://chat.example.com");
      expect(csp).toContain("frame-src 'self' https://chat.example.com");
      expect(csp).toContain("wss://chat.example.com");
      expect(csp).toContain("img-src 'self' data: blob: https://chat.example.com");
    } finally {
      delete process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL;
    }
  });

  it("covers the VAPID/FMC push-service endpoint in connect-src", () => {
    expect(contentSecurityPolicy()).toContain("https://fcm.googleapis.com");
  });

  it("stays quiet about third parties that are not configured", () => {
    expect(contentSecurityPolicy()).not.toContain("supabase");
    expect(contentSecurityPolicy()).not.toContain("chatwoot");
  });
});

describe("the KIDDY_CSP_MODE rollout switch", () => {
  it("switches the shipped header name from report-only to enforce without touching the policy", async () => {
    process.env.KIDDY_CSP_MODE = "enforce";
    try {
      const rules = await HEADER_SOURCE!();
      const got = rules[0].headers as Array<{ key: string; value: string }>;
      expect(got.some((h) => h.key === "Content-Security-Policy")).toBe(true);
      expect(got.some((h) => h.key === "Content-Security-Policy-Report-Only")).toBe(false);
      const enforced = got.find((h) => h.key === "Content-Security-Policy")!;
      const reportOnly = (await securityHeaders("report-only")).find(
        (h) => h.key === "Content-Security-Policy-Report-Only"
      )!;
      expect(enforced.value).toBe(reportOnly.value);
    } finally {
      delete process.env.KIDDY_CSP_MODE;
    }
  });

  it("keeps report-only when the env names the default explicitly or is nonsense", async () => {
    process.env.KIDDY_CSP_MODE = "report-only";
    try {
      const rules = await HEADER_SOURCE!();
      expect(rules[0].headers.some((h: { key: string }) => h.key === "Content-Security-Policy-Report-Only")).toBe(true);
    } finally {
      delete process.env.KIDDY_CSP_MODE;
    }
    process.env.KIDDY_CSP_MODE = "banana";
    try {
      const rules = await HEADER_SOURCE!();
      expect(rules[0].headers.some((h: { key: string }) => h.key === "Content-Security-Policy-Report-Only")).toBe(true);
    } finally {
      delete process.env.KIDDY_CSP_MODE;
    }
  });
});
