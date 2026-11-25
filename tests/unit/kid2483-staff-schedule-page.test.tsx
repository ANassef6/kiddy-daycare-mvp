// KID-2483: the schedule page and dashboard render the new date/room data in
// both locales. These are real server-page renders against the seeded SQLite
// fixture (same harness style as kid368-def004-ar-i18n.test.tsx).

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

import { createSessionToken, setAccountLanguage } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { createStaffSchedule } from "@/lib/store";
import { seedFixture } from "../helpers";
import { fmtDateFor } from "@/lib/i18n";

let ownerAccountId: string;
let staffId: string;
let toddlers: string;
let preschool: string;

function ownerCookie(): string {
  return `kiddy_sess=${encodeURIComponent(
    createSessionToken({
      accountId: ownerAccountId,
      role: "owner",
      email: "trois4ever+admin@gmail.com",
      emailConfirmed: true,
    })
  )}`;
}

async function renderSchedulePage(): Promise<string> {
  mockHeaders = { host: "daycare.test", cookie: ownerCookie() };
  const page = await import("@/app/portal/staff/schedule/page");
  return renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
}

async function renderDashboard(): Promise<string> {
  mockHeaders = { host: "daycare.test", cookie: ownerCookie() };
  const page = await import("@/app/portal/dashboard/page");
  return renderToStaticMarkup(await page.default());
}

beforeEach(async () => {
  mockHeaders = {};
  mockCookies = {};
  await seedFixture();
  const owner = await queryGet("SELECT id FROM account WHERE email = 'trois4ever+admin@gmail.com'");
  ownerAccountId = String(owner!.id);
  staffId = String((await queryGet("SELECT id FROM staff ORDER BY full_name LIMIT 1"))!.id);
  toddlers = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers' LIMIT 1"))!.id);
  preschool = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool' LIMIT 1"))!.id);
});

afterEach(() => {
  mockHeaders = {};
  mockCookies = {};
});

describe("KID-2483: schedule page render", () => {
  it("shows the specific date, times, and rooms in English", async () => {
    await createStaffSchedule({
      staffId,
      scheduleDate: "2026-01-01",
      startTime: "08:00",
      endTime: "16:00",
      roomIds: [toddlers, preschool],
    });
    await setAccountLanguage(ownerAccountId, "en");

    const html = await renderSchedulePage();
    expect(html).toContain("Specific date");
    expect(html).toContain(fmtDateFor("en", "2026-01-01"));
    expect(html).toContain("08:00–16:00");
    expect(html).toContain("Rooms: Preschool, Toddlers");
    expect(html).toContain("Repeat until");
  });

  it("shows the same entry in Arabic", async () => {
    await createStaffSchedule({
      staffId,
      scheduleDate: "2026-01-01",
      startTime: "08:00",
      endTime: "16:00",
      roomIds: [toddlers, preschool],
    });
    await setAccountLanguage(ownerAccountId, "ar");

    const html = await renderSchedulePage();
    expect(html).toContain("تاريخ محدد");
    expect(fmtDateFor("ar", "2026-01-01")).toBeTruthy();
    expect(html).toContain("الفصول: Preschool, Toddlers");
    expect(html).toContain("التكرار حتى");
  });

  it("keeps a legacy weekday-only shift visible", async () => {
    await createStaffSchedule({ staffId, dayOfWeek: 1, startTime: "09:00", endTime: "17:00" });
    await setAccountLanguage(ownerAccountId, "en");

    const html = await renderSchedulePage();
    expect(html).toContain("Weekly");
    expect(html).toContain("09:00–17:00");
  });
});

describe("KID-2483: dashboard render", () => {
  it("lists today's dated staff shift with its rooms", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await createStaffSchedule({
      staffId,
      scheduleDate: today,
      startTime: "07:30",
      endTime: "15:30",
      roomIds: [toddlers],
    });
    await setAccountLanguage(ownerAccountId, "en");

    const html = await renderDashboard();
    expect(html).toContain("Staff on duty today");
    expect(html).toContain("07:30–15:30");
    expect(html).toContain("Toddlers");
    expect(html).not.toContain("No staff scheduled for today.");
  });

  it("renders the empty state in Arabic when nobody is scheduled", async () => {
    await setAccountLanguage(ownerAccountId, "ar");

    const html = await renderDashboard();
    expect(html).toContain("الموظفون في الخدمة اليوم");
    expect(html).toContain("لا يوجد موظفون مجدولون اليوم.");
  });
});
