// KID-427: the "open the support inbox" button is gone from the Help & Support
// page (board directive KID-425). The button rendered only on the staff portal
// list surface (/portal/support) — a <Link href="/portal/support-inbox">
// labelled help.inboxLink ("Open the support inbox" / "فتح صندوق طلبات الدعم").
// The family surface never carried it (its no-result exit goes to the on-page
// support request form) and the /portal/support-inbox page itself stays (staff
// ticket handling + the HelpCenter no-result contact link both still live).
//
// Test style follows tests/unit/kid403-help-chrome-language.test.tsx: the help
// routes render through real SSR against the seeded local SQLite store.

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
import { en, ar } from "@/lib/i18n";
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

async function renderPortalSupport(searchParams: Record<string, string> = {}): Promise<string> {
  mockHeaders = {
    host: "daycare.test",
    cookie: sessionCookie(staffAccountId, "owner", "admin@sunshinedaycare.test"),
  };
  const page = await import("@/app/portal/support/page");
  return renderToStaticMarkup(await page.default({ searchParams }));
}

async function renderChildSupport(searchParams: Record<string, string> = {}): Promise<string> {
  mockHeaders = {
    host: "daycare.test",
    cookie: sessionCookie(parentAccountId, "parent", "parent@example.test"),
  };
  const page = await import("@/app/child/support/page");
  return renderToStaticMarkup(await page.default({ searchParams }));
}

// The removed button's labels, exactly as they were carried by help.inboxLink.
const REMOVED_LABELS = ["Open the support inbox", "فتح صندوق طلبات الدعم"];

// Published staff article slug (slugs are shared across the EN/AR pair).
const staffSlug =
  HELP_ARTICLES.find(
    (a) => a.language === "en" && a.audience === "staff" && a.status === "published"
  )!.slug;

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

describe("KID-427: the support-inbox button is gone from Help & Support", () => {
  it("the help.inboxLink dict key no longer exists (en + ar)", () => {
    expect(Object.keys(en.help)).not.toContain("inboxLink");
    expect(Object.keys(ar.help)).not.toContain("inboxLink");
  });

  it("staff portal /portal/support renders no support-inbox button (EN)", async () => {
    await setAccountLanguage(staffAccountId, "en");
    const html = await renderPortalSupport();
    expect(html).toContain("Help &amp; Support");
    expect(html).not.toContain('href="/portal/support-inbox"');
    for (const label of REMOVED_LABELS) expect(html).not.toContain(label);
  });

  it("staff portal /portal/support renders no support-inbox button (AR help language)", async () => {
    await setAccountLanguage(staffAccountId, "en");
    const html = await renderPortalSupport({ lang: "ar" });
    expect(html).toContain("مركز المساعدة");
    expect(html).not.toContain('href="/portal/support-inbox"');
    for (const label of REMOVED_LABELS) expect(html).not.toContain(label);
  });

  it("family surface /child/support renders no support-inbox button (EN)", async () => {
    await setAccountLanguage(parentAccountId, "en");
    const html = await renderChildSupport();
    expect(html).toContain("Help Center");
    expect(html).not.toContain('href="/portal/support-inbox"');
    for (const label of REMOVED_LABELS) expect(html).not.toContain(label);
  });

  it("family surface /child/support renders no support-inbox button (AR help language)", async () => {
    await setAccountLanguage(parentAccountId, "en");
    const html = await renderChildSupport({ lang: "ar" });
    expect(html).toContain("مركز المساعدة");
    expect(html).not.toContain('href="/portal/support-inbox"');
    for (const label of REMOVED_LABELS) expect(html).not.toContain(label);
  });

  it("kept: the staff article 'Contact support' exit still points at the inbox", async () => {
    await setAccountLanguage(staffAccountId, "en");
    const html = await renderPortalSupportArticle(staffSlug, { lang: "en" });
    expect(html).toContain('href="/portal/support-inbox"');
  });
});
