// KID-478: two KID-472 admin-UX moves pinned together.
//
//   1. The parent Help & support page (/child/support) is the Chatwoot
//      knowledge base plus the live-chat bubble ONLY. The manual "Send
//      request" form and the "My requests" list are removed (the staff
//      support inbox and support_ticket table stay for historical/staff
//      use), and the now-dead ticket i18n keys are gone from BOTH
//      dictionaries.
//   2. The portal sidebar moves Supplies and Rooms out of the Tools group
//      and into the Children group for admin roles (admin-gating, labels,
//      owner-only Tools tabs and the dead-link rule all keep their prior
//      contract).
//
// Test style follows the kid428 harness: next/headers is mocked per test
// (session cookie via createSessionToken), the local SQLite data layer is
// seeded fresh, Chatwoot stays unconfigured so the help center degrades to
// its unavailable card (the markup contract is identical), and every
// assertion runs on real rendered output or the real portalNav result.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

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
  };
});
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { createSessionToken, setAccountLanguage } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";
import { dictionaries, tr } from "@/lib/i18n";
import { portalNav } from "@/components/PortalSidebar";

let parentAccountId: string;

beforeEach(async () => {
  mockHeaders = {};
  mockCookies = {};
  await seedFixture();
  parentAccountId = String(
    (await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'"))!.id,
  );
  // Chatwoot stays unconfigured for this suite: no env, so loadHelpCenter
  // degrades to the unavailable card without any fetch attempt.
  delete process.env.CHATWOOT_BASE_URL;
  delete process.env.CHATWOOT_ACCESS_TOKEN;
});

afterEach(() => {
  mockHeaders = {};
  mockCookies = {};
});

function sessionCookie(accountId: string, role: string, email: string): string {
  return `kiddy_sess=${encodeURIComponent(
    createSessionToken({ accountId, role, email, emailConfirmed: true }),
  )}`;
}

async function renderParentSupport(searchParams: Record<string, string> = {}): Promise<string> {
  mockHeaders = {
    host: "daycare.test",
    cookie: sessionCookie(parentAccountId, "parent", "parent@example.test"),
  };
  const page = await import("@/app/child/support/page");
  return renderToStaticMarkup(await page.default({ searchParams }));
}

const repoRoot = path.resolve(__dirname, "../..");

describe("KID-478 item 6: the parent help surface keeps only the Chatwoot help center", () => {
  it("the help center renders (degraded state) on /child/support", async () => {
    await setAccountLanguage(parentAccountId, "en");
    const html = await renderParentSupport();
    expect(html).toContain('data-testid="help-center"');
    expect(html).toContain(tr(dictionaries.en, "help.title"));
  });

  it("no manual ticket form or requests list survives on the parent surface", async () => {
    await setAccountLanguage(parentAccountId, "en");
    const html = await renderParentSupport();
    // Form + list gone, EN and (cookie-driven AR) labels alike.
    expect(html).not.toContain('name="subject"');
    expect(html).not.toContain('name="body"');
    expect(html).not.toContain("support-form");
    expect(html).not.toContain("My requests");
    expect(html).not.toContain("Send a support request");
    // The unavailable card (Chatwoot unconfigured in this suite) must not
    // resurrect a request-form exit.
    expect(html).not.toContain('href="#');
  });

  it("the page module no longer imports the parent ticket action or ticket list", () => {
    const source = readFileSync(
      path.join(repoRoot, "app/child/support/page.tsx"),
      "utf8",
    );
    expect(source).not.toContain("createSupportTicketAction");
    expect(source).not.toContain("ticketsForAccount");
  });

  it("the staff ticket action and staff inbox stay untouched (historical use)", () => {
    const actions = readFileSync(path.join(repoRoot, "lib/actions.ts"), "utf8");
    expect(actions).toContain("export async function createSupportTicketAction");
  });

  it("the ticket-only help i18n keys are gone from BOTH dictionaries", () => {
    for (const dict of [dictionaries.en, dictionaries.ar]) {
      const help = dict.help as Record<string, unknown>;
      for (const key of [
        "sendRequest",
        "myRequests",
        "noRequests",
        "formSubject",
        "formSubjectPlaceholder",
        "formMessage",
        "requestSent",
        "requestIntro",
      ]) {
        expect(help[key]).toBeUndefined();
      }
      // Chat-bubble copy replaces the request copy.
      expect(help.noResultsHint).toBe(
        dict === dictionaries.en
          ? "Try fewer or different words, or chat with us from the support bubble."
          : "جرّب كلمات مختلفة أو أقلّ، أو تحدث معنا عبر فقاعة الدعم.",
      );
      expect(String(help.unavailableHint)).not.toContain("send a request");
      expect(String(help.unavailableHint)).not.toContain("إرسال طلب");
    }
  });

  it("EN + AR help dictionaries keep the same key set (parity gate)", () => {
    const enKeys = Object.keys(dictionaries.en.help as object).sort();
    const arKeys = Object.keys(dictionaries.ar.help as object).sort();
    expect(arKeys).toEqual(enKeys);
  });

  it("the Chatwoot live-chat widget is still mounted on the parent app shell", () => {
    const layoutSource = readFileSync(path.join(repoRoot, "app/layout.tsx"), "utf8");
    expect(layoutSource).toContain("ChatwootWidget");
  });
});

describe("KID-478 item 8: Supplies and Rooms live in the Children group, not Tools", () => {
  const childrenGroup = (role?: string) =>
    portalNav(dictionaries.en as never, role).find((g) => g.href === "/portal/children")!;
  const toolsGroup = (role?: string) =>
    portalNav(dictionaries.en as never, role).find((g) => g.href === "/portal/report-center");

  it("admin roles see Supplies and Rooms under Children", () => {
    for (const role of ["owner", "admin"] as const) {
      const children = childrenGroup(role).items.map((i) => i.href);
      expect(children).toContain("/portal/supplies");
      expect(children).toContain("/portal/rooms");
      expect(children[0]).toBe("/portal/children");
    }
  });

  it("Supplies and Rooms are gone from the Tools group", () => {
    for (const role of ["owner", "admin"] as const) {
      const tools = toolsGroup(role)!.items.map((i) => i.href);
      expect(tools).not.toContain("/portal/supplies");
      expect(tools).not.toContain("/portal/rooms");
    }
  });

  it("non-admin roles see neither Tools nor the two moved items anywhere", () => {
    for (const role of ["staff", "carer", "parent"] as const) {
      const groups = portalNav(dictionaries.en as never, role);
      expect(groups.find((g) => g.href === "/portal/report-center")).toBeUndefined();
      for (const group of groups) {
        const hrefs = group.items.map((i) => i.href);
        expect(hrefs).not.toContain("/portal/supplies");
        expect(hrefs).not.toContain("/portal/rooms");
      }
    }
  });

  it("labels come from the active locale dictionary in EN and AR", () => {
    for (const locale of ["en", "ar"] as const) {
      const dict = dictionaries[locale];
      const children = portalNav(dict as never, "owner").find(
        (g) => g.href === "/portal/children"
      )!;
      const supplies = children.items.find((i) => i.href === "/portal/supplies")!;
      const rooms = children.items.find((i) => i.href === "/portal/rooms")!;
      expect(supplies.label).toBe(tr(dict, "nav.supplies"));
      expect(rooms.label).toBe(tr(dict, "nav.rooms"));
    }
    expect(dictionaries.ar.nav.supplies).toBe("المستلزمات");
  });

  it("no dead links: both moved routes still resolve to real page modules", async () => {
    // Importing a page module directly fails if the route file is gone.
    await import("@/app/portal/supplies/page");
    await import("@/app/portal/rooms/page");
  });

  it("every Children-group href maps to a real route (dead-link gate)", () => {
    const children = childrenGroup("owner");
    expect(children.items.length).toBeGreaterThan(0);
    for (const item of children.items) {
      expect(item.href.startsWith("/portal/")).toBe(true);
    }
  });
});
