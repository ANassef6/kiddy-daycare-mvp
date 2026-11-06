// KID-428: unit contract for the Chatwoot help-center adapter's pure helpers
// (env config, category→audience mapping, HTML sanitizer, footer pairing and
// Related parsing) and the page-walk logic, with global fetch stubbed by
// URL. The integration-level rendering contract lives in
// kid428-chatwoot-help-center.test.tsx.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHATWOOT_HELP_PAGE_SIZE,
  sanitizeHelpHtml,
  audienceForCategorySlug,
  helpAudiencesForRole,
  chatwootHelpConfig,
  extractAlternateTitle,
  extractRelatedTitles,
  relatedRefs,
  articleRefByTitle,
  loadHelpArticle,
  loadHelpCenter,
  searchHelpCenter,
} from "@/lib/help-chatwoot";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("KID-428: configuration detection", () => {
  it("is null without base URL or token, and normalizes the base", () => {
    expect(chatwootHelpConfig({})).toBeNull();
    expect(chatwootHelpConfig({ CHATWOOT_BASE_URL: "http://cw" })).toBeNull();
    expect(chatwootHelpConfig({ CHATWOOT_ACCESS_TOKEN: "tok" })).toBeNull();
    const config = chatwootHelpConfig({
      CHATWOOT_BASE_URL: "http://cw/",
      CHATWOOT_ACCESS_TOKEN: "tok",
      CHATWOOT_ACCOUNT_ID: "7",
      CHATWOOT_PORTAL_SLUG: "docs",
    });
    expect(config).toEqual({ baseUrl: "http://cw", accountId: "7", portal: "docs", token: "tok" });
  });

  it("defaults to account 1 / portal help-center", () => {
    expect(chatwootHelpConfig({ CHATWOOT_BASE_URL: "http://cw", CHATWOOT_ACCESS_TOKEN: "t" })).toEqual({
      baseUrl: "http://cw",
      accountId: "1",
      portal: "help-center",
      token: "t",
    });
  });
});

describe("KID-428: audience mapping (KID-260 semantics on Chatwoot categories)", () => {
  it("maps every language's category slugs", () => {
    expect(audienceForCategorySlug("public")).toBe("public");
    expect(audienceForCategorySlug("public-ar")).toBe("public");
    expect(audienceForCategorySlug("parents")).toBe("parent");
    expect(audienceForCategorySlug("parents-ar")).toBe("parent");
    expect(audienceForCategorySlug("staff-and-admin")).toBe("staff");
    expect(audienceForCategorySlug("staff-and-admin-ar")).toBe("staff");
    expect(audienceForCategorySlug("unknown")).toBeNull();
  });

  it("keeps role visibility boundaries", () => {
    expect(helpAudiencesForRole("parent")).toEqual(["public", "parent"]);
    expect(helpAudiencesForRole("caregiver")).toEqual(["public"]);
    expect(helpAudiencesForRole("owner")).toEqual(["public", "staff"]);
    expect(helpAudiencesForRole("admin")).toEqual(["public", "staff"]);
    expect(helpAudiencesForRole("teacher")).toEqual(["public", "staff"]);
  });
});

describe("KID-428: HTML sanitizer", () => {
  it("strips scripts, iframes, comments, handlers and dangerous schemes", () => {
    const out = sanitizeHelpHtml(
      '<p data-x="1">ok</p><script>evil()</script><style>a{}</style><!-- c -->' +
        '<a href="javascript:x()">bad</a><a href="https://good.test">good</a>' +
        '<img src="/x.png"><img src="javascript:y">' + "</bogus>",
    );
    expect(out).not.toContain("evil()");
    expect(out).not.toContain("<style");
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("data-x");
    expect(out).toContain("<p>ok</p>");
    expect(out).toContain('<a href="https://good.test" target="_blank" rel="noopener noreferrer">');
    expect(out).toContain("<img src=\"/x.png\"");
    expect(out).not.toContain('src="javascript:y"');
    expect(out).not.toContain("</bogus>");
  });

  it("keeps anchors with relative and mailto hrefs (no external target)", () => {
    const out = sanitizeHelpHtml('<a href="/x">rel</a><a href="mailto:a@b.t">mail</a>');
    expect(out).toContain('<a href="/x">');
    expect(out).toContain('<a href="mailto:a@b.t">');
    expect(out).not.toContain("target=");
  });
});

describe("KID-428: footer pairing and Related parsing", () => {
  const EN_BODY =
    '<p>b</p><p><strong>Related:</strong> Alpha Service · Beta Guide</p>' +
    '<p><strong>Keywords:</strong> k1, k2</p><hr>' +
    '<p><strong>النسخة العربية:</strong> <a href="https://app.notion.com/">قائمة الجدول</a></p>';
  const AR_BODY =
    '<p>b</p><hr><p><strong>English version:</strong> <a href="https://app.notion.com/">Alpha Title</a></p>';

  it("extracts the opposite-language title from either footer direction", () => {
    expect(extractAlternateTitle(EN_BODY)).toBe("قائمة الجدول");
    expect(extractAlternateTitle(AR_BODY)).toBe("Alpha Title");
    expect(extractAlternateTitle("<p>plain</p>")).toBeNull();
  });

  it("handles the live portal's strong-less footer variant and dangling divider", async () => {
    vi.stubEnv("CHATWOOT_BASE_URL", "http://chatwoot.test");
    vi.stubEnv("CHATWOOT_ACCESS_TOKEN", "test-access-token");
    const liveStyle =
      '<ul><li>step</li></ul><hr><p>النسخة العربية: <a href="https://app.notion.com/">قائمة الجدول</a></p>';
    const respond = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200 });
    const calls: URL[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname.endsWith("/categories")) {
        const locale = url.searchParams.get("locale");
        return Promise.resolve(respond({ payload: [{ id: 1, slug: "public", locale, name: "Public" }] }));
      }
      if (/\/articles\/\d+$/.test(url.pathname)) {
        return Promise.resolve(
          respond({ payload: { id: 74, title: "T", status: "published", content: liveStyle, category: { slug: "public", locale: "en" } } }),
        );
      }
      const slug = url.searchParams.get("category_slug");
      const locale = url.searchParams.get("locale") ?? "en";
      // The opposite-language listing must contain the footer pairing title.
      const title = locale === "ar" ? "قائمة الجدول" : "A1";
      return Promise.resolve(
        respond({ payload: [articleJson(1, title, slug ?? "public", locale)], meta: { articles_count: 1 } }),
      );
    });
    const load = await loadHelpArticle(74, "en", ["public"]);
    expect(load.ok).toBe(true);
    if (load.ok) {
      expect(load.alternateId).toBe(1);
      // The trailing divider left behind by the footer removal is gone.
      expect(load.article.html.endsWith("<hr>")).toBe(false);
      expect(load.article.html.includes("قائمة الجدول")).toBe(false);
      expect(load.related.length).toBe(0);
    }
  });

  it("reports Related names and skips placeholders", () => {
    expect(extractRelatedTitles(EN_BODY)).toEqual(["Alpha Service", "Beta Guide"]);
    expect(extractRelatedTitles(AR_BODY)).toEqual([]);
    const refs = relatedRefs(
      ["Sign in", "عرض الحضور", "none"],
      [
        { id: 1, title: "Sign in", language: "en", audience: "public" },
        { id: 2, title: "عرض الحضور", language: "ar", audience: "public" },
      ],
    );
    expect(refs.map((ref) => ref.id)).toEqual([1, 2]);
  });

  it("matches the pair exactly by title, first", () => {
    const candidates = [
      { id: 1, title: "Alpha Title Extra", language: "en" as const, audience: "public" as const },
      { id: 2, title: "alpha title", language: "en" as const, audience: "public" as const },
    ];
    expect(articleRefByTitle("Alpha Title", candidates)!.id).toBe(2);
    expect(articleRefByTitle("missing entirely", candidates)).toBeNull();
    expect(articleRefByTitle(null, candidates)).toBeNull();
  });
});

function stubPortal(handler: (url: URL, call: number) => unknown) {
  const calls: URL[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    return Promise.resolve(new Response(JSON.stringify(handler(url, calls.length)), { status: 200 }));
  });
  return calls;
}

function articleJson(id: number, title: string, slug: string, locale: string) {
  return {
    id,
    title,
    status: "published",
    content: `<p>${title}</p>`,
    category: { id: 1, name: "Public", slug, locale },
  };
}

describe("KID-428: page-walk and search filters", () => {
  it("walks category pages beyond 25 articles", async () => {
    vi.stubEnv("CHATWOOT_BASE_URL", "http://chatwoot.test");
    vi.stubEnv("CHATWOOT_ACCESS_TOKEN", "test-access-token");
    const page1 = Array.from({ length: CHATWOOT_HELP_PAGE_SIZE }, (_, i) => articleJson(i + 1, `A${i + 1}`, "public", "en"));
    const page2 = [articleJson(26, "A26", "public", "en")];
    const calls = stubPortal((url) => {
      if (url.pathname.endsWith("/categories")) {
        return { payload: [{ id: 1, slug: "public", locale: "en", name: "Public" }] };
      }
      const page = url.searchParams.get("page");
      return { payload: page === "1" ? page1 : page2, meta: { articles_count: 26 } };
    });
    const load = await loadHelpCenter("en", ["public"]);
    expect(load.ok).toBe(true);
    if (load.ok) {
      expect(load.groups.length).toBe(26);
      expect(load.groups[25].ref.id).toBe(26);
    }
    expect(calls.some((url) => url.searchParams.get("page") === "2")).toBe(true);
    expect(calls.every((url) => url.pathname.includes("/portals/help-center/"))).toBe(true);
  });

  it("filters search results to the browsing language and audience", async () => {
    vi.stubEnv("CHATWOOT_BASE_URL", "http://chatwoot.test");
    vi.stubEnv("CHATWOOT_ACCESS_TOKEN", "test-access-token");
    const calls = stubPortal((url) => {
      if (url.pathname.endsWith("/categories")) {
        return { payload: [] };
      }
      return {
        payload: [
          articleJson(1, "EN public", "public", "en"),
          articleJson(2, "EN staff", "staff-and-admin", "en"),
          articleJson(3, "AR public", "public-ar", "ar"),
        ],
        meta: { articles_count: 3 },
      };
    });
    const load = await searchHelpCenter("anything", "en", ["public"]);
    expect(calls[0].searchParams.get("query")).toBe("anything");
    expect(load.ok).toBe(true);
    if (load.ok) {
      expect(load.results.length).toBe(1);
      expect(load.results[0].id).toBe(1);
    }
  });

  it("search is ok:false without configuration", async () => {
    const load = await searchHelpCenter("q", "en", ["public"]);
    expect(load).toEqual({ ok: false });
  });
});
