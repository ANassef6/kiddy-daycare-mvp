// KID-2406: navigation-latency contract pins.
//
// The public marketing pages are server-rendered (locale + host branding come
// from the request), so the win comes from making those renders cacheable at
// the CDN and from keeping DB work off the render path:
//   1. no root-level force-dynamic and no bootstrap call in the root layout
//      (it moved to the authenticated layouts);
//   2. the marketing HTML carries a public s-maxage Cache-Control, and the
//      Arabic variant lives at a distinct ?lang=ar URL so the CDN key cannot
//      mix languages;
//   3. a stored Arabic preference normalizes the clean URL to ?lang=ar;
//   4. internal marketing links keep the language without a redirect;
//   5. the function region ships from the repo (fra1);
//   6. the Chatwoot SDK is deferred (lazyOnload) and no longer loads at
//      render/interactive time.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import {
  EDGE_CACHE_CONTROL,
  LANG_OVERRIDE_HEADER,
  MARKETING_CACHE_CONTROL,
  PUBLIC_PAGE_HEADER,
  PUBLIC_PATH_HEADER,
  middleware,
} from "@/middleware";
import { withLang } from "@/lib/site-lang";

function request(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init);
}

function rewrittenHeaders(res: ReturnType<typeof middleware>): Record<string, string> {
  const out: Record<string, string> = {};
  const names = res.headers.get("x-middleware-override-headers") ?? "";
  for (const name of names.split(",").filter(Boolean)) {
    out[name] = res.headers.get(`x-middleware-request-${name}`) ?? "";
  }
  return out;
}

describe("KID-2406: withLang keeps internal links on the cacheable Arabic URL", () => {
  it("leaves English and non-marketing links untouched", () => {
    expect(withLang("/", "en")).toBe("/");
    expect(withLang("/features", "en")).toBe("/features");
    expect(withLang("https://example.com/features", "ar")).toBe("https://example.com/features");
    expect(withLang("//evil.example/features", "ar")).toBe("//evil.example/features");
  });

  it("adds ?lang=ar and preserves existing query + hash", () => {
    expect(withLang("/", "ar")).toBe("/?lang=ar");
    expect(withLang("/contact?a=1", "ar")).toBe("/contact?a=1&lang=ar");
    expect(withLang("/auth/confirm#token", "ar")).toBe("/auth/confirm?lang=ar#token");
  });
});

describe("KID-2406: marketing HTML is CDN-cacheable", () => {
  it("marks the clean English URL public with a short edge TTL", () => {
    const res = middleware(request("http://kiddy.test/features"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(MARKETING_CACHE_CONTROL);
    // Next overwrites Cache-Control for a dynamic render; the CDN-specific
    // headers are what Vercel (and Cloudflare) actually honour.
    expect(res.headers.get("cdn-cache-control")).toBe(EDGE_CACHE_CONTROL);
    expect(res.headers.get("vercel-cdn-cache-control")).toBe(EDGE_CACHE_CONTROL);
    expect(res.headers.get("set-cookie")).toBeNull();
    const rewrites = rewrittenHeaders(res);
    expect(rewrites[PUBLIC_PAGE_HEADER]).toBe("1");
    expect(rewrites[PUBLIC_PATH_HEADER]).toBe("/features");
    expect(rewrites[LANG_OVERRIDE_HEADER]).toBeUndefined();
  });

  it("keeps the Arabic variant cacheable once the cookie already matches", () => {
    const res = middleware(
      request("http://kiddy.test/contact?lang=ar&sent=1", {
        headers: { cookie: "kiddy_site_lang=ar" },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(MARKETING_CACHE_CONTROL);
    expect(res.headers.get("cdn-cache-control")).toBe(EDGE_CACHE_CONTROL);
    expect(res.headers.get("vercel-cdn-cache-control")).toBe(EDGE_CACHE_CONTROL);
    expect(res.headers.get("set-cookie")).toBeNull();
    const rewrites = rewrittenHeaders(res);
    expect(rewrites[LANG_OVERRIDE_HEADER]).toBe("ar");
    // ?lang is stripped from the switcher's return path; other query survives.
    expect(rewrites[PUBLIC_PATH_HEADER]).toBe("/contact?sent=1");
  });

  it("keeps the first explicit ?lang=ar request cacheable (no Set-Cookie)", () => {
    // A Set-Cookie on the HTML response makes Next force private/no-store, so
    // the canonical Arabic URL would never populate the shared cache. The
    // switcher persists the preference through /switch-lang instead.
    const res = middleware(request("http://kiddy.test/?lang=ar"));
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe(MARKETING_CACHE_CONTROL);
    expect(res.headers.get("cdn-cache-control")).toBe(EDGE_CACHE_CONTROL);
  });

  it("does not cache or rewrite non-marketing routes", () => {
    const res = middleware(request("http://kiddy.test/login?lang=ar"));
    expect(res.headers.get("cache-control")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(rewrittenHeaders(res)[PUBLIC_PAGE_HEADER]).toBeUndefined();
  });

  it("never redirects a non-GET request (server actions keep their body)", () => {
    const res = middleware(
      request("http://kiddy.test/contact", {
        method: "POST",
        headers: { cookie: "kiddy_site_lang=ar" },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("cache-control")).toBeNull();
  });
});

describe("KID-2406: a stored Arabic preference normalizes the URL", () => {
  it("redirects the clean URL to the distinct Arabic URL, preserving query", () => {
    const res = middleware(
      request("http://kiddy.test/contact?sent=1", {
        headers: { cookie: "kiddy_site_lang=ar" },
      })
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/contact?sent=1&lang=ar");
  });

  it("does not redirect when the URL already says Arabic or the cookie is English", () => {
    expect(
      middleware(
        request("http://kiddy.test/features?lang=ar", {
          headers: { cookie: "kiddy_site_lang=ar" },
        })
      ).status
    ).toBe(200);
    expect(
      middleware(
        request("http://kiddy.test/features", {
          headers: { cookie: "kiddy_site_lang=en" },
        })
      ).status
    ).toBe(200);
  });

  it("honors a valid ?lang=ar even when the cookie says English", () => {
    const res = middleware(
      request("http://kiddy.test/?lang=ar", {
        headers: { cookie: "kiddy_site_lang=en" },
      })
    );
    expect(res.status).toBe(200);
    // The explicit choice wins for this response; no cookie write on the
    // cacheable HTML (see above).
    expect(rewrittenHeaders(res)[LANG_OVERRIDE_HEADER]).toBe("ar");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("lets an explicit ?lang=en override a stored Arabic preference", () => {
    const res = middleware(
      request("http://kiddy.test/features?lang=en", {
        headers: { cookie: "kiddy_site_lang=ar" },
      })
    );
    expect(res.status).toBe(200);
    expect(rewrittenHeaders(res)[LANG_OVERRIDE_HEADER]).toBe("en");
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("KID-2406: the performance changes are pinned in the repo", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("the root layout no longer forces dynamic rendering or bootstraps", () => {
    const src = read("app/layout.tsx");
    expect(src).not.toContain('export const dynamic = "force-dynamic"');
    expect(src).not.toContain("ensureSeeded");
    // Public pages use host-only branding so the cached HTML is per-host, not
    // per-session.
    expect(src).toContain("getHostBranding");
    expect(src).toContain("brandNameForHostTitle");
  });

  it("the authenticated layouts own the one-time bootstrap", () => {
    for (const p of [
      "app/login/layout.tsx",
      "app/portal/layout.tsx",
      "app/child/layout.tsx",
      "app/platform/layout.tsx",
    ]) {
      expect(read(p), `${p} must call ensureSeededSafe`).toContain("ensureSeededSafe()");
    }
  });

  it("vercel.json ships the fra1 function region", () => {
    const config = JSON.parse(read("vercel.json"));
    expect(config.regions).toEqual(["fra1"]);
  });

  it("package.json targets modern browsers", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(Array.isArray(pkg.browserslist)).toBe(true);
    expect(pkg.browserslist.join(" ")).toContain("chrome >= 111");
  });

  it("the Chatwoot SDK is deferred", () => {
    const src = read("components/ChatwootWidget.tsx");
    expect(src).toContain('strategy="lazyOnload"');
    expect(src).toContain("sdkLoaded");
  });
});
