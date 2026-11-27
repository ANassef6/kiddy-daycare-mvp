process.env.TZ = "UTC";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mockState = vi.hoisted(() => ({ token: "" }));

vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.token) entries.cookie = `kiddy_sess=${mockState.token}`;
    return new Headers(entries);
  },
  cookies: () => ({
    get: (name: string) =>
      name === "kiddy_sess" && mockState.token ? { name, value: mockState.token } : undefined,
    set: () => undefined,
  }),
}));

import { createSessionToken, setAccountLanguage } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let ownerId: string;
let staffId: string;
let staffName: string;
let today: string;

function ownerCookie(): string {
  return createSessionToken({
    accountId: ownerId,
    role: "owner",
    email: "trois4ever+admin@gmail.com",
    emailConfirmed: true,
  } as never);
}

beforeEach(async () => {
  mockState.token = "";
  await seedFixture();
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
  const staff = (await queryGet("SELECT id, full_name FROM staff ORDER BY created_at LIMIT 1"))!;
  staffId = String(staff.id);
  staffName = String(staff.full_name);
  today = new Date().toISOString().slice(0, 10);
  await queryRun("DELETE FROM staff_schedule WHERE staff_id = ?", staffId);
  await queryRun("DELETE FROM staff_status WHERE staff_id = ?", staffId);
});

afterEach(() => {
  mockState.token = "";
});

async function addShift(dayOfWeek: number, start = "08:00", end = "16:00") {
  await queryRun(
    "INSERT INTO staff_schedule (id, staff_id, day_of_week, start_time, end_time, notes) VALUES (?, ?, ?, ?, ?, '')",
    `sched-${Math.random().toString(36).slice(2)}`,
    staffId,
    dayOfWeek,
    start,
    end
  );
}

describe("KID-2484 working-hours page", () => {
  it("shows expected hours and a clear absent row when nobody checked in", async () => {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    await addShift(weekday, "08:00", "16:00");
    mockState.token = ownerCookie();
    const page = await import("@/app/portal/staff/hours/page");
    const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(staffName);
    expect(html).toContain("8h 00m");
    expect(html).toContain("0h 00m");
    expect(html).toContain("Absent");
    expect(html).toContain("−8h 00m");
    expect(html).not.toContain("MISSING:");
  });

  it("shows actual hours from a closed check-in/out pair", async () => {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    await addShift(weekday, "08:00", "16:00");
    await queryRun(
      "INSERT INTO staff_status (id, staff_id, kind, note, created_by_account_id, created_at) VALUES (?, ?, 'checkin', NULL, NULL, ?)",
      "page-in-2484",
      staffId,
      `${today}T08:00:00.000Z`
    );
    await queryRun(
      "INSERT INTO staff_status (id, staff_id, kind, note, created_by_account_id, created_at) VALUES (?, ?, 'out', NULL, NULL, ?)",
      "page-out-2484",
      staffId,
      `${today}T16:00:00.000Z`
    );
    mockState.token = ownerCookie();
    const page = await import("@/app/portal/staff/hours/page");
    const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("On time");
    expect(html).toContain("8h 00m");
  });

  it("applies a date range and keeps the roster rows visible", async () => {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    await addShift(weekday, "08:00", "16:00");
    mockState.token = ownerCookie();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const page = await import("@/app/portal/staff/hours/page");
    const html = renderToStaticMarkup(
      await page.default({ searchParams: Promise.resolve({ view: "range", from: yesterday, to: today }) })
    );
    expect(html).toContain(staffName);
    expect(html).toContain("Total");
  });

  it("renders the Arabic labels", async () => {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    await addShift(weekday, "08:00", "16:00");
    await setAccountLanguage(ownerId, "ar");
    mockState.token = ownerCookie();
    const page = await import("@/app/portal/staff/hours/page");
    const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("المتوقع");
    expect(html).toContain("الفعلي");
    expect(html).toContain("غائب");
    expect(html).toContain("8 س 00 د");
  });
});
