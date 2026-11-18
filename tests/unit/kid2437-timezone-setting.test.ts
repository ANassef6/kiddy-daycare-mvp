// KID-2437: the center's explicit IANA timezone is the single clock every
// working-hours rule uses. Timestamps stay UTC in storage; this suite proves
// the wall-clock and calendar comparisons project them into the center zone,
// including a DST transition, and that the seeded Sunshine center carries the
// Africa/Cairo migration default.

process.env.TZ = "UTC";

import { beforeAll, describe, expect, it } from "vitest";
import { queryGet, queryRun } from "@/lib/db";
import { attendanceOn, getCenterSchedule, checkInAllowed, todayStatus } from "@/lib/store";
import { checkInOpen, closeCutoff } from "@/lib/working-hours";
import { evaluatePickupTime } from "@/lib/pickup-policy";
import {
  DEFAULT_CENTER_TIMEZONE,
  isValidTimeZone,
  localDayBoundsUtc,
  normalizeTimeZone,
  zonedDateKey,
} from "@/lib/timezone";
import { timeZoneOptions } from "@/lib/timezone-options";
import { resetDb } from "../helpers";
import { seedDemo } from "@/lib/seed";

const CAIRO = "Africa/Cairo";
const NEW_YORK = "America/New_York";

// 2026-11-11 is a Wednesday. 07:00-18:00 means 05:00-16:00 UTC in Cairo (EET,
// UTC+2) and 12:00-21:00 UTC in New York (EST, UTC-5).
const WEDNESDAY = { "3": { open: "07:00", close: "18:00" } };
const MONDAY = { "1": { open: "07:00", close: "18:00" } };

beforeAll(async () => {
  // Seed directly instead of seedFixture(): the shared helper pins the fixture
  // to UTC for the older Date-based suites, and this file must observe the
  // real migration/seed default.
  await resetDb();
  await seedDemo();
});

describe("KID-2437 migration default", () => {
  it("Sunshine Daycare carries the Africa/Cairo default", async () => {
    const inst = await queryGet("SELECT name, timezone FROM institute LIMIT 1");
    expect(String(inst?.name)).toBe("Sunshine Daycare");
    expect(String(inst?.timezone)).toBe(CAIRO);
  });

  it("the default is the platform constant and is a valid IANA zone", () => {
    expect(DEFAULT_CENTER_TIMEZONE).toBe(CAIRO);
    expect(isValidTimeZone(CAIRO)).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(normalizeTimeZone("Mars/Olympus_Mons")).toBe(CAIRO);
  });

  it("the searchable settings list always includes the current value", () => {
    expect(timeZoneOptions(CAIRO)).toContain(CAIRO);
    expect(timeZoneOptions(NEW_YORK)).toContain(NEW_YORK);
  });
});

describe("KID-2437 center schedule read", () => {
  it("returns the stored week and timezone together", async () => {
    const schedule = await getCenterSchedule(String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id));
    expect(schedule.timeZone).toBe(CAIRO);
    expect(schedule.week["1"]).toEqual({ open: "07:00", close: "18:00" });
  });
});

describe("KID-2437 timezone-aware check-in window", () => {
  // The founder bug: 08:47 Cairo is 06:47 UTC. Server-clock evaluation saw
  // "before 07:00"; center-clock evaluation must allow it.
  const cairoMorning = new Date("2026-11-11T06:47:00.000Z");

  it("allows a parent at 08:47 Cairo for a 07:00 opening", () => {
    expect(checkInOpen(WEDNESDAY, cairoMorning, CAIRO).allowed).toBe(true);
  });

  it("still refuses before the center's 07:00 local opening", () => {
    const out = checkInOpen(WEDNESDAY, new Date("2026-11-11T04:59:00.000Z"), CAIRO);
    expect(out.allowed).toBe(false);
    expect(out.code).toBe("before_open");
    expect(out.open).toBe("07:00");
  });

  it("evaluates the stored week through the same zone", async () => {
    const iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
    expect((await checkInAllowed(iid, cairoMorning)).allowed).toBe(true);
    expect((await checkInAllowed(iid, new Date("2026-11-11T04:59:00.000Z"))).allowed).toBe(false);
  });
});

describe("KID-2437 DST edge", () => {
  // US DST starts 2026-03-08 at 02:00 local: the calendar day is 23 hours and
  // the UTC offset moves from -5 to -4. A fixed +5 assumption would refuse or
  // allow the wrong side of the 07:00 opening on the next day.
  it("builds a 23-hour local day across the spring-forward transition", () => {
    const { start, end } = localDayBoundsUtc("2026-03-08", NEW_YORK);
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect((end.getTime() - start.getTime()) / 3600000).toBe(23);
  });

  it("evaluates the 07:00 opening with the post-transition offset", () => {
    // 2026-03-09 06:30 New York = 10:30 UTC (EDT, UTC-4): still pre-opening.
    const before = checkInOpen(MONDAY, new Date("2026-03-09T10:30:00.000Z"), NEW_YORK);
    expect(before.allowed).toBe(false);
    expect(before.code).toBe("before_open");
    // 30 minutes later the center is open.
    expect(checkInOpen(MONDAY, new Date("2026-03-09T11:00:00.000Z"), NEW_YORK).allowed).toBe(true);
  });

  it("keeps the local calendar day, not the UTC date, around midnight", () => {
    expect(zonedDateKey(new Date("2026-03-08T04:30:00.000Z"), NEW_YORK)).toBe("2026-03-07");
    expect(zonedDateKey(new Date("2026-03-08T05:30:00.000Z"), NEW_YORK)).toBe("2026-03-08");
  });
});

describe("KID-2437 timezone-aware pickup times", () => {
  const now = new Date("2026-11-11T06:47:00.000Z"); // 08:47 Cairo

  it("reads a naive datetime-local value as the center's wall clock", () => {
    const out = evaluatePickupTime({
      type: "out",
      now,
      week: WEDNESDAY,
      at: "2026-11-11T09:00",
      timeZone: CAIRO,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.at.toISOString()).toBe("2026-11-11T07:00:00.000Z");
  });

  it("rejects a center-local time that is already past", () => {
    const out = evaluatePickupTime({
      type: "out",
      now,
      week: WEDNESDAY,
      at: "2026-11-11T08:30",
      timeZone: CAIRO,
    });
    expect(out).toMatchObject({ ok: false, code: "past" });
  });

  it("rejects a cross-day value against the center's local day", () => {
    const out = evaluatePickupTime({
      type: "out",
      now,
      week: WEDNESDAY,
      at: "2026-11-10T15:00",
      timeZone: CAIRO,
    });
    expect(out).toMatchObject({ ok: false, code: "cross_day" });
  });

  it("applies the open/close window in the center zone", () => {
    const closed = evaluatePickupTime({
      type: "out",
      now: new Date("2026-11-11T15:30:00.000Z"), // 17:30 Cairo, before close
      week: WEDNESDAY,
      at: "2026-11-11T19:00", // 19:00 Cairo, after close
      timeZone: CAIRO,
    });
    expect(closed).toMatchObject({ ok: false, code: "outside_hours", close: "18:00" });
  });
});

describe("KID-2437 attendance day boundary", () => {
  it("reads today's ledger by the center-local day, not the UTC date", async () => {
    const iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
    const childId = String((await queryGet("SELECT id FROM child ORDER BY id LIMIT 1"))!.id);
    const accountId = String((await queryGet("SELECT id FROM account ORDER BY id LIMIT 1"))!.id);
    // 23:30 UTC on Nov 10 is 01:30 on Nov 11 in Cairo: part of the center's
    // Nov 11 attendance day even though date(recorded_at) says Nov 10.
    await queryRun(
      "INSERT INTO check_in (id, child_id, account_id, type, is_edit, recorded_at) VALUES (?, ?, ?, 'in', 0, ?)",
      "kid2437-boundary-in",
      childId,
      accountId,
      "2026-11-10T23:30:00.000Z"
    );
    const status = await todayStatus(childId, new Date("2026-11-11T10:00:00.000Z"));
    expect(status.checkedIn?.recorded_at).toBe("2026-11-10T23:30:00.000Z");

    const rows = await attendanceOn(iid, "2026-11-11");
    expect(rows.find((r) => String(r.id) === childId)?.last_event).toBe("in");

    // On the center's Nov 10 day the same row is after 22:00 UTC, i.e. Nov 11
    // local, so it must not appear in Nov 10's attendance.
    const previous = await attendanceOn(iid, "2026-11-10");
    expect(previous.find((r) => String(r.id) === childId)?.last_event ?? null).toBeNull();
  });
});

describe("KID-2437 timezone-aware day boundary and cutoffs", () => {
  it("maps the Cairo calendar day to its UTC bounds", () => {
    const { start, end } = localDayBoundsUtc("2026-11-11", CAIRO);
    expect(start.toISOString()).toBe("2026-11-10T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-11T22:00:00.000Z");
  });

  it("computes close + grace in Cairo standard time", () => {
    const cutoff = closeCutoff(WEDNESDAY, new Date("2026-11-11T10:00:00.000Z"), CAIRO)!;
    // 18:00 + 3h = 21:00 Cairo (UTC+2) => 19:00 UTC.
    expect(cutoff.toISOString()).toBe("2026-11-11T19:00:00.000Z");
  });

  it("computes close + grace in Cairo daylight time", () => {
    // July: Cairo is UTC+3, so 21:00 local is 18:00 UTC (not 19:00).
    const cutoff = closeCutoff(WEDNESDAY, new Date("2026-07-15T10:00:00.000Z"), CAIRO)!;
    expect(cutoff.toISOString()).toBe("2026-07-15T18:00:00.000Z");
  });
});
