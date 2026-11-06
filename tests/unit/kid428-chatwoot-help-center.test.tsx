// KID-428: the Help Center is Chatwoot-backed end to end. The article set, the
// search ranking and the alternate-language pairing all come from the
// board's Chatwoot help-center portal (lib/help-chatwoot); the bundled
// 96-record KID-388 file and the KID-260 bundle helpers are deleted with this
// change, so nothing can drift back.
//
// Carry-over contract (KID-403): the page chrome (title, search, support
// form, back link, exit button) follows the EN/AR help language — the same
// resolved value that picks the article set and the direction — not the
// account's app language. QA item 6 (KID-259/4) caught an English-account
// user opening ?lang=ar and getting Arabic articles wrapped in English
// chrome; these assertions keep that regression covered.
//
// Test style follows the retired kid403 suite: next/headers is mocked per
// test (cookie + host), the local SQLite data layer is seeded fresh, the
// Chatwoot HTTP boundary is stubbed with a fixture portal (URL-keyed), and
// every assertion runs on real rendered output of the four help routes
// (/child/support, /child/support/[id], /portal/support, /portal/support/[id]).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    // renderToStaticMarkup mounts the toggle client island outside the app
    // router; the toggle's router only fires on user interaction, so a stub
    // is enough for SSR assertions.
    useRouter: () => ({
      replace: () => undefined,
      push: () => undefined,
      refresh: () => undefined,
    }),
    redirect: (url: string) => {
      const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
      err.digest = `NEXT_REDIRECT;replace;${url};`;
      throw err;
    },
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  };
});
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

// ── Fixture Chatwoot portal ────────────────────────────────────────────────

const AR_RESET_TITLE = "إعادة تعيين كلمة مرور منسية";

type FixtureArticle = {
  id: number;
  title: string;
  content: string;
  categorySlug: string;
  locale: string;
  status?: string;
};

const FIXTURE_CATEGORY_TITLES: Record<string, { slug: string; locale: string; name: string }> = {
  public: { slug: "public", locale: "en", name: "Public" },
  parents: { slug: "parents", locale: "en", name: "Parents" },
  "staff-and-admin": { slug: "staff-and-admin", locale: "en", name: "Staff and admin" },
  "public-ar": { slug: "public-ar", locale: "ar", name: "عام" },
  "parents-ar": { slug: "parents-ar", locale: "ar", name: "للأهالي" },
  "staff-and-admin-ar": { slug: "staff-and-admin-ar", locale: "ar", name: "للطاقم والإدارة" },
};

function article(
  id: number,
  title: string,
  categorySlug: string,
  content: string,
  extra: Partial<FixtureArticle> = {},
): FixtureArticle {
  const category = FIXTURE_CATEGORY_TITLES[categorySlug];
  return {
    id,
    title,
    content,
    categorySlug,
    locale: category.locale,
    status: "published",
    ...extra,
  };
}

const SIGN_IN_BODY =
  "<p>Open <strong>Kiddy</strong> and enter your email.</p><p>Show the sign-in screen.</p>";

// The KIT-388-era Notion link and the keyword/related metadata must not ship;
// the Related line becomes in-app links inside the detail view.
const RESET_BODY = [
  "<p>Signed out? Reset from the sign-in page.</p>",
  "<ol><li>Open <strong>Sign in</strong>.</li><li>Choose <strong>Forgot password</strong>.</li></ol>",
  "<p><strong>Related:</strong> Sign in to Kiddy · none</p>",
  "<p><strong>Keywords:</strong> forgot password, reset, lock out, نسيت كلمة المرور</p>",
  "<hr>",
  `<p><strong>النسخة العربية:</strong> <a href="https://app.notion.com/p/111">${AR_RESET_TITLE}</a></p>`,
].join("");

// A hostile body: the stored HTML must be sanitized hard by the detail route.
const ATTACK_BODY = [
  '<script>alert(1)</script>',
  '<p onclick="alert(1)">Reset steps with hostile attributes.</p>',
  '<a href="javascript:alert(1)">zero-day anchor</a>',
  '<a href="https://app.notion.com/p/222">stale docs anchor keeps its plain https target</a>',
  '<iframe src="https://evil.test"></iframe>',
].join("");

// The Arabic counterpart: own body, Arabic Related line (pairs with the
// sign-in article in the public-ar category) and an "English version" footer.
const AR_RESET_BODY = [
  "<p>وفّر كلمة المرور من صفحة تسجيل الدخول.</p>",
  "<ol><li>افتح <strong>تسجيل الدخول</strong>.</li><li>اختر <strong>نسيت كلمة المرور</strong>.</li></ol>",
  "<p><strong>ذات صلة:</strong> تسجيل الدخول إلى Kiddy · لا يوجد</p>",
  "<p><strong>الكلمات المفتاحية:</strong> نسيت كلمة المرور, إعادة تعيين</p>",
  "<hr>",
  '<p><strong>English version:</strong> <a href="https://app.notion.com/p/444">Reset a forgotten password</a></p>',
].join("");

const FIXTURE_ARTICLES: FixtureArticle[] = [
  // ── English ──
  article(74, "Reset a forgotten password", "public", RESET_BODY),
  article(101, "Sign in to Kiddy", "public", SIGN_IN_BODY),
  article(102, "Hostile payload fixture", "public", ATTACK_BODY),
  article(3, "Check your child in as a pickup contact", "parents", SIGN_IN_BODY),
  article(38, "Record a payment or deposit", "staff-and-admin", SIGN_IN_BODY),
  article(39, "Add an event", "staff-and-admin", SIGN_IN_BODY),
  // ── Arabic ──
  article(80, AR_RESET_TITLE, "public-ar", AR_RESET_BODY),
  article(81, "تسجيل الدخول إلى Kiddy", "public-ar", SIGN_IN_BODY),
  article(2, "تسجيل حضور طفلك (جهة استلام فقط)", "parents-ar", SIGN_IN_BODY),
  article(26, "إضافة فعالية", "staff-and-admin-ar", SIGN_IN_BODY),
  // A draft must never render anywhere.
  article(90, "Draft article", "public", SIGN_IN_BODY, { status: "draft" }),
];

let chatwootFetches: URL[] = [];

function fixtureFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input));
  chatwootFetches.push(url);
  const path = url.pathname;
  const respond = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  const articles = (payload: unknown) =>
    respond({
      payload,
      meta: {
        all_articles_count: (payload as unknown[]).length,
        articles_count: (payload as unknown[]).length,
        published_count: (payload as unknown[]).length,
      },
    });

  if (path.endsWith("/categories")) {
    const locale = url.searchParams.get("locale");
    return articles(
      Object.values(FIXTURE_CATEGORY_TITLES).filter((category) => category.locale === locale),
    );
  }
  if (/\/articles\/\d+$/.test(path)) {
    const id = Number(path.match(/\/articles\/(\d+)$/)![1]);
    const found = FIXTURE_ARTICLES.find((candidate) => candidate.id === id);
    if (!found) {
      return Promise.resolve(new Response(JSON.stringify({ error: "not found" }), { status: 404 }));
    }
    return respond({
      id: found.id,
      title: found.title,
      status: found.status ?? "published",
      content: found.content,
      category: FIXTURE_CATEGORY_TITLES[found.categorySlug],
    });
  }
  const query = url.searchParams.get("query");
  if (query !== null) {
    const hits = FIXTURE_ARTICLES.filter(
      (candidate) =>
        candidate.status === "published" &&
        (candidate.title.toLowerCase().includes(query.toLowerCase()) ||
          candidate.content.toLowerCase().includes(query.toLowerCase())),
    ).map(toChatwootArticle);
    return articles(hits);
  }
  const categorySlug = url.searchParams.get("category_slug");
  const locale = url.searchParams.get("locale");
  if (categorySlug) {
    const hits = FIXTURE_ARTICLES.filter(
      (candidate) => candidate.categorySlug === categorySlug && candidate.status === "published",
    ).map(toChatwootArticle);
    return articles(hits);
  }
  if (locale) {
    const hits = FIXTURE_ARTICLES.filter(
      (candidate) => candidate.locale === locale && candidate.status === "published",
    ).map(toChatwootArticle);
    return articles(hits);
  }
  return articles(FIXTURE_ARTICLES.filter((article) => article.status === "published").map(toChatwootArticle));
}

function toChatwootArticle(fixture: FixtureArticle) {
  return {
    id: fixture.id,
    slug: `${fixture.id}-fixture`,
    title: fixture.title,
    status: fixture.status ?? "published",
    content: fixture.content,
    category: {
      id: fixture.categorySlug.length,
      name: FIXTURE_CATEGORY_TITLES[fixture.categorySlug].name,
      slug: fixture.categorySlug,
      locale: fixture.locale,
    },
  };
}

// ── Session + page renderers ───────────────────────────────────────────────

import { createSessionToken, setAccountLanguage } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";
import { ar, en, tr } from "@/lib/i18n";

let parentAccountId: string;
let staffAccountId: string;

beforeEach(async () => {
  mockHeaders = {};
  mockCookies = {};
  await seedFixture();
  chatwootFetches = [];
  parentAccountId = String(
    (await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'"))!.id,
  );
  staffAccountId = String(
    (await queryGet("SELECT id FROM account WHERE role = 'owner'"))!.id,
  );
  vi.stubGlobal("fetch", fixtureFetch);
  vi.stubEnv("CHATWOOT_BASE_URL", "http://chatwoot.test");
  vi.stubEnv("CHATWOOT_ACCESS_TOKEN", "test-access-token");
});

afterEach(() => {
  mockHeaders = {};
  mockCookies = {};
  chatwootFetches = [];
  vi.unstubAllEnvs();
});

function sessionCookie(accountId: string, role: string, email: string): string {
  return `kiddy_sess=${encodeURIComponent(
    createSessionToken({ accountId, role, email, emailConfirmed: true }),
  )}`;
}

type Query = Record<string, string>;

async function renderChildSupport(searchParams: Query = {}): Promise<string> {
  mockHeaders = {
    host: "daycare.test",
    cookie: sessionCookie(parentAccountId, "parent", "parent@example.test"),
  };
  const page = await import("@/app/child/support/page");
  return renderToStaticMarkup(await page.default({ searchParams }));
}

async function renderChildSupportArticle(id: string, searchParams: Query = {}): Promise<string> {
  mockHeaders = {
    host: "daycare.test",
    cookie: sessionCookie(parentAccountId, "parent", "parent@example.test"),
  };
  const page = await import("@/app/child/support/[id]/page");
  return renderToStaticMarkup(await page.default({ params: { id }, searchParams }));
}

async function renderPortalSupport(searchParams: Query = {}): Promise<string> {
  mockHeaders = {
    host: "daycare.test",
    cookie: sessionCookie(staffAccountId, "owner", "trois4ever+admin@gmail.com"),
  };
  const page = await import("@/app/portal/support/page");
  return renderToStaticMarkup(await page.default({ searchParams }));
}

async function renderPortalSupportArticle(id: string, searchParams: Query = {}): Promise<string> {
  mockHeaders = {
    host: "daycare.test",
    cookie: sessionCookie(staffAccountId, "owner", "trois4ever+admin@gmail.com"),
  };
  const page = await import("@/app/portal/support/[id]/page");
  return renderToStaticMarkup(await page.default({ params: { id }, searchParams }));
}

async function assertNotFound(promise: Promise<string>): Promise<void> {
  await expect(promise).rejects.toThrow("NEXT_NOT_FOUND");
}

// Chrome copy visible/blocked per language. The "English" toggle label
// (help.langEn) is intentionally language-stable and never asserted away.
// KID-478 item 6: the manual ticket chrome ("Send a support request",
// "My requests") is gone with the parent-facing form/list.
const EN_LIST_CHROME = [
  "Help Center",
  "Step-by-step guides for using Kiddy.",
  "Search the help center",
];
const AR_LIST_CHROME = [
  "مركز المساعدة",
  "إرشادات خطوة بخطوة لاستخدام كيدي.",
  "ابحث في مركز المساعدة",
];

describe("KID-428: Chatwoot-backed knowledge base on the parent surface", () => {
  it("list view renders the Chatwoot article set grouped by category (no bundle)", async () => {
    const html = await renderChildSupport();
    expect(html).toContain("Reset a forgotten password");
    expect(html).toContain("Check your child in as a pickup contact");
    expect(html).toContain("/child/support/74?lang=en");
    for (const piece of EN_LIST_CHROME) expect(html).toContain(piece);
  });

  it("parent roles do not see the staff-and-admin category", async () => {
    const html = await renderChildSupport();
    expect(html).not.toContain("Record a payment or deposit");
    expect(html).not.toContain("Add an event");
  });

  it("staff-and-admin articles exist for owner roles (parents categories stay parent-only)", async () => {
    await setAccountLanguage(staffAccountId, "en");
    const html = await renderPortalSupport();
    expect(html).toContain("Record a payment or deposit");
    expect(html).toContain("Reset a forgotten password");
    expect(html).not.toContain("Check your child in as a pickup contact");
  });

  it("Chatwoot category names drive the list headings", async () => {
    const html = await renderChildSupport();
    expect(html).toContain("Public");
    expect(html).toContain("Parents");
  });

  it("drafts and unknown ids 404 on detail; published ones render", async () => {
    await assertNotFound(renderChildSupportArticle("90"));
    await assertNotFound(renderChildSupportArticle("99999"));
    const html = await renderChildSupportArticle("74");
    expect(html).toContain("Forgot password");
  });

  it("the article body ships sanitized HTML: script/iframe/handlers gone", async () => {
    const html = await renderChildSupportArticle("102");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('<script');
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("onclick");
    // The sanitizer keeps safe links and re-issues them with noopener.
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it("the footer pair: related links land in-app, the Notion/keyword paragraphs are stripped", async () => {
    const html = await renderChildSupportArticle("74");
    // Related
    expect(html).toContain("Sign in to Kiddy");
    expect(html).toContain("help-article-related");
    // The old cross-language Notion footer is deleted (title stays as pairing,
    // only the anchor/link itself is gone).
    expect(html).not.toContain("https://app.notion.com");
    expect(html).not.toContain("Keywords:");
    expect(html).not.toContain("النسخة العربية:");
  });

  it("alternate-language toggle navigates to the paired Chatwoot article id", async () => {
    const html = await renderChildSupportArticle("74");
    expect(html).toContain("/child/support/80?lang=ar");
  });

  it("the pairing resolves both directions (ar body footer names the EN pair)", async () => {
    const html = await renderChildSupportArticle("80", { lang: "ar" });
    expect(html).toContain("/child/support/74?lang=en");
  });

  it("family roles cannot open staff- or owner-only article URLs", async () => {
    await assertNotFound(renderChildSupportArticle("38"));
  });

  it("detail chrome follows ?lang= and the cookie (KID-403 carryover)", async () => {
    const arabic = await renderChildSupportArticle("74", { lang: "ar" });
    expect(arabic).toContain(tr(ar, "help.backToList"));
    expect(arabic).toContain(tr(ar, "help.articleContactExit"));
    expect(arabic).not.toContain(tr(en, "help.backToList"));
    // A true Arabic article view keeps the related machinery in Arabic too.
    const arabicArticle = await renderChildSupportArticle("80", { lang: "ar" });
    expect(arabicArticle).toContain(tr(ar, "help.articleRelated"));
    expect(arabicArticle).toContain("/child/support/81?lang=ar");
    const english = await renderChildSupportArticle("74", { lang: "en" });
    expect(english).toContain(tr(en, "help.backToList"));
    expect(english).not.toContain(tr(ar, "help.backToList"));
  });

  it("stale cookie decision: explicit ?lang=en beats an ar cookie", async () => {
    await setAccountLanguage(parentAccountId, "en");
    mockCookies = { kiddy_help_lang: "ar" };
    const html = await renderChildSupport({ lang: "en" });
    for (const piece of EN_LIST_CHROME) expect(html).toContain(piece);
    for (const piece of AR_LIST_CHROME) expect(html).not.toContain(piece);
  });
});

describe("KID-428: Chatwoot search replaces the bundled search", () => {
  it("?q= hits the Chatwoot search endpoint and renders its filtered results", async () => {
    const html = await renderChildSupport({ q: "invoice" });
    // The stubbed portal search was actually queried.
    expect(chatwootFetches.some((url) => url.searchParams.get("query") === "invoice")).toBe(true);
    expect(html).toContain("help-search-results");
  });

  it("search results stay inside the viewer's audience and language", async () => {
    // Reset a forgotten password is public EN; the fixture search matches its
    // body too. Staff-only/Arabic fixtures must not surface in the same view.
    const html = await renderChildSupport({ q: "forgotten" });
    expect(html).toContain("Reset a forgotten password");
    expect(html).not.toContain(AR_RESET_TITLE);
    expect(html).not.toContain("Record a payment or deposit");
  });

  it("empty result card carries the new chat-bubble hint and no form/inbox exit", async () => {
    const html = await renderChildSupport({ q: "zzz-not-anywhere" });
    expect(html).toContain(tr(en, "help.noResultsTitle").replace("{query}", "zzz-not-anywhere"));
    expect(html).toContain(tr(en, "help.noResultsHint"));
    // KID-478 item 6: no request-form anchor and no inbox link survive.
    expect(html).not.toContain("#support-form");
    expect(html).not.toContain("support-inbox");
  });
});

describe("KID-428: no 'open the support inbox' button on Help & Support", () => {
  it("staff list page has no inbox link in any language", async () => {
    await setAccountLanguage(staffAccountId, "en");
    const english = await renderPortalSupport();
    expect(english).not.toContain("support-inbox");
    expect(english).not.toContain(tr(en, "help.inboxLink"));
    const arabic = await renderPortalSupport({ lang: "ar" });
    expect(arabic).not.toContain("support-inbox");
    expect(arabic).not.toContain(tr(ar, "help.inboxLink"));
  });

  it("the empty-list state card exists when Chatwoot is unreachable", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("chatwoot down")));
    const html = await renderChildSupport();
    expect(html).toContain(tr(en, "help.unavailableTitle"));
    expect(html).not.toContain("Reset a forgotten password");
    expect(html).not.toContain("support-inbox");
  });

  it("an unconfigured deployment shows the fallback card too", async () => {
    vi.unstubAllEnvs();
    const html = await renderChildSupport();
    expect(html).toContain(tr(en, "help.unavailableTitle"));
    expect(chatwootFetches.length).toBe(0);
  });
});
