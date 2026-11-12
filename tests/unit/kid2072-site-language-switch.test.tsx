// KID-2072: the public marketing EN/AR switcher silently did nothing for a
// visitor ("when I click on Arabic on the landing page, it do nothing",
// KID-215). Root causes pinned here:
//   1. the switch was client-JS-only (write kiddy_lang, reload) — broken with
//      JavaScript disabled/blocked and before hydration;
//   2. the server read the FIRST duplicate kiddy_lang value, so a stale
//      same-name cookie shadowed the newest explicit choice.
// The fix: a server /switch-lang endpoint (303 back to a validated
// same-origin path) driving a no-JS GET-form switcher, a dedicated
// kiddy_site_lang cookie read last-duplicate-wins, a per-request ?lang
// override promoted by middleware, and an open-redirect guard on `next`.
//
// Test style follows tests/unit/kid368-def004-ar-i18n.test.tsx: the
// next/headers request scope is mocked per test; middleware and the route
// handler run against real NextRequest objects; assertions are on real
// rendered output / real response headers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";

// --- request-scope mocks (headers + cookies), same shape as kid368 ---------
let mockHeaders: Record<string, string> = {};
let mockCookies: Record<string, string> = {};
vi.mock("next/headers", () => ({
  headers: () => ({
    get: (key: string) => mockHeaders[key.toLowerCase()] ?? null,
  }),
  cookies: () => ({
    get: (name: string) =>
      Object.prototype.hasOwnProperty.call(mockCookies, name)
        ? { name, value: mockCookies[name] }
        : undefined,
  }),
}));

import {
  SITE_LANG_COOKIE,
  lastCookieValue,
  localeFromParam,
  safeNextPath,
} from "@/lib/site-lang";
import { LANG_OVERRIDE_HEADER, PUBLIC_PAGE_HEADER, PUBLIC_PATH_HEADER, middleware } from "@/middleware";
import { resolveSiteLocale } from "@/lib/i18n-session";

beforeEach(() => {
  mockHeaders = {};
  mockCookies = {};
});

afterEach(() => {
  mockHeaders = {};
  mockCookies = {};
});

// --- pure helpers ----------------------------------------------------------
describe("KID-2072: safeNextPath accepts only same-origin absolute paths", () => {
  it("accepts plain paths and preserves path + query", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/contact")).toBe("/contact");
    expect(safeNextPath("/contact?a=1&b=2")).toBe("/contact?a=1&b=2");
    expect(safeNextPath("/features")).toBe("/features");
  });

  it("rejects external, protocol-relative, and scheme URLs (open-redirect guard)", () => {
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
    expect(safeNextPath("mailto:x@y.z")).toBeNull();
    // browsers normalize backslashes to slashes — "\/evil.com" is a host
    expect(safeNextPath("/\\evil.com")).toBeNull();
    expect(safeNextPath("\\/evil.com")).toBeNull();
    // encoded double-slash must not decode back into a protocol-relative URL
    expect(safeNextPath("/%2F%2Fevil.com")).toBeNull();
    // control characters and whitespace would break the Location header
    expect(safeNextPath("/x\r\nSet-Cookie: pwned=1")).toBeNull();
    expect(safeNextPath("/a b")).toBeNull();
    // null/empty/oversized fall back to null (endpoint then uses "/")
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath("contact")).toBeNull(); // must start with "/"
    expect(safeNextPath("a".repeat(2049))).toBeNull();
  });
});

describe("KID-2072: cookie parsing reads the LAST duplicate value", () => {
  it("last kiddy_site_lang wins over a stale shadowed duplicate", () => {
    expect(lastCookieValue("kiddy_site_lang=ar; kiddy_site_lang=en", SITE_LANG_COOKIE)).toBe("en");
    expect(lastCookieValue("kiddy_site_lang=en; kiddy_site_lang=ar", SITE_LANG_COOKIE)).toBe("ar");
    // other cookies must not interfere, unknown name → null
    expect(lastCookieValue("kiddy_lang=ar; kiddy_sess=abc", SITE_LANG_COOKIE)).toBeNull();
    // RFC-quoted values are unwrapped
    expect(lastCookieValue('kiddy_site_lang="ar"', SITE_LANG_COOKIE)).toBe("ar");
    // no header at all
    expect(lastCookieValue(null, SITE_LANG_COOKIE)).toBeNull();
    expect(lastCookieValue("", SITE_LANG_COOKIE)).toBeNull();
  });

  it("localeFromParam accepts exact en/ar tokens only", () => {
    expect(localeFromParam("ar")).toBe("ar");
    expect(localeFromParam(" AR ")).toBe("ar");
    expect(localeFromParam("en")).toBe("en");
    expect(localeFromParam("ar-EG")).toBeNull(); // suffix guessing is off-limits
    expect(localeFromParam("fr")).toBeNull();
    expect(localeFromParam(null)).toBeNull();
    expect(localeFromParam("")).toBeNull();
  });
});

// --- site locale resolution --------------------------------------------------
describe("KID-2072: resolveSiteLocale precedence", () => {
  it("?lang override wins over everything, even without any cookie", async () => {
    mockHeaders = { [LANG_OVERRIDE_HEADER]: "ar" };
    expect(await resolveSiteLocale()).toBe("ar");
  });

  it("override beats a contradicting site cookie", async () => {
    mockHeaders = { [LANG_OVERRIDE_HEADER]: "en", cookie: "kiddy_site_lang=ar" };
    expect(await resolveSiteLocale()).toBe("en");
  });

  it("kiddy_site_lang wins over the app's kiddy_lang — the app cookie can no longer shadow the site choice", async () => {
    mockHeaders = { cookie: "kiddy_site_lang=ar; kiddy_lang=en" };
    expect(await resolveSiteLocale()).toBe("ar");
    mockHeaders = { cookie: "kiddy_site_lang=en; kiddy_lang=ar" };
    expect(await resolveSiteLocale()).toBe("en");
  });

  it("duplicate kiddy_site_lang: the LAST explicit site choice wins", async () => {
    // the shadowing failure mode behind the KID-215 report, now impossible:
    // a stale same-name duplicate cannot keep the old language after a click
    mockHeaders = { cookie: "kiddy_site_lang=en; kiddy_site_lang=ar" };
    expect(await resolveSiteLocale()).toBe("ar");
    mockHeaders = { cookie: "kiddy_site_lang=ar; kiddy_site_lang=en" };
    expect(await resolveSiteLocale()).toBe("en");
  });

  it("falls back to kiddy_lang (also last-wins) when no site cookie exists yet", async () => {
    mockHeaders = { cookie: "kiddy_lang=ar" };
    expect(await resolveSiteLocale()).toBe("ar");
    mockHeaders = { cookie: "kiddy_lang=en; kiddy_lang=ar" };
    expect(await resolveSiteLocale()).toBe("ar");
  });

  it("defaults to English with no scope and no signals", async () => {
    expect(await resolveSiteLocale()).toBe("en");
  });

  it("reads a cookies()-only scope (header-less environments)", async () => {
    mockCookies = { [SITE_LANG_COOKIE]: "ar" };
    expect(await resolveSiteLocale()).toBe("ar");
    mockCookies = { kiddy_lang: "ar" };
    expect(await resolveSiteLocale()).toBe("ar");
  });

  it("invalid cookie values never resolve to a locale", async () => {
    mockHeaders = { cookie: "kiddy_site_lang=ar-EG; kiddy_lang=zz" };
    expect(await resolveSiteLocale()).toBe("en");
  });
});

// --- the no-JS switcher form -------------------------------------------------
describe("KID-2072: the switcher works without client JavaScript", () => {
  it("renders a GET form posting to /switch-lang with the return path preserved", async () => {
    const { default: SiteLangToggle } = await import("@/components/SiteLangToggle");
    const html = renderToStaticMarkup(
      SiteLangToggle({
        current: "en",
        label: "Language",
        labels: { en: "English", ar: "العربية" },
        nextPath: "/contact?a=1",
      })
    );
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/switch-lang"');
    expect(html).toContain('name="next"');
    expect(html).toContain('value="/contact?a=1"');
    // submit buttons carrying the chosen language (no JS handlers anywhere)
    expect(html).toContain('name="lang"');
    expect(html).toContain('value="en"');
    expect(html).toContain('value="ar"');
    expect(html).not.toContain("onClick");
  });

  it("keeps the accessible state: aria-pressed, per-button lang and dir", async () => {
    const { default: SiteLangToggle } = await import("@/components/SiteLangToggle");
    const html = renderToStaticMarkup(
      SiteLangToggle({
        current: "ar",
        label: "Language",
        labels: { en: "English", ar: "العربية" },
        nextPath: "/",
      })
    );
    // aria-pressed marks the ACTIVE side, exactly like the old buttons
    expect(html).toMatch(/value="en"[^>]*aria-pressed="false"/);
    expect(html).toMatch(/value="ar"[^>]*aria-pressed="true"/);
    expect(html).toContain('lang="ar"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="en"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('role="group"');
  });

  it("omits the hidden next field when there is no request scope (endpoint defaults to /)", async () => {
    const { default: SiteLangToggle } = await import("@/components/SiteLangToggle");
    const html = renderToStaticMarkup(
      SiteLangToggle({ current: "en", label: "Language", labels: { en: "English", ar: "العربية" } })
    );
    expect(html).not.toContain('name="next"');
    expect(html).toContain('action="/switch-lang"');
  });

  it("SiteHeader hands the request's current path to the switcher", async () => {
    const { default: SiteHeader } = await import("@/components/SiteHeader");
    const html = renderToStaticMarkup(
      SiteHeader({ active: "/", locale: "en", nextPath: "/?utm=1" })
    );
    expect(html).toContain('name="next"');
    expect(html).toContain('value="/?utm=1"');
    expect(html).toContain('action="/switch-lang"');
  });
});

// --- middleware plumbing -------------------------------------------------------
function publicRequest(url: string): NextRequest {
  return new NextRequest(url);
}

function headerRewrites(res: ReturnType<typeof middleware>): Record<string, string> {
  const out: Record<string, string> = {};
  const names = res.headers.get("x-middleware-override-headers") ?? "";
  for (const name of names.split(",").filter(Boolean)) {
    out[name] = res.headers.get(`x-middleware-request-${name}`) ?? "";
  }
  return out;
}

describe("KID-2072: middleware promotes ?lang and carries the switcher's return path", () => {
  it("?lang=ar becomes the override header, best-effort cookies, and the return path strips ?lang", () => {
    const res = middleware(publicRequest("http://kiddy.test/contact?lang=ar&utm=1"));
    const rewrites = headerRewrites(res);
    expect(rewrites[PUBLIC_PAGE_HEADER]).toBe("1");
    expect(rewrites[LANG_OVERRIDE_HEADER]).toBe("ar");
    // ?lang is stripped from the return path so a pinned query cannot fight a
    // later switch on cookie-less browsers; other query params survive
    expect(rewrites[PUBLIC_PATH_HEADER]).toBe("/contact?utm=1");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("kiddy_site_lang=ar");
    expect(setCookie).toContain("kiddy_lang=ar");
  });

  it("no ?lang: no override, no cookie writes, the return path keeps the query", () => {
    const res = middleware(publicRequest("http://kiddy.test/features?utm=1"));
    const rewrites = headerRewrites(res);
    expect(rewrites[PUBLIC_PAGE_HEADER]).toBe("1");
    expect(rewrites[PUBLIC_PATH_HEADER]).toBe("/features?utm=1");
    expect(rewrites[LANG_OVERRIDE_HEADER]).toBeUndefined();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("invalid ?lang values are ignored (no override, no cookies)", () => {
    const res = middleware(publicRequest("http://kiddy.test/?lang=fr"));
    const rewrites = headerRewrites(res);
    expect(rewrites[LANG_OVERRIDE_HEADER]).toBeUndefined();
    expect(res.headers.get("set-cookie")).toBeNull();
    // the junk param is still stripped from the return path
    expect(rewrites[PUBLIC_PATH_HEADER]).toBe("/");
  });
});

// --- the server switch endpoint ----------------------------------------------
describe("KID-2072: GET /switch-lang handles the switch on the server", () => {
  async function call(url: string) {
    const { GET } = await import("@/app/switch-lang/route");
    return GET(new NextRequest(url));
  }

  it("sets both language cookies and redirects (303) back to the preserved path + query", async () => {
    const res = await call("http://kiddy.test/switch-lang?lang=ar&next=%2Fcontact%3Fa%3D1%26b%3D2");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/contact?a=1&b=2");
    const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
    const all = setCookie.join(" | ");
    expect(all).toContain("kiddy_site_lang=ar");
    expect(all).toContain("kiddy_lang=ar");
    expect(all).toContain("Path=/");
    expect(all).toContain("SameSite=lax");
  });

  it("switches back to English the same way", async () => {
    const res = await call("http://kiddy.test/switch-lang?lang=en&next=%2Ffeatures");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/features");
    expect(res.headers.get("set-cookie")).toContain("kiddy_site_lang=en");
  });

  it("open-redirect guard: external, protocol-relative, and scheme targets fall back to /", async () => {
    for (const next of [
      "https://evil.com",
      "//evil.com",
      "javascript:alert(1)",
      "/\\evil.com",
      "http://evil.com/path",
    ]) {
      const res = await call(
        `http://kiddy.test/switch-lang?lang=ar&next=${encodeURIComponent(next)}`
      );
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/");
    }
  });

  it("missing or invalid lang bounces back without touching any cookie", async () => {
    for (const url of [
      "http://kiddy.test/switch-lang?next=%2Fcontact",
      "http://kiddy.test/switch-lang?lang=fr&next=%2Fcontact",
    ]) {
      const res = await call(url);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/contact");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    const res = await call("http://kiddy.test/switch-lang");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("no next at all: safe default back to /", async () => {
    const res = await call("http://kiddy.test/switch-lang?lang=ar");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toContain("kiddy_site_lang=ar");
  });
});
