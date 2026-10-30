// KID-368 (DEF-004) regression tests: with the app language set to Arabic,
// /login and the five parent tabs (/child/newsfeed, events, drive, forms,
// consents) rendered hardcoded English. Everything on those surfaces now goes
// through the lib/i18n dictionary (EN + AR), matching the dashboard/detail
// pages.
//
// Test style follows tests/unit/kid254-child-detail-subdomain.test.ts: the
// next/headers request scope is mocked per test (cookie + host), the local
// SQLite data layer is seeded fresh, and every assertion is on real rendered
// output. loginAction is pinned in both languages: the kiddy_lang cookie
// decides, mirroring the root layout's precedence.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// --- request-scope mocks: pages/actions read next/headers; tests inject the
// cookie per test. redirect() is mocked to throw the same NEXT_REDIRECT
// sentinel Next uses, so a guard bounce FAILS the test loudly instead of
// rendering. ---------------------------------------------------------------
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

import * as store from "@/lib/store";
import { createSessionToken, setAccountLanguage } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";
import { en, ar, tr } from "@/lib/i18n";

let parentAccountId: string;
let childId: string;
let instituteId: string;
let ownerId: string;

beforeEach(async () => {
  mockHeaders = {};
  mockCookies = {};
  await seedFixture();
  const parent = await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'");
  parentAccountId = String(parent!.id);
  const child = await queryGet("SELECT id FROM child WHERE first_name = 'Ella'");
  childId = String(child!.id);
  const inst = await queryGet("SELECT id FROM institute");
  instituteId = String(inst!.id);
  const owner = await queryGet("SELECT id FROM account WHERE role = 'owner' OR role = 'staff' ORDER BY id LIMIT 1");
  ownerId = String(owner!.id);
});

afterEach(() => {
  mockHeaders = {};
  mockCookies = {};
});

function parentCookie(): string {
  return `kiddy_sess=${encodeURIComponent(
    createSessionToken({ accountId: parentAccountId, role: "parent", email: "parent@example.test", emailConfirmed: true })
  )}`;
}

async function setParentLanguage(language: "ar" | "en"): Promise<void> {
  await setAccountLanguage(parentAccountId, language);
}

async function renderModelPages(): Promise<Record<string, string>> {
  mockHeaders = { host: "daycare.test", cookie: parentCookie() };
  const newsfeed = await import("@/app/child/newsfeed/page");
  const events = await import("@/app/child/events/page");
  const drive = await import("@/app/child/drive/page");
  const forms = await import("@/app/child/forms/page");
  const consents = await import("@/app/child/consents/page");
  return {
    newsfeed: renderToStaticMarkup(await newsfeed.default()),
    events: renderToStaticMarkup(await events.default()),
    drive: renderToStaticMarkup(await drive.default()),
    forms: renderToStaticMarkup(await forms.default({ searchParams: {} })),
    consents: renderToStaticMarkup(await consents.default()),
  };
}

function newsfeedPostForElla(): Promise<void> {
  return store.createNewsfeedPost({
    instituteId,
    accountId: ownerId,
    body: "Ella painted the sun today.",
    tagChildIds: [childId],
  }).then((r) => {
    void r;
  });
}

describe("KID-368 (DEF-004): the i18n dictionary carries both locales", () => {
  it("EN renders keep the original wording", () => {
    const t = (key: string) => tr(en, key);
    expect(t("login.signIn")).toBe("Sign in");
    expect(t("login.welcomeBack")).toContain("Welcome back");
    expect(t("login.emailLabel")).toBe("Email");
    expect(t("login.passwordLabel")).toBe("Password");
    expect(t("login.forgotPassword")).toContain("Forgot your password");
    expect(t("login.inviteActivate")).toContain("Activate your account");
    expect(t("newsfeed.title")).toBe("Newsfeed");
    expect(t("events.title")).toBe("Events");
    expect(t("drive.title")).toBe("Parent drive");
    expect(t("forms.title")).toBe("Forms & surveys");
    expect(t("consents.title")).toBe("Consents & approvals");
  });

  it("AR renders translate every pinned DEF-004 string", () => {
    const t = (key: string) => tr(ar, key);
    // /login — every literal the audit flagged
    const arLogin = ["login.signIn", "login.welcomeBack", "login.emailLabel", "login.passwordLabel", "login.forgotPassword", "login.inviteActivate"];
    for (const key of arLogin) {
      expect(t(key), `${key} must translate`).toBeTruthy();
      expect(t(key).startsWith("MISSING:"), `${key} missing in ar`).toBe(false);
      // no Latin leftovers in the Arabic wording (the platform email is the
      // only allowed Latin run and it does not appear in these keys)
      expect(/[a-zA-Z]{3,}/.test(t(key)), `${key} still contains English: ${t(key)}`).toBe(false);
    }
    // five parent tabs
    expect(t("newsfeed.title")).toBeTruthy();
    expect(t("events.title")).toBeTruthy();
    expect(t("drive.title")).toBeTruthy();
    expect(t("forms.title")).toBeTruthy();
    expect(t("consents.title")).toBeTruthy();
    const arKeys = [
      "newsfeed.title", "newsfeed.empty", "newsfeed.forChild", "newsfeed.likesAndComments",
      "newsfeed.addCommentPlaceholder", "newsfeed.comment",
      "events.title", "events.subtitle", "events.upcoming", "events.noUpcoming", "events.videos", "events.noVideos",
      "drive.title", "drive.subtitle", "drive.empty", "drive.open", "drive.allChildren",
      "forms.title", "forms.subtitle", "forms.sent", "forms.empty", "forms.responsesSoFar", "forms.fillIn",
      "forms.submit", "forms.mySubmissions", "forms.noSubmissions", "forms.submitted", "forms.yes",
      "consents.title", "consents.empty", "consents.approve", "consents.deny",
      "consents.statusPending", "consents.statusApproved", "consents.statusDenied",
      "login.withdrawn", "login.noAccess", "login.operatorEntryInvalid",
      "login.wrongTenant", "login.wrongTenantNamed",
    ];
    for (const key of arKeys) {
      const value = tr(ar, key);
      expect(value, `${key} must exist`).toBeTruthy();
      expect(value.startsWith("MISSING:"), `${key} resolved to the missing marker`).toBe(false);
    }
  });
});

describe("KID-368 (DEF-004): the login page renders both languages", () => {
  it("EN rendering is unchanged (default, no lang cookie)", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    const html = renderToStaticMarkup(await LoginPage({ searchParams: {} }));
    expect(html).toContain("Sign in");
    expect(html).toContain("Email");
    expect(html).toContain("Password");
    expect(html).toContain("Forgot your password?");
    expect(html).toContain("Activate your account");
    expect(html).not.toContain("تسجيل الدخول");
  });

  it("with kiddy_lang=ar every user-facing string renders in Arabic", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    mockCookies = { kiddy_lang: "ar" };
    const html = renderToStaticMarkup(await LoginPage({ searchParams: {} }));
    // No English literals from the audit
    for (const e of ["Sign in", "Welcome back", ">Email<", ">Password<", "Forgot your password?", "Activate your account"]) {
      expect(html).not.toContain(e);
    }
    // The Arabic wording is there
    expect(html).toContain("تسجيل الدخول");
    expect(html).toContain("كلمة المرور");
    expect(html).toContain("هل نسيت كلمة المرور؟");
  });

  it("guard redirects are localized and bidi-isolated (dir=auto + <bdi>)", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    mockCookies = { kiddy_lang: "ar" };
    const html = renderToStaticMarkup(
      await LoginPage({ searchParams: { error: "wrong-tenant", tenant: "Sunshine Daycare" } })
    );
    expect(html).toContain("dir=\"auto\"");
    expect(html).toContain("<bdi>");
    // the Arabic missing on the old render, and the EN sentence absent
    expect(html).toContain("ينتمي");
    expect(html).not.toContain("Sign in from that daycare");
    expect(html).toContain("Sunshine Daycare");
  });
});

describe("KID-368 (DEF-004): loginAction errors are worded in the visitor's language", () => {
  it("bad credentials return the localized auth message (cookie decides)", async () => {
    const { loginAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("email", "parent@example.test");
    fd.set("password", "not-the-password");
    mockCookies = { kiddy_lang: "ar" };
    const ar = await loginAction(fd);
    expect(ar?.error).toBe(tr(await import("@/lib/i18n").then((m) => m.ar), "auth.invalidEmailPassword"));
    mockCookies = {};
    const enRes = await loginAction(fd);
    expect(enRes?.error).toBe("Invalid email or password.");
  });
});

describe("KID-368 (DEF-004): the five parent tabs render both languages", () => {
  it("EN rendering stays identical to the pre-fix pages", async () => {
    await setParentLanguage("en");
    await newsfeedPostForElla();
    const pages = await renderModelPages();
    expect(pages.newsfeed).toContain("Newsfeed</h1>");
    expect(pages.newsfeed).toContain("Add a comment…");
    expect(pages.newsfeed).toContain("0 likes · 0 comments");
    expect(pages.events).toContain("Events</h1>");
    expect(pages.events).toContain("Upcoming events");
    expect(pages.events).toContain("Videos");
    expect(pages.drive).toContain("Parent drive</h1>");
    expect(pages.drive).toContain("all children");
    expect(pages.drive).toContain(">Open</a>");
    expect(pages.forms).toContain("Forms &amp; surveys</h1>");
    expect(pages.forms).toContain("My submissions");
    expect(pages.consents).toContain("Consents &amp; approvals</h1>");
    expect(pages.consents).toContain("Pending");
    expect(pages.consents).toContain("Approve");
    expect(pages.consents).toContain("Deny");
  });

  it("with the account language AR, no English literals remain on the five tabs", async () => {
    await setParentLanguage("ar");
    await newsfeedPostForElla();
    const pages = await renderModelPages();
    for (const [name, html] of Object.entries(pages)) {
      const banned = ["Newsfeed</h1>", "Nothing posted for your children", "likes · ", "Add a comment…", ">Comment<",
        "Events</h1>", "Upcoming events", "Videos", "Parent drive</h1>", "Nothing shared yet.", ">Open<",
        "Forms &amp; surveys</h1>", "My submissions", "No daycare configured yet",
        "Consents &amp; approvals</h1>", "No consent requests for your children"];
      for (const b of banned) {
        expect(html).not.toContain(b);
      }
      if (name === "newsfeed") {
        expect(html).toContain("الأخبار");
        expect(html).toContain("إعجاب");
        expect(html).toContain("تعليق");
      }
      if (name === "events") {
        expect(html).toContain("الفعاليات");
        expect(html).toContain("الفيديوهات");
      }
      if (name === "drive") {
        expect(html).toContain("الملفات المشتركة");
        expect(html).toContain("كل الأطفال");
        expect(html).toContain(">فتح</a>");
      }
      if (name === "forms") {
        expect(html).toContain("النماذج والاستبيانات");
        expect(html).toContain("إرسالاتي");
      }
      if (name === "consents") {
        expect(html).toContain("الموافقات والأذونات");
        expect(html).toContain("معلّق");
        expect(html).toContain("موافقة");
      }
    }
  });

  it("drive kind labels, form kinds and consent statuses localize", async () => {
    await setParentLanguage("ar");
    await store.addDriveFile({
      instituteId,
      filename: "consent-form.pdf",
      url: "https://example.test/consent-form.pdf",
      kind: "pdf",
      childId,
    });
    await store.createConsent({ instituteId, title: "Allow school trip", body: "Trip on Thursday.", childId });
    const drive = await import("@/app/child/drive/page");
    mockHeaders = { host: "daycare.test", cookie: parentCookie() };
    const driveHtml = renderToStaticMarkup(await drive.default());
    expect(driveHtml).toContain("PDF");
    expect(driveHtml).toContain("كل الأطفال");
    expect(driveHtml).not.toContain("all children");

    const consents = await import("@/app/child/consents/page");
    const consentsHtml = renderToStaticMarkup(await consents.default());
    expect(consentsHtml).toContain("معلّق");
    expect(consentsHtml).toContain("موافقة");
    expect(consentsHtml).toContain("رفض");
    expect(consentsHtml).not.toContain("Approve");
    expect(consentsHtml).not.toContain(">pending<");
  });
});
