// KID-2460: the Arabic portal must render an Arabic, RTL sidebar — and a
// language change must never leave the mounted shell on the old language.
//
// The labels were already dictionary-backed, so the reported English sidebar
// was not a missing-key bug: it was a stale layout. A server-action redirect
// is a client-side navigation, so the root <html dir> and the portal sidebar
// kept their old props while only the page segment re-rendered in Arabic.
// These tests pin the three parts of the fix:
//   1. the sidebar's whole tree renders from the active dictionary (EN + AR);
//   2. the language switch is a native POST → 303, i.e. a full document load;
//   3. the RTL-only chevron mirror rule and the cross-tab LocaleGuard exist.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

let currentPathname = "/portal/account";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

const mockCookies = vi.hoisted(() => ({
  values: {} as Record<string, string>,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      mockCookies.values[name] === undefined
        ? undefined
        : { name, value: mockCookies.values[name] },
    set: () => undefined,
  }),
}));

import { NextRequest } from "next/server";
import PortalSidebar from "@/components/PortalSidebar";
import LanguageSettingsCard from "@/components/LanguageSettingsCard";
import LocaleGuard from "@/components/LocaleGuard";
import { dictionaries } from "@/lib/i18n";
import { createSessionToken } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

const ROOT = process.cwd();
const CSS = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("KID-2460: portal sidebar renders from the active dictionary", () => {
  it("renders every group and nested link in Arabic for an AR account", () => {
    currentPathname = "/portal/dashboard";
    const html = renderToStaticMarkup(
      <PortalSidebar
        brandName="Sunshine Daycare"
        logoUrl={null}
        locale="ar"
        dict={dictionaries.ar}
        role="owner"
      />
    );
    const text = visibleText(html);
    for (const label of [
      dictionaries.ar.nav.home,
      dictionaries.ar.nav.dashboard,
      dictionaries.ar.nav.newsFeed,
      dictionaries.ar.nav.calendar,
      dictionaries.ar.nav.events,
      dictionaries.ar.nav.parentDrive,
      dictionaries.ar.nav.children,
      dictionaries.ar.nav.learning,
      dictionaries.ar.nav.staff,
      dictionaries.ar.nav.tools,
    ]) {
      expect(text).toContain(label);
    }
    // The exact English group labels from the founder screenshot must be gone.
    for (const label of ["Home", "Dashboard", "News feed", "Calendar", "Events", "Parent drive", "Children", "Learning", "Staff", "Tools"]) {
      expect(text).not.toContain(label);
    }
  });

  it("keeps the English sidebar unchanged in LTR", () => {
    currentPathname = "/portal/dashboard";
    const html = renderToStaticMarkup(
      <PortalSidebar
        brandName="Sunshine Daycare"
        logoUrl={null}
        locale="en"
        dict={dictionaries.en}
        role="owner"
      />
    );
    const text = visibleText(html);
    for (const label of ["Home", "Dashboard", "News feed", "Calendar", "Events", "Parent drive", "Children", "Learning", "Staff", "Tools"]) {
      expect(text).toContain(label);
    }
  });
});

describe("KID-2460: RTL mirrors the group chevron", () => {
  it("flips only the toggle chevron under html[dir=rtl]", () => {
    expect(CSS).toMatch(
      /html\[dir="rtl"\]\s*\.portal-nav-toggle\s+svg\s*\{[^}]*transform:\s*scaleX\(-1\)/
    );
    // The base chevron path is unchanged for LTR.
    const baseToggles = CSS.match(/\.portal-nav-toggle\s*\{[^}]*\}/g) ?? [];
    expect(baseToggles.some((rule) => /transform/.test(rule))).toBe(false);
  });
});

describe("KID-2460: language switch is a full document navigation", () => {
  it("posts the card to /switch-app-lang with the current path", () => {
    currentPathname = "/portal/settings";
    const html = renderToStaticMarkup(
      <LanguageSettingsCard locale="en" dict={dictionaries.en} />
    );
    expect(html).toContain('action="/switch-app-lang"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="next" value="/portal/settings"');
    expect(html).toContain('value="ar"');
    expect(html).toContain('value="en"');
    expect(html.match(/name="locale"/g)?.length).toBe(2);
  });

  it("no longer routes the switch through a server action", () => {
    const source = readFileSync(
      path.join(ROOT, "components", "LanguageSettingsCard.tsx"),
      "utf8"
    );
    expect(source).not.toContain("saveLanguageAction");
  });
});

describe("KID-2460: LocaleGuard is mounted on both authenticated shells", () => {
  it("renders nothing (it is behaviour only)", () => {
    expect(renderToStaticMarkup(<LocaleGuard locale="ar" />)).toBe("");
  });

  it("is mounted in the portal and parent layouts", () => {
    for (const file of ["app/portal/layout.tsx", "app/child/layout.tsx"]) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).toContain("<LocaleGuard locale={locale} />");
    }
  });
});

describe("KID-2460: POST /switch-app-lang", () => {
  let ownerId: string;
  let cookie: string;

  beforeEach(async () => {
    await seedFixture();
    const owner = await queryGet("SELECT id, email, role FROM account WHERE role = 'owner'");
    ownerId = String(owner!.id);
    cookie = `kiddy_sess=${createSessionToken({
      accountId: ownerId,
      role: String(owner!.role),
      email: String(owner!.email),
      emailConfirmed: true,
    })}`;
    await queryRun("UPDATE account SET language = 'en' WHERE id = ?", ownerId);
  });

  function request(fields: Record<string, string>, headers: Record<string, string> = {}) {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    return new NextRequest("http://kiddy.test/switch-app-lang", {
      method: "POST",
      body,
      headers: { cookie, ...headers },
    });
  }

  it("saves the account language and answers 303 to the validated next path", async () => {
    const { POST } = await import("@/app/switch-app-lang/route");
    const res = await POST(request({ locale: "ar", next: "/portal/dashboard" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/portal/dashboard");
    expect(res.headers.get("set-cookie")).toContain("kiddy_lang=ar");
    const row = await queryGet("SELECT language FROM account WHERE id = ?", ownerId);
    expect(row?.language).toBe("ar");
  });

  it("falls back to the role landing page and refuses an external next", async () => {
    const { POST } = await import("@/app/switch-app-lang/route");
    const res = await POST(request({ locale: "ar", next: "https://evil.test/" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/portal/account");
  });

  it("ignores an unknown locale without changing the stored preference", async () => {
    const { POST } = await import("@/app/switch-app-lang/route");
    const res = await POST(request({ locale: "fr", next: "/portal/account" }));
    expect(res.status).toBe(303);
    const row = await queryGet("SELECT language FROM account WHERE id = ?", ownerId);
    expect(row?.language).toBe("en");
  });

  it("refuses a cross-origin POST", async () => {
    const { POST } = await import("@/app/switch-app-lang/route");
    const res = await POST(request({ locale: "ar" }, { origin: "https://evil.test" }));
    expect(res.status).toBe(403);
    const row = await queryGet("SELECT language FROM account WHERE id = ?", ownerId);
    expect(row?.language).toBe("en");
  });

  it("sends an unauthenticated POST to the login page", async () => {
    const { POST } = await import("@/app/switch-app-lang/route");
    const body = new FormData();
    body.set("locale", "ar");
    const res = await POST(
      new NextRequest("http://kiddy.test/switch-app-lang", { method: "POST", body })
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
  });
});

describe("KID-2460: GET /api/locale", () => {
  let ownerId: string;

  beforeEach(async () => {
    await seedFixture();
    const owner = await queryGet("SELECT id, email, role FROM account WHERE role = 'owner'");
    ownerId = String(owner!.id);
    mockCookies.values = {};
  });

  it("returns the signed-in account locale with no-store", async () => {
    const owner = await queryGet("SELECT email, role FROM account WHERE id = ?", ownerId);
    await queryRun("UPDATE account SET language = 'ar' WHERE id = ?", ownerId);
    mockCookies.values.kiddy_sess = createSessionToken({
      accountId: ownerId,
      role: String(owner!.role),
      email: String(owner!.email),
      emailConfirmed: true,
    });
    const { GET } = await import("@/app/api/locale/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: "ar" });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("returns 401 without a session", async () => {
    const { GET } = await import("@/app/api/locale/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
