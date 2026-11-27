// KID-2496 acceptance: a 16:34 Cairo check-in must render as 16:34 on the
// attendance board, the dashboard, and the child profile even though the
// server process runs in UTC. Real server-page renders against seeded SQLite.

process.env.TZ = "UTC";

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
// The attendance board mounts client-only controls; stub them so the server
// render focuses on the timestamp cells (no app-router context in a unit test).
vi.mock("@/components/AttendanceCheckIn", () => ({
  AttendanceCheckIn: () => <span>check-in-control</span>,
}));
vi.mock("@/components/BusStatusButtons", () => ({
  BusStatusButtons: () => <span>bus-control</span>,
}));

import { createSessionToken } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { fmtTimeFor } from "@/lib/i18n";
import { resetDb } from "../helpers";
import { seedDemo } from "@/lib/seed";

const CAIRO = "Africa/Cairo";
// 2026-11-11 is a Wednesday. 16:34 Cairo (EET, UTC+2) is 14:34Z.
const CHECK_IN = "2026-11-11T14:34:00.000Z";

let ownerAccountId: string;
let childId: string;
let childFirst: string;

function ownerCookie(): string {
  return `kiddy_sess=${encodeURIComponent(
    createSessionToken({
      accountId: ownerAccountId,
      role: "owner",
      email: "owner@example.test",
      emailConfirmed: true,
    })
  )}`;
}

async function renderAttendance(day: string): Promise<string> {
  mockHeaders = { host: "daycare.test", cookie: ownerCookie() };
  const page = await import("@/app/portal/attendance/page");
  return renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ day }) }));
}

async function renderDashboard(): Promise<string> {
  mockHeaders = { host: "daycare.test", cookie: ownerCookie() };
  const page = await import("@/app/portal/dashboard/page");
  return renderToStaticMarkup(await page.default());
}

async function renderChildProfile(id: string): Promise<string> {
  mockHeaders = { host: "daycare.test", cookie: ownerCookie() };
  const page = await import("@/app/child/[id]/page");
  return renderToStaticMarkup(
    await page.default({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })
  );
}

async function insertCheckIn(recordedAt: string): Promise<void> {
  await queryRun(
    "INSERT INTO check_in (id, child_id, account_id, type, is_edit, recorded_at) VALUES (?, ?, ?, 'in', 0, ?)",
    crypto.randomUUID(),
    childId,
    ownerAccountId,
    recordedAt
  );
}

beforeEach(async () => {
  mockHeaders = {};
  mockCookies = {};
  await resetDb();
  await seedDemo();
  await queryRun("UPDATE institute SET timezone = ?", CAIRO);
  // Keep the auto check-out sweep out of these display assertions: the seeded
  // center closes at 18:00 Cairo, and the dashboard renders the current clock,
  // so a run after closing would sweep the just-inserted check-in to "out".
  await queryRun(
    "UPDATE institute SET opening_hours = ?",
    JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 7 }, (_, day) => [String(day), { open: "00:00", close: "23:59" }])
      )
    )
  );
  const owner = await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1");
  ownerAccountId = String(owner!.id);
  const child = await queryGet("SELECT id, first_name FROM child ORDER BY first_name LIMIT 1");
  childId = String(child!.id);
  childFirst = String(child!.first_name);
});

afterEach(() => {
  mockHeaders = {};
  mockCookies = {};
});

describe("KID-2496: Cairo check-in renders on the center clock", () => {
  it("attendance board shows 16:34 for a 14:34Z check-in", async () => {
    await insertCheckIn(CHECK_IN);
    const html = await renderAttendance("2026-11-11");
    expect(html).toContain(childFirst);
    expect(html).toContain("16:34");
    expect(html).not.toContain("14:34");
    expect(fmtTimeFor("en", CHECK_IN, "UTC")).toBe("14:34");
  });

  it("dashboard shows the live check-in on the Cairo clock, not UTC", async () => {
    const recordedAt = new Date().toISOString();
    await insertCheckIn(recordedAt);
    const html = await renderDashboard();
    const cairo = fmtTimeFor("en", recordedAt, CAIRO);
    const utc = fmtTimeFor("en", recordedAt, "UTC");
    expect(cairo).not.toBe(utc);
    expect(html).toContain(cairo);
    expect(html).not.toContain(utc);
  });

  it("child profile shows the check-in on the Cairo clock, not UTC", async () => {
    const recordedAt = new Date().toISOString();
    await insertCheckIn(recordedAt);
    const html = await renderChildProfile(childId);
    const cairo = fmtTimeFor("en", recordedAt, CAIRO);
    const utc = fmtTimeFor("en", recordedAt, "UTC");
    expect(cairo).not.toBe(utc);
    expect(html).toContain(cairo);
    expect(html).not.toContain(utc);
  });
});
