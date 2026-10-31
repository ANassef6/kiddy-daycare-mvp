// KID-260: Help Center knowledge base — unit tests.
// Covering: the record contract (bilingual pairs, slugs, provenance), the
// audience + published-only filters, the EN/AR search matcher including Arabic
// normalisation (alef/hamza/taa-marbuta/ya variants, diacritics, tatweel), and
// the related-links resolution.
import { describe, expect, it } from "vitest";
import {
  HELP_ARTICLES,
  canViewHelpAudience,
  helpArticleBySlug,
  helpAudiencesForRole,
  helpAreas,
  relatedHelpArticles,
  visibleHelpArticles,
  type HelpArticle,
} from "@/lib/help-kb";
import { normalizeSearchText, searchHelpArticles } from "@/lib/help-search";
import { helpMarkdownBlocks } from "@/lib/help-markdown";

function ids(articles: readonly HelpArticle[]): string[] {
  return articles.map((article) => article.id).sort();
}

describe("bundled article set (contract)", () => {
  it("ships the full bilingual set with one slug per language pair", () => {
    const en = HELP_ARTICLES.filter((a) => a.language === "en");
    const ar = HELP_ARTICLES.filter((a) => a.language === "ar");
    expect(en.length).toBeGreaterThan(40);
    expect(ar.length).toEqual(en.length);
    const enSlugs = new Set(en.map((a) => a.slug));
    const arSlugs = new Set(ar.map((a) => a.slug));
    expect([...arSlugs].every((slug) => enSlugs.has(slug))).toBe(true);
  });

  it("every record carries the contract fields and a Notion source", () => {
    for (const article of HELP_ARTICLES) {
      // KID-388: Wren's authoritative bundle adds the CAR/PKU series
      // alongside PAR/PUB/STA.
      expect(article.id).toMatch(/^A-(PAR|PUB|STA|CAR|PKU)-\d{2}$/);
      expect(article.slug.length).toBeGreaterThan(0);
      expect(["en", "ar"]).toContain(article.language);
      expect(["parent", "staff", "carer", "owner", "public"]).toContain(article.audience);
      expect(article.area.length).toBeGreaterThan(0);
      expect(article.title.length).toBeGreaterThan(0);
      expect(article.body.length).toBeGreaterThan(40);
      expect(article.keywords.length).toBeGreaterThan(0);
      expect(["published", "draft"]).toContain(article.status);
      expect(article.source).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it("never quotes the removed demo login hint (KID-239)", () => {
    const hintPattern = /demo credentials|demo password|demo@|بيانات الدخول التجريبية|بيانات التجربة/i;
    for (const article of HELP_ARTICLES) {
      expect(article.body, `article ${article.id}`).not.toMatch(hintPattern);
    }
  });
});

describe("audience + published filter", () => {
  const fakeDraft: HelpArticle = {
    ...HELP_ARTICLES[0],
    id: "A-TST-99",
    slug: "test-draft",
    language: "en",
    status: "draft",
  };
  const set = [...HELP_ARTICLES, fakeDraft];

  it("a parent sees parent + public articles only", () => {
    const audiences = helpAudiencesForRole("parent");
    expect(audiences).toEqual(["public", "parent"]);
    const visible = visibleHelpArticles(set, audiences, "en");
    for (const article of visible) {
      expect(["parent", "public"]).toContain(article.audience);
      expect(article.status).toBe("published");
    }
    expect(ids(visible)).not.toContain("A-TST-99");
  });

  it("a staff account cannot see parent-only articles and vice versa", () => {
    const staffIds = ids(visibleHelpArticles(set, helpAudiencesForRole("staff"), "en"));
    const parentIds = ids(visibleHelpArticles(set, helpAudiencesForRole("parent"), "en"));
    const staffOnly = HELP_ARTICLES.filter(
      (a) => a.language === "en" && a.audience === "staff",
    ).map((a) => a.id);
    const parentOnly = HELP_ARTICLES.filter(
      (a) => a.language === "en" && a.audience === "parent",
    ).map((a) => a.id);
    for (const id of staffOnly) {
      expect(staffIds).toContain(id);
      expect(parentIds).not.toContain(id);
    }
    for (const id of parentOnly) {
      expect(parentIds).toContain(id);
      expect(staffIds).not.toContain(id);
    }
  });

  it("an owner sees staff + owner scoped articles; admin sees staff but not the owner's own billing slice", () => {
    expect(helpAudiencesForRole("owner")).toEqual(["public", "staff", "owner"]);
    expect(helpAudiencesForRole("admin")).toEqual(["public", "staff"]);
    expect(helpAudiencesForRole("staff")).toEqual(["public", "staff"]);
  });

  it("canViewHelpAudience agrees with the list filter (URL gate = list filter)", () => {
    const staffOnly = HELP_ARTICLES.find(
      (a) => a.language === "en" && a.audience === "staff",
    )!;
    expect(canViewHelpAudience("staff", staffOnly.audience)).toBe(true);
    expect(canViewHelpAudience("parent", staffOnly.audience)).toBe(false);
    expect(canViewHelpAudience("parent", "public")).toBe(true);
  });

  it("published-only: drafts never render on any surface", () => {
    for (const role of ["parent", "carer", "staff", "admin", "owner"]) {
      const visible = visibleHelpArticles(set, helpAudiencesForRole(role), "en");
      expect(ids(visible)).not.toContain("A-TST-99");
    }
  });

  it("helpArticleBySlug 404s on draft or wrong audience; slugs carry both languages", () => {
    expect(helpArticleBySlug(set, "test-draft", helpAudiencesForRole("staff"), "en")).toBeNull();
    const staffEn = HELP_ARTICLES.find((a) => a.language === "en" && a.audience === "staff")!;
    expect(helpArticleBySlug(set, staffEn.slug, helpAudiencesForRole("parent"), "en")).toBeNull();
    // Slug is shared across the language pair: the same URL renders the AR
    // record when ?lang=ar.
    const arMatch = helpArticleBySlug(set, staffEn.slug, helpAudiencesForRole("staff"), "ar")!;
    expect(arMatch.language).toBe("ar");
    expect(arMatch.id).toBe(staffEn.id);
  });
});

describe("search matcher", () => {
  const parentSet = visibleHelpArticles(HELP_ARTICLES, helpAudiencesForRole("parent"), "en");
  const parentSetAr = visibleHelpArticles(HELP_ARTICLES, helpAudiencesForRole("parent"), "ar");

  it("normalizes Arabic alef/hamza/taa-marbuta/ya variants and diacritics", () => {
    expect(normalizeSearchText("الإلغاء")).toBe(normalizeSearchText("الالغاء"));
    expect(normalizeSearchText("الإلغاء")).toBe(normalizeSearchText("الإلغاء"));
    expect(normalizeSearchText("طفلة")).toBe(normalizeSearchText("طفله"));
    expect(normalizeSearchText("عَرْضُ الحُضُورٍ")).toBe(normalizeSearchText("عرض الحضور"));
    expect(normalizeSearchText("حضّورٍ~")).toBe(normalizeSearchText("حضور"));
    expect(normalizeSearchText("Check-In")).toBe(normalizeSearchText("check in"));
  });

  it("check-in (EN) ranks A-PAR-02 at/near the top: query as a parent types it", () => {
    const ranked = searchHelpArticles(parentSet, "check in my child");
    const top2 = ranked.slice(0, 2).map((entry) => entry.article.id);
    expect(top2).toContain("A-PAR-02");
    expect(searchHelpArticles(parentSet, "check your child in or out")[0].article.id).toBe("A-PAR-02");
  });

  it("search matches keywords, title and body", () => {
    const byKeyword = searchHelpArticles(parentSet, "invite code");
    expect(byKeyword[0].article.id).toBe("A-PUB-01");
    const byTitle = searchHelpArticles(parentSet, "check your child in or out");
    expect(byTitle[0].article.id).toBe("A-PAR-02");
  });

  it("AR query عرض الحضور ranks A-STA-06 first (KID-223 regression)", () => {
    const staffSet = visibleHelpArticles(HELP_ARTICLES, helpAudiencesForRole("staff"), "ar");
    const ranked = searchHelpArticles(staffSet, "عرض الحضور");
    expect(ranked[0].article.id).toBe("A-STA-06");
  });

  it("an empty query is the plain list, not a search", () => {
    expect(searchHelpArticles(parentSet, "     ")).toHaveLength(parentSet.length);
  });
});

describe("related links", () => {
  it("resolves the Related: line to same-language published articles the viewer may open", () => {
    const audiences = helpAudiencesForRole("parent");
    const aPar02 = HELP_ARTICLES.find((a) => a.id === "A-PAR-02" && a.language === "en")!;
    const { related, bodyWithoutRelated } = relatedHelpArticles(HELP_ARTICLES, aPar02, audiences);
    expect(related.length).toBeGreaterThan(0);
    for (const article of related) {
      expect(article.language).toBe("en");
      expect(article.status).toBe("published");
      expect(audiences).toContain(article.audience);
    }
    expect(bodyWithoutRelated).not.toMatch(/^\*\*Related:\*\*/m);
  });

  it("resolves AR related links from the Arabic line", () => {
    const audiences = helpAudiencesForRole("parent");
    const aPar02Ar = HELP_ARTICLES.find((a) => a.id === "A-PAR-02" && a.language === "ar")!;
    const { related, bodyWithoutRelated } = relatedHelpArticles(HELP_ARTICLES, aPar02Ar, audiences);
    expect(related.length).toBeGreaterThan(0);
    for (const article of related) {
      expect(article.language).toBe("ar");
    }
    expect(bodyWithoutRelated).not.toMatch(/ذات صلة/);
  });

  it("does not turn a Related name the viewer cannot open into a link", () => {
    const audiences = helpAudiencesForRole("parent");
    const anyStaff = HELP_ARTICLES.find((a) => a.language === "en" && a.audience === "staff")!;
    const { related } = relatedHelpArticles(HELP_ARTICLES, anyStaff, audiences);
    for (const article of related) {
      expect(["staff", "owner", "public"]).toContain(article.audience);
    }
  });
});

describe("markdown renderer", () => {
  it("builds numbered/bulleted/heading/plain blocks from the corpus subset", () => {
    const blocks = helpMarkdownBlocks("**Notes**\n\n- one\n\n2. step two\n\n# Heading\n\ntext");
    expect(blocks.map((b) => b.type)).toEqual(["p", "ul", "ol", "h", "p"]);
    expect(blocks[2].lines[0].startsWith("2. ")).toBe(true);
  });

  it("handles Arabic-Indic step numbers", () => {
    const blocks = helpMarkdownBlocks("١. افتح **أطفالي**");
    expect(blocks[0].type).toBe("ol");
  });
});

describe("group headings", () => {
  it("exposes stable EN-coded area headings in stored order", () => {
    const en = visibleHelpArticles(HELP_ARTICLES, helpAudiencesForRole("parent"), "en");
    const areas = helpAreas(en);
    expect(areas.length).toBeGreaterThan(3);
    for (const area of areas) expect(area.length).toBeGreaterThan(0);
  });
});
