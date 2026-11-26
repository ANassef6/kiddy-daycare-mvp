// KID-2502: /portal/staff/schedule and /portal/staff/hours are admin-only.
// Non-admin staff are redirected to their own profile (where their schedule
// still renders), and the sidebar hides both items for them.

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

import { createAccount, createSessionToken } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { createStaff } from "@/lib/store";
import { dictionaries } from "@/lib/i18n";
import { portalNav } from "@/components/PortalSidebar";
import { seedFixture } from "../helpers";

let ownerId = "";
let staffId = "";
let staffAccountId = "";

function cookieFor(accountId: string, role: string): string {
  return `kiddy_sess=${encodeURIComponent(
    createSessionToken({
      accountId,
      role,
      email: `${role}@kid2502.test`,
      emailConfirmed: true,
    })
  )}`;
}

async function expectRedirect(run: () => Promise<unknown>, target: string): Promise<void> {
  try {
    await run();
  } catch (err) {
    const digest = String((err as { digest?: string })?.digest ?? "");
    expect(digest).toContain(`NEXT_REDIRECT;replace;${target};`);
    return;
  }
  throw new Error(`expected a redirect to ${target}`);
}

beforeEach(async () => {
  mockHeaders = {};
  mockCookies = {};
  await seedFixture();
  const iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  ownerId = String(
    (await queryGet("SELECT id FROM account WHERE email = 'trois4ever+admin@gmail.com'"))!.id
  );
  const staff = await createStaff({
    instituteId: iid,
    fullName: "KID-2502 Teacher",
    role: "staff",
  });
  staffId = String(staff.id);
  const account = await createAccount({
    email: `kid2502-teacher-${Math.random().toString(36).slice(2)}@test.local`,
    password: "teacher-pass",
    fullName: "KID-2502 Teacher",
    role: "staff",
  });
  staffAccountId = String(account.id);
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", staffId, staffAccountId);
});

afterEach(() => {
  mockHeaders = {};
  mockCookies = {};
});

describe("KID-2502 server role gate", () => {
  it("redirects a non-admin away from the schedule page to their own profile", async () => {
    mockHeaders = { host: "daycare.test", cookie: cookieFor(staffAccountId, "staff") };
    const page = await import("@/app/portal/staff/schedule/page");
    await expectRedirect(
      () => page.default({ searchParams: Promise.resolve({}) }),
      `/portal/staff/${staffId}`
    );
  });

  it("redirects a non-admin away from the working-hours page to their own profile", async () => {
    mockHeaders = { host: "daycare.test", cookie: cookieFor(staffAccountId, "staff") };
    const page = await import("@/app/portal/staff/hours/page");
    await expectRedirect(
      () => page.default({ searchParams: Promise.resolve({}) }),
      `/portal/staff/${staffId}`
    );
  });

  it("keeps both pages open to owners", async () => {
    mockHeaders = { host: "daycare.test", cookie: cookieFor(ownerId, "owner") };

    const schedule = await import("@/app/portal/staff/schedule/page");
    const scheduleHtml = renderToStaticMarkup(
      await schedule.default({ searchParams: Promise.resolve({}) })
    );
    expect(scheduleHtml).toContain("Staff schedule");

    const hours = await import("@/app/portal/staff/hours/page");
    const hoursHtml = renderToStaticMarkup(
      await hours.default({ searchParams: Promise.resolve({}) })
    );
    expect(hoursHtml).toContain("Working hours");
  });
});

describe("KID-2502 sidebar visibility", () => {
  const staffGroup = (role: string) =>
    portalNav(dictionaries.en, role).find((group) => group.href === "/portal/staff")!;

  it("shows only the profile item to non-admin staff", () => {
    for (const role of ["staff", "carer"]) {
      const hrefs = staffGroup(role).items.map((item) => item.href);
      expect(hrefs).toEqual(["/portal/staff"]);
    }
  });

  it("keeps both admin items for owner and admin roles", () => {
    for (const role of ["owner", "admin"]) {
      const hrefs = staffGroup(role).items.map((item) => item.href);
      expect(hrefs).toContain("/portal/staff/schedule");
      expect(hrefs).toContain("/portal/staff/hours");
    }
  });
});
