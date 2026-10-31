// KID-403: the Help Center page chrome must follow the EN/AR help language
// control — the same resolved value that picks the article set and the
// direction — instead of the account's app language. QA item 6 (KID-259/4)
// caught an English-account user opening ?lang=ar and getting Arabic articles
// wrapped in English chrome (list title/subtitle/search, results count, empty
// state, back link, exit button).
//
// Test style follows tests/unit/kid368-def004-ar-i18n.test.tsx: next/headers is
// mocked per test (cookie + host), the local SQLite data layer is seeded fresh,
// and every assertion runs on real rendered output of the four help routes
// (/child/support, /child/support/[slug], /portal/support, /portal/support/[slug]).

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
    // renderToStaticMarkup mounts the HelpCenter client island outside the app
    // router; the toggle's router only fires on user interaction, so a stub is
    // enough for SSR assertions.
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

import { createSessionToken, setAccountLanguage } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";
import { ar, en, tr } from "@/lib/i18n";
import { HELP_ARTICLES } from "@/lib/help-kb";

let parentAccountId: string;
let staffAccountId: string;

beforeEach(async () => {
  mockHeaders = {};
  mockCookies = {};
  await seedFixture();
  parentAccountId = String(
    (await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'"))!.id
  );
  staffAccountId = String(
    (await queryGet("SELECT id FROM account WHERE role = 'owner'"))!.id
  );
});

afterEach(() => {
  mockHeaders = {};
  mockCookies = {};
});

function sessionCookie(accountId: string, role: string, email: string): string {
  return `kiddy_sess=${encodeURIComponent(
    createSessionToken({ accountId, role, email, emailConfirmed: true })
  )}`;
}

async function renderChildSupport(searchParams: Record<string, string> = {}): Promise<string> {
  mockHeaders = {
    host: "daycare.test",
    cookie: sessionCookie(parentAccountId, "parent", "parent@example.test"),
  };
  const page = await import("@/app/child/support/page");
  return renderToStaticMarkup(await page.default({ searchParams }));
}

async function renderChildSupportArticle(
  slug: string,
  searchParams: Record<string, string> = {}
): Promise<string> {
  mockHeaders = {
    host: "daycare.test",
    cookie: sessionCookie(parentAccountId, "parent", "parent@example.test"),
  };
  const page = await import("@/app/child/support/[slug]/page");
  return renderToStaticMarkup(await page.default({ params: { slug }, searchParams }));
}

async function renderPortalSupport(searchParams: Record<string, string> = {}): Promise<string> {
  mockHeaders = {
    host: "daycare.test",
    cookie: sessionCookie(staffAccountId, "owner", "admin@sunshinedaycare.test"),
  };
  const page = await import("@/app/portal/support/page");
  return renderToStaticMarkup(await page.default({ searchParams }));
}

async function renderPortalSupportArticle(
  slug: string,
  searchParams: Record<string, string> = {}
): Promise<string> {
  mockHeaders = {
    host: "daycare.test",
    cookie: sessionCookie(staffAccountId, "owner", "admin@sunshinedaycare.test"),
  };
  const page = await import("@/app/portal/support/[slug]/page");
  return renderToStaticMarkup(await page.default({ params: { slug }, searchParams }));
}

// Published article slugs per audience (slugs are shared across the EN/AR pair,
// so the help language picks the record, not the URL).
const parentSlug =
  HELP_ARTICLES.find(
    (a) => a.language === "en" && a.audience === "parent" && a.status === "published"
  )!.slug;
const staffSlug =
  HELP_ARTICLES.find(
    (a) => a.language === "en" && a.audience === "staff" && a.status === "published"
  )!.slug;

// Chrome copy that the QA repro called out (list + detail), used as presence /
// absence markers. The "English" toggle label (help.langEn) and the EN-coded
// area headings are intentionally language-stable and never asserted away.
const EN_LIST_CHROME = [
  "Help Center",
  "Step-by-step guides for using Kiddy.",
  "Search the help center",
  "Send a support request",
  "My requests",
];
const AR_LIST_CHROME = [
  "مركز المساعدة",
  "إرشادات خطوة بخطوة لاستخدام كيدي.",
  "ابحث في مركز المساعدة",
  "أرسل طلب دعم",
  "طلباتي",
];

describe("KID-403: help chrome follows the help language on the parent surface", () => {
  it("EN account + persisted help_lang=ar cookie → Arabic chrome on the list", async () => {
    await setAccountLanguage(parentAccountId, "en");
    mockCookies = { kiddy_help_lang: "ar" };
    const html = await renderChildSupport();
    for (const piece of AR_LIST_CHROME) expect(html).toContain(piece);
    for (const piece of EN_LIST_CHROME) expect(html).not.toContain(piece);
    // The support-form block under the KB speaks the help language too.
    expect(html).toContain(tr(ar, "help.requestIntro"));
    expect(html).toContain(tr(ar, "help.formSubject"));
    expect(html).not.toContain(tr(en, "help.requestIntro"));
  });

  it("EN account + ?lang=ar (no cookie) → Arabic chrome on the list", async () => {
    await setAccountLanguage(parentAccountId, "en");
    const html = await renderChildSupport({ lang: "ar" });
    for (const piece of AR_LIST_CHROME) expect(html).toContain(piece);
    for (const piece of EN_LIST_CHROME) expect(html).not.toContain(piece);
  });

  it("EN account + ?lang=ar → Arabic chrome on the article detail", async () => {
    await setAccountLanguage(parentAccountId, "en");
    const html = await renderChildSupportArticle(parentSlug, { lang: "ar" });
    expect(html).toContain(tr(ar, "help.backToList"));
    expect(html).toContain(tr(ar, "help.articleRelated"));
    expect(html).toContain(tr(ar, "help.articleContactExit"));
    expect(html).not.toContain(tr(en, "help.backToList"));
    expect(html).not.toContain(tr(en, "help.articleContactExit"));
    expect(html).not.toContain(tr(en, "help.articleRelated"));
  });

  it("explicit ?lang=en wins over a stale ar cookie (toggle-back path keeps EN chrome)", async () => {
    await setAccountLanguage(parentAccountId, "en");
    mockCookies = { kiddy_help_lang: "ar" };
    const html = await renderChildSupport({ lang: "en" });
    for (const piece of EN_LIST_CHROME) expect(html).toContain(piece);
    for (const piece of AR_LIST_CHROME) expect(html).not.toContain(piece);
  });

  it("Arabic account, untouched help language → Arabic chrome (behavior unchanged)", async () => {
    await setAccountLanguage(parentAccountId, "ar");
    const html = await renderChildSupport();
    for (const piece of AR_LIST_CHROME) expect(html).toContain(piece);
    for (const piece of EN_LIST_CHROME) expect(html).not.toContain(piece);
  });

  it("EN account with no help control touched → EN chrome unchanged", async () => {
    await setAccountLanguage(parentAccountId, "en");
    const html = await renderChildSupport();
    for (const piece of EN_LIST_CHROME) expect(html).toContain(piece);
    for (const piece of AR_LIST_CHROME) expect(html).not.toContain(piece);
  });
});

describe("KID-403: help chrome follows the help language on the staff surface", () => {
  it("EN owner + ?lang=ar → Arabic chrome on the KB list and inbox link", async () => {
    await setAccountLanguage(staffAccountId, "en");
    const html = await renderPortalSupport({ lang: "ar" });
    expect(html).toContain(tr(ar, "topbar.helpSupport"));
    expect(html).toContain(tr(ar, "help.inboxLink"));
    for (const piece of ["Help & Support", "Open the support inbox"]) {
      expect(html).not.toContain(piece);
    }
  });

  it("EN owner + ?lang=ar → Arabic chrome on the article detail", async () => {
    await setAccountLanguage(staffAccountId, "en");
    const html = await renderPortalSupportArticle(staffSlug, { lang: "ar" });
    expect(html).toContain(tr(ar, "help.backToList"));
    expect(html).toContain(tr(ar, "help.contactSupport"));
    expect(html).not.toContain(tr(en, "help.backToList"));
    expect(html).not.toContain(tr(en, "help.contactSupport"));
  });

  it("EN owner with no help control touched → EN chrome unchanged", async () => {
    await setAccountLanguage(staffAccountId, "en");
    const html = await renderPortalSupport();
    // The h1 renders the ampersand HTML-escaped in static markup.
    expect(html).toContain("Help &amp; Support");
    expect(html).toContain(tr(en, "help.inboxLink"));
    expect(html).not.toContain(tr(ar, "topbar.helpSupport"));
  });
});

describe("KID-403: parent detail honors the persisted cookie too", () => {
  it("EN account + help_lang=ar cookie (no ?lang) → Arabic detail chrome", async () => {
    await setAccountLanguage(parentAccountId, "en");
    mockCookies = { kiddy_help_lang: "ar" };
    const html = await renderChildSupportArticle(parentSlug);
    expect(html).toContain(tr(ar, "help.backToList"));
    expect(html).toContain(tr(ar, "help.articleContactExit"));
    expect(html).not.toContain(tr(en, "help.backToList"));
  });
});
