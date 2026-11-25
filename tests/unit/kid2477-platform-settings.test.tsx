// KID-2477: the per-daycare platform Billing section becomes Settings.
//
// Pinned here:
//   1. The old /billing and /invoices URLs redirect to their Settings
//      sub-pages and keep the query string (?tab=insights, ?saved=1, ?error=…).
//   2. The Settings root redirects to Billing.
//   3. The Settings nav lists Billing, Invoices and Center configuration.
//   4. Center configuration is read-only (no form/input) and reports the
//      parent check-in/out toggle, working hours and time zone.
//   5. A non-operator cannot open the center view.
//   6. EN + AR labels ship for every new string.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  cookies: {} as Record<string, string>,
}));
vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.cookie) entries.cookie = mockState.cookie;
    return new Headers(entries);
  },
  cookies: () => ({
    get: (name: string) =>
      mockState.cookies[name] ? { name, value: mockState.cookies[name] } : undefined,
    set: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
    err.digest = `NEXT_REDIRECT;replace;${url};`;
    throw err;
  },
}));

import { createSessionToken } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { dictionaries, keysOf } from "@/lib/i18n";
import { seedFixture } from "../helpers";

let sunshineIid: string;
let superadminId: string;

function sessionCookieFor(accountId: string, role: string, email: string): string {
  const token = createSessionToken({ accountId, role, email, emailConfirmed: true });
  mockState.cookies = { kiddy_sess: token };
  mockState.cookie = `kiddy_sess=${token}`;
  return mockState.cookie;
}

async function redirectTargetFor(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    throw new Error("expected a redirect");
  } catch (err) {
    const digest = String((err as Error & { digest?: string })?.digest ?? "");
    const match = /NEXT_REDIRECT;replace;([^;]+);/.exec(digest);
    if (match) return match[1];
    throw err;
  }
}

beforeEach(async () => {
  mockState.cookie = "";
  mockState.cookies = {};
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  superadminId = String(
    (await queryGet("SELECT id FROM account WHERE email = 'superadmin@kiddy.test'"))!.id
  );
});

describe("KID-2477: legacy URLs redirect into Settings", () => {
  it("the old billing URL forwards to Settings → Billing and keeps the query", async () => {
    const { default: LegacyBilling } = await import(
      "@/app/platform/daycares/[id]/billing/page"
    );
    // A bookmarked Insights tab lands on the same tab under Settings.
    expect(
      await redirectTargetFor(() =>
        LegacyBilling({
          params: Promise.resolve({ id: "inst-1" }),
          searchParams: Promise.resolve({ tab: "insights", days: "7" }),
        })
      )
    ).toBe("/platform/daycares/inst-1/settings/billing?tab=insights&days=7");
  });

  it("the old invoices URL forwards to Settings → Invoices and keeps the query", async () => {
    const { default: LegacyInvoices } = await import(
      "@/app/platform/daycares/[id]/invoices/page"
    );
    expect(
      await redirectTargetFor(() =>
        LegacyInvoices({
          params: Promise.resolve({ id: "inst-1" }),
          searchParams: Promise.resolve({ saved: "1" }),
        })
      )
    ).toBe("/platform/daycares/inst-1/settings/invoices?saved=1");
  });

  it("the Settings root opens the Billing tab", async () => {
    const { default: SettingsIndex } = await import("@/app/platform/daycares/[id]/settings/page");
    expect(
      await redirectTargetFor(() =>
        SettingsIndex({ params: Promise.resolve({ id: "inst-1" }) })
      )
    ).toBe("/platform/daycares/inst-1/settings/billing");
  });
});

describe("KID-2477: Settings navigation", () => {
  it("lists Billing, Invoices and Center configuration", async () => {
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { default: Layout } = await import("@/app/platform/daycares/[id]/settings/layout");
    const html = renderToStaticMarkup(
      await Layout({
        params: Promise.resolve({ id: sunshineIid }),
        children: <span>child</span>,
      })
    );
    expect(html).toContain("Settings");
    expect(html).toContain("Billing");
    expect(html).toContain("Invoices");
    expect(html).toContain("Center configuration");
    expect(html).toContain(`href="/platform/daycares/${sunshineIid}/settings/billing"`);
    expect(html).toContain(`href="/platform/daycares/${sunshineIid}/settings/invoices"`);
    expect(html).toContain(`href="/platform/daycares/${sunshineIid}/settings/center"`);
  });
});

describe("KID-2477: read-only center configuration", () => {
  it("reports the toggle, working hours and time zone without a form", async () => {
    await queryRun(
      "UPDATE institute SET allow_parent_check_inout = 0, timezone = 'Africa/Cairo', opening_hours = ? WHERE id = ?",
      JSON.stringify({ "1": { open: "07:00", close: "18:00" } }),
      sunshineIid
    );
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { default: Page } = await import("@/app/platform/daycares/[id]/settings/center/page");
    const html = renderToStaticMarkup(
      await Page({ params: Promise.resolve({ id: sunshineIid }) })
    );
    expect(html).toContain("Center configuration");
    expect(html).toContain("Not allowed");
    expect(html).toContain("07:00");
    expect(html).toContain("18:00");
    expect(html).toContain("Africa/Cairo");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
  });

  it("says so when no working hours are configured", async () => {
    await queryRun("UPDATE institute SET opening_hours = '' WHERE id = ?", sunshineIid);
    sessionCookieFor(superadminId, "platform", "superadmin@kiddy.test");
    const { default: Page } = await import("@/app/platform/daycares/[id]/settings/center/page");
    const html = renderToStaticMarkup(
      await Page({ params: Promise.resolve({ id: sunshineIid }) })
    );
    expect(html).toContain("No working hours are set.");
  });

  it("a non-operator is bounced to /login", async () => {
    const owner = await queryGet("SELECT id, email FROM account WHERE role = 'owner'");
    sessionCookieFor(String(owner!.id), "owner", String(owner!.email));
    const { default: Page } = await import("@/app/platform/daycares/[id]/settings/center/page");
    expect(
      await redirectTargetFor(() => Page({ params: Promise.resolve({ id: sunshineIid }) }))
    ).toBe("/login");
  });
});

describe("KID-2477: EN + AR labels", () => {
  it("every new label exists in both dictionaries", () => {
    const required = [
      "platform.settingsSectionTitle",
      "platform.settingsNavBilling",
      "platform.settingsNavInvoices",
      "platform.settingsNavCenter",
      "platform.centerConfigTitle",
      "platform.centerConfigHint",
      "platform.centerCheckInOutTitle",
      "platform.centerCheckInOutAllowed",
      "platform.centerCheckInOutBlocked",
      "platform.centerCheckInOutHint",
      "platform.centerWorkingHoursTitle",
      "platform.centerWorkingHoursUnset",
      "platform.centerWorkingHoursHint",
      "platform.centerClosed",
      "platform.centerTimezoneTitle",
      "platform.centerTimezoneHint",
    ];
    const enKeys = keysOf(dictionaries.en);
    const arKeys = keysOf(dictionaries.ar);
    for (const key of required) {
      expect(enKeys, `en:${key}`).toContain(key);
      expect(arKeys, `ar:${key}`).toContain(key);
    }
  });
});
