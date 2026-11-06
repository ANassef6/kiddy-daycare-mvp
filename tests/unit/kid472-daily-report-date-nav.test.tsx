// KID-472 item 4: the daily report is date-navigable for staff AND parents.
//
// Pinned here:
//   1. Server-side date selection: `?date=` (validated — garbage/missing falls
//      back to today) drives reportFor() on the staff editor and the parent
//      read view; today remains the default.
//   2. Selected-date save: the report saved for a past date lands on
//      (child_id, report_date) that day and is retrievable via reportFor —
//      parent can then open the same past date and see the saved values.
//   3. Permissions: the existing KID-103/KID-372 scope guards are untouched by
//      the date feature — an out-of-scope child is refused at read AND the
//      save action redirects to the scope error without writing a row, even
//      with a valid past date in hand. (kid372 family-visibility contract.)
//   4. Parent read-only: the parent child profile renders the selected-day
//      report read-only (no report form/textarea on the surface) with a clear
//      empty state for a day with no report.
//   5. i18n: the new nav/heading keys ship in BOTH dictionaries.
//   6. Mobile API: childSummary's `?date=` extension defaults byte-for-byte to
//      the today payload when no date is passed.
//
// Harness: the kid246/kid372 mocked-headers pattern (SQLite fixture, no
// server); server pages rendered with renderToStaticMarkup; react-dom 'use
// client' modules render via the same static pass with useRouter stubbed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as store from "@/lib/store";
import { createSessionToken, createAccount, type Session } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { dictionaries, keysOf } from "@/lib/i18n";
import { seedFixture } from "../helpers";
import { shiftIsoDate, configuredReportDate, recentDatesUpTo } from "@/lib/report-dates";

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

function sessionCookieFor(accountId: string, role: string, email: string): string {
  const session: Session = { accountId, role, email, emailConfirmed: true };
  const token = createSessionToken(session);
  // Server actions read cookies().get(SESSION_COOKIE); pages read the Cookie
  // header — arm both paths with the same session token.
  mockState.cookies = { kiddy_sess: token };
  return `kiddy_sess=${token}`;
}

let sunshineIid: string;
let ownerId: string;
let parentAccountId: string;
let ella: string;
const todayIso = (): string => new Date().toISOString().slice(0, 10);

beforeEach(async () => {
  await seedFixture();

  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner'"))!.id);
  parentAccountId = String((await queryGet(`SELECT id FROM account WHERE email = 'parent@example.test'`))!.id);
  ella = String((await queryGet(`SELECT id FROM child WHERE first_name = 'Ella'`))!.id);
});

const PAST_SUMMARY = "Kinetic Tuesday: Ella ran the obstacle course for the whole session.";

async function seedPastReport(daysAgo = 3): Promise<string> {
  const date = shiftIsoDate(todayIso(), -daysAgo);
  await store.upsertDailyReport({
    childId: ella,
    reportDate: date,
    summary: PAST_SUMMARY,
    mood: "happy",
    meal: JSON.stringify({ breakfast: "Toast", lunch: "Pasta", snack: "Banana" }),
    accountId: ownerId,
  });
  return date;
}

async function renderStaff(date?: string): Promise<string> {
  mockState.cookie = sessionCookieFor(ownerId, "owner", "trois4ever+admin@gmail.com");
  const html = renderToStaticMarkup(
    await StaffChildPage({ params: { id: ella }, searchParams: date ? { date } : {} })
  );
  return html;
}

async function renderParent(date?: string): Promise<string> {
  mockState.cookie = sessionCookieFor(parentAccountId, "parent", "parent@example.test");
  return renderToStaticMarkup(
    await ParentChildPage({ params: { id: ella }, searchParams: date ? { date } : {} })
  );
}

describe("KID-472 item 4: date helpers", () => {
  it("configuredReportDate falls back for missing, malformed and impossible dates", () => {
    for (const bad of [undefined, null, "", "not-a-date", "2026-2-1", "2026-02-30", "01-02-2026"]) {
      expect(configuredReportDate(bad, "2026-01-05")).toBe("2026-01-05");
    }
    expect(configuredReportDate("2026-02-28", "2026-01-05")).toBe("2026-02-28");
  });

  it("shiftIsoDate crosses month/year boundaries on UTC day math", () => {
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("recentDatesUpTo anchors the window at max(selected, today)", () => {
    const today = todayIso();
    const far = shiftIsoDate(today, -30);
    const window = recentDatesUpTo(far, 7);
    expect(window.length).toBe(7);
    expect(window[window.length - 1]).toBe(today);
    expect(window).not.toContain(far);
  });
});

describe("KID-472 item 4: staff editor loads and saves the selected date", () => {
  it("no date param keeps today's report (default unchanged)", async () => {
    const html = await renderStaff();
    expect(html).toContain("Ella had a great day! Played in the sandbox and did a puzzle.");
    expect(html).toContain('value="' + todayIso() + '"'); // hidden reportDate stays today
    expect(html).not.toContain(PAST_SUMMARY);
  });

  it("?date=<past> loads that day's saved values into the editor for editing", async () => {
    const date = await seedPastReport(4);
    const html = await renderStaff(date);
    expect(html).toContain(PAST_SUMMARY);
    expect(html).toContain(`value="${date}"`); // hidden reportDate + date nav input
    expect(html).not.toContain("Ella had a great day! Played in the sandbox and did a puzzle.");
  });

  it("a malformed ?date= falls back to today instead of a bogus report_date", async () => {
    const html = await renderStaff("../../etc");
    expect(html).toContain('value="' + todayIso() + '"');
    expect(html).toContain("Ella had a great day! Played in the sandbox and did a puzzle.");
  });

  it("saveDailyReportAction writes the selected date's row and redirects back to that date", async () => {
    const date = shiftIsoDate(todayIso(), -6);
    mockState.cookie = sessionCookieFor(ownerId, "owner", "trois4ever+admin@gmail.com");
    const fd = new FormData();
    fd.set("childId", ella);
    fd.set("reportDate", date);
    fd.set("summary", "Saved in the past-day tab.");
    fd.set("breakfast", "Oats");
    fd.set("lunch", "Soup");
    fd.set("snack", "Melon");
    await expect(saveDailyReportAction(fd)).rejects.toThrow("NEXT_REDIRECT");
    const row = await store.reportFor(ella, date);
    expect(row).toBeDefined();
    expect(String(row!.summary)).toBe("Saved in the past-day tab.");
    expect(JSON.parse(String(row!.meal))).toEqual({ breakfast: "Oats", lunch: "Soup", snack: "Melon" });
  });
});

describe("KID-472 item 4: permissions are date-independent", () => {
  it("the parent page still 404s a foreign centre's child even with a valid past date", async () => {
    const mapleRoom = await store.createRoom(sunshineIid, "Sepia Room", 5);
    const mapleChild = await store.createChild({
      instituteId: sunshineIid,
      firstName: "Sepia",
      lastName: "Kid",
      roomId: String(mapleRoom.id),
    });
    mockState.cookie = sessionCookieFor(parentAccountId, "parent", "parent@example.test");
    await expect(
      ParentChildPage({
        params: { id: String(mapleChild.id) },
        searchParams: { date: shiftIsoDate(todayIso(), -2) },
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("saveDailyReportAction refuses an out-of-scope staff member even with a past date (KID-103 fail closed)", async () => {
    // KID-103: parents/owners pass the portal classroom scope by design; the
    // staff variant is the fail-closed path — an unassigned Sunshine staff
    // account (no staff_room records) gets the scope redirect and no write,
    // exactly like kid372 pinned for reads. This guard is untouched by the
    // date selection — the same refusal with a valid past date in hand.
    const staffRow = await store.createStaff({
      instituteId: sunshineIid,
      fullName: "Unassigned Staff",
      role: "teacher",
      // No roomIds — a classroom-carer with no assigned rooms is fail-closed.
    });
    const staff = await createAccount({
      email: "unassigned-472@sunshinedaycare.test",
      password: "kiddy-staff",
      fullName: "Unassigned Staff",
      role: "teacher",
    });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", staffRow.id, staff.id);
    const date = shiftIsoDate(todayIso(), -2);
    mockState.cookie = sessionCookieFor(
      String(staff.id),
      "teacher",
      "unassigned-472@sunshinedaycare.test"
    );
    const fd = new FormData();
    fd.set("childId", ella);
    fd.set("reportDate", date);
    fd.set("summary", "Should never be written.");
    await expect(saveDailyReportAction(fd)).rejects.toThrow("NEXT_REDIRECT");
    expect(await store.reportFor(ella, date)).toBeUndefined();
  });
});

describe("KID-472 item 4: parent read view of the selected day", () => {
  it("today stays the default and renders today's saved report", async () => {
    const html = await renderParent();
    expect(html).toContain("Ella had a great day! Played in the sandbox and did a puzzle.");
    // Read-only: only the daily-report form lives on the staff surface…
    expect(html).not.toContain('id="daily-report-form"');
  });

  it("?date=<past> shows that day's saved report read-only", async () => {
    const date = await seedPastReport(3);
    const html = await renderParent(date);
    expect(html).toContain(PAST_SUMMARY);
    expect(html).toContain("Banana"); // the seeded meals surfaced for the past day
    expect(html).not.toContain('name="summary"'); // no editable textarea on the read view
    expect(html).toContain('value="' + date + '"'); // read-only date nav input carries the selection
  });

  it("a day with no report shows the per-date empty state, not the per-day wording", async () => {
    const date = shiftIsoDate(todayIso(), -5);
    const html = await renderParent(date);
    expect(html).toContain("No report for this date yet.");
    expect(html).not.toContain(PAST_SUMMARY);
  });
});

describe("KID-472 item 4: i18n — both dictionaries ship the nav keys", () => {
  it("profile and child date-nav keys exist in EN and AR", () => {
    for (const ns of ["profile", "child"] as const) {
      const keys = (dict: Record<string, unknown>) =>
        keysOf(dict as never).filter((k) => k.startsWith(ns + "."));
      const wanted = [
        "reportPrevDay",
        "reportNextDay",
        "reportTodayChip",
        "reportPickDate",
      ];
      const en = keys(dictionaries.en);
      const ar = keys(dictionaries.ar);
      for (const k of wanted) {
        expect(en).toContain(`${ns}.${k}`);
        expect(ar).toContain(`${ns}.${k}`);
      }
    }
    expect(dictionaries.en.profile.todaysDailyReport).toBe("Today's daily report");
    expect(dictionaries.ar.profile.todaysDailyReport).toBe("التقرير اليومي لليوم");
    expect(dictionaries.en.child.noReportForDate).toBe("No report for this date yet.");
    expect(dictionaries.ar.child.noReportForDate).toBe("لا يوجد تقرير لهذا التاريخ بعد.");
  });
});

describe("KID-472 item 4: mobile API ?date extension keeps today default", () => {
  it("childSummary defaults to today's report; an explicit date returns that day's", async () => {
    const child = (await queryGet("SELECT * FROM child WHERE id = ?", ella))!;
    const summaryToday = (await import("@/lib/mobile-api")).childSummary;
    const todayRow = await summaryToday(child);
    expect(String((todayRow.todayReport as any).reportDate)).toBe(todayIso());
    expect(String((todayRow.todayReport as any).summary)).toContain("Ella had a great day!");

    const date = await seedPastReport(2);
    const pastRow = await summaryToday(child, date);
    expect(String((pastRow.todayReport as any).reportDate)).toBe(date);
    expect(String((pastRow.todayReport as any).summary)).toBe(PAST_SUMMARY);
  });
});

describe("KID-472 item 4: the same-child past record is shared across roles", () => {
  it("what the staff member saved for a past date is what the parent reads", async () => {
    const date = shiftIsoDate(todayIso(), -1);
    mockState.cookie = sessionCookieFor(ownerId, "owner", "trois4ever+admin@gmail.com");
    const fd = new FormData();
    fd.set("childId", ella);
    fd.set("reportDate", date);
    fd.set("summary", "Yesterday was…");
    fd.set("sleep", "12:30-14:00");
    await expect(saveDailyReportAction(fd)).rejects.toThrow("NEXT_REDIRECT");
    const html = await renderParent(date);
    expect(html).toContain("Yesterday was…");
    expect(html).toContain("12:30-14:00");
  });
});
