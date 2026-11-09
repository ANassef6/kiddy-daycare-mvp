// KID-536 (KID-472 D-3 follow-up): one explicit "today" rule for daily reports.
//
// The rule: "today" for daily-report surfaces is the UTC calendar day,
// computed once by todayIso() in lib/report-dates.ts and passed explicitly to
// every client surface — the browser clock is never consulted for report data.
//
// Pinned here:
//   1. todayIso() returns the UTC day at an instant where a UTC-05/06 browser
//      (America/New_York) still shows the previous calendar day — the exact
//      QA D-3 boundary between browser-local and UTC dates.
//   2. Staff editor and parent read view default to that SAME UTC day and
//      render the same record when no ?date= is passed.
//   3. saveDailyReportAction with no reportDate field saves the same UTC day
//      (the lib/actions.ts fallback is todayIso(), not its own copy).
//   4. Past-day navigation boundaries still clamp at max(selected, todayIso())
//      — the strip never reaches past the UTC day and never flips days.
//
// Harness: the kid472-daily-report-date-nav mocked-headers pattern (SQLite
// fixture, no server); server pages rendered with renderToStaticMarkup. The
// fake clock only fakes `Date` (toFake: ["Date"]) so awaited DB calls keep
// running on real timers.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as store from "@/lib/store";
import { createSessionToken, type Session } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";
import { recentDatesUpTo, shiftIsoDate, todayIso } from "@/lib/report-dates";

const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  host: "" as string,
  cookies: {} as Record<string, string>,
}));
vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.cookie) entries.cookie = mockState.cookie;
    if (mockState.host) entries.host = mockState.host;
    return new Headers(entries);
  },
  cookies: () => ({
    get: (name: string) => (mockState.cookies[name] ? { name, value: mockState.cookies[name] } : undefined),
    set: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
  redirect: () => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import StaffChildPage from "@/app/portal/children/[id]/page";
import ParentChildPage from "@/app/child/[id]/page";
import { saveDailyReportAction } from "@/lib/actions";

// The QA D-3 boundary instant: UTC has crossed midnight into 2026-03-09 while
// a browser in America/New_York (e.g. the QA operator's UTC offset) is still
// on 2026-03-08 at 19:30. Anywhere the app consults a browser-local or
// server-local calendar day, the two roles disagree here.
const BOUNDARY = "2026-03-09T00:30:00Z";
const UTC_DAY = "2026-03-09";
const NY_DAY = "2026-03-08";

function fakeUtcClock(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(BOUNDARY));
}

// The NEW-YORK calendar day of the boundary instant, computed through Intl so
// the assertion is independent of whatever timezone the CI runner is in.
const nyBrowserDay = (at: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(at);

function sessionCookieFor(accountId: string, role: string, email: string): string {
  const session: Session = { accountId, role, email, emailConfirmed: true };
  const token = createSessionToken(session);
  mockState.cookies = { kiddy_sess: token };
  return `kiddy_sess=${token}`;
}

let ownerId: string;
let parentAccountId: string;
let ella: string;

beforeEach(async () => {
  await seedFixture();
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner'"))!.id);
  parentAccountId = String((await queryGet(`SELECT id FROM account WHERE email = 'parent@example.test'`))!.id);
  ella = String((await queryGet(`SELECT id FROM child WHERE first_name = 'Ella'`))!.id);
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
});

const UTC_REPORT = "KID536: report stored under the UTC day 2026-03-09.";
const NY_REPORT = "KID536: report stored under the NY day 2026-03-08.";

async function seedBoundaryReports(): Promise<void> {
  await store.upsertDailyReport({ childId: ella, reportDate: UTC_DAY, summary: UTC_REPORT, accountId: ownerId });
  await store.upsertDailyReport({ childId: ella, reportDate: NY_DAY, summary: NY_REPORT, accountId: ownerId });
}

async function renderStaff(date?: string): Promise<string> {
  mockState.cookie = sessionCookieFor(ownerId, "owner", "trois4ever+admin@gmail.com");
  return renderToStaticMarkup(
    await StaffChildPage({ params: Promise.resolve({ id: ella }), searchParams: Promise.resolve(date ? { date } : {}) })
  );
}

async function renderParent(date?: string): Promise<string> {
  mockState.cookie = sessionCookieFor(parentAccountId, "parent", "parent@example.test");
  return renderToStaticMarkup(
    await ParentChildPage({ params: Promise.resolve({ id: ella }), searchParams: Promise.resolve(date ? { date } : {}) })
  );
}

describe("KID-536: the explicit today rule is the UTC calendar day", () => {
  it("todayIso() returns the UTC day where the NY browser day differs", () => {
    fakeUtcClock();
    try {
      const at = new Date();
      expect(nyBrowserDay(at)).toBe(NY_DAY);
      expect(at.toISOString().slice(0, 10)).toBe(UTC_DAY);
      expect(nyBrowserDay(at)).not.toBe(UTC_DAY);
      // The rule must be UTC — neither a browser-local nor a server-local day.
      expect(todayIso()).toBe(UTC_DAY);
      expect(todayIso()).not.toBe(NY_DAY);
    } finally {
      vi.useRealTimers();
    }
  });

  it("past-day navigation math stays anchored on the same UTC day", () => {
    fakeUtcClock();
    try {
      expect(shiftIsoDate(UTC_DAY, -1)).toBe(NY_DAY);
      // The 7-day strip ends at max(selected, todayIso()) — anchored to the
      // UTC day inside recentDatesUpTo, so a past selection clamps there.
      const strip = recentDatesUpTo(NY_DAY, 7);
      expect(strip.length).toBe(7);
      expect(strip[strip.length - 1]).toBe(UTC_DAY);
    } finally {
      vi.useRealTimers();
    }
  });

  it("staff editor and parent read view open the SAME UTC-day record by default", async () => {
    fakeUtcClock();
    try {
      await seedBoundaryReports();
      const staff = await renderStaff();
      const parent = await renderParent();

      // Both default to the UTC day: the NY browser local day (03-08) record
      // is NOT what either role opens — that was the D-3 divergence.
      expect(staff).toContain(UTC_REPORT);
      expect(staff).not.toContain(NY_REPORT);
      expect(parent).toContain(UTC_REPORT);
      expect(parent).not.toContain(NY_REPORT);

      // Both date navs carry the same UTC day as the selection + future
      // boundary (max), derived on the server and passed explicitly.
      expect(staff).toContain(`max="${UTC_DAY}"`);
      expect(parent).toContain(`max="${UTC_DAY}"`);
      expect(staff).toContain('data-testid="daily-report-date-nav"');
      expect(parent).toContain('data-testid="daily-report-date-nav"');
    } finally {
      vi.useRealTimers();
    }
  });

  it("staff save with no reportDate field lands on the same UTC day as the views", async () => {
    fakeUtcClock();
    try {
      mockState.cookie = sessionCookieFor(ownerId, "owner", "trois4ever+admin@gmail.com");
      const fd = new FormData();
      fd.set("childId", ella);
      fd.set("summary", "KID536 fallback save without a date field.");
      await expect(saveDailyReportAction(fd)).rejects.toThrow("NEXT_REDIRECT");
      const row = await store.reportFor(ella, UTC_DAY);
      expect(row).toBeDefined();
      expect(String(row!.summary)).toBe("KID536 fallback save without a date field.");
      expect(await store.reportFor(ella, NY_DAY)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("past-day navigation reaches the correct records at the boundary", async () => {
    fakeUtcClock();
    try {
      await seedBoundaryReports();
      // Navigating one day back from the boundary UTC day = the NY day record.
      const date = shiftIsoDate(UTC_DAY, -1);
      const staff = await renderStaff(date);
      const parent = await renderParent(date);
      expect(staff).toContain(NY_REPORT);
      expect(parent).toContain(NY_REPORT);
      expect(staff).not.toContain(UTC_REPORT);
      expect(parent).not.toContain(UTC_REPORT);
      // The strip clamps at max(selected, today) = the past selection, so no
      // future chip and the selected day carries the strip's title.
      expect(staff).toContain(`title="${date}"`);
      expect(staff).not.toContain(`title="${UTC_DAY}"`);
    } finally {
      vi.useRealTimers();
    }
  });
});
