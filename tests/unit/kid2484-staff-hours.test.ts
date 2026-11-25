process.env.TZ = "UTC";

import { beforeEach, describe, expect, it } from "vitest";
import {
  actualMinutesForStaff,
  addDays,
  classifyStaffHours,
  expectedMinutesForDate,
  expectedMinutesForDays,
  isDateKey,
  resolveHoursFilter,
} from "@/lib/staff-hours";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";
import {
  listStaffSchedulesForStaffIds,
  staffStatusEventsBetween,
} from "@/lib/store";

let staffId: string;

beforeEach(async () => {
  await seedFixture();
  staffId = String((await queryGet("SELECT id FROM staff LIMIT 1"))!.id);
});

describe("KID-2484 hours filter", () => {
  it("defaults to a single center-local day", () => {
    const filter = resolveHoursFilter(undefined, "2026-01-05");
    expect(filter.view).toBe("day");
    expect(filter.from).toBe("2026-01-05");
    expect(filter.to).toBe("2026-01-05");
    expect(filter.days).toEqual(["2026-01-05"]);
    expect(filter.invalid).toBe(false);
  });

  it("accepts a date range and enumerates every day", () => {
    const filter = resolveHoursFilter(
      { view: "range", from: "2026-01-04", to: "2026-01-06" },
      "2026-01-05"
    );
    expect(filter.days).toEqual(["2026-01-04", "2026-01-05", "2026-01-06"]);
  });

  it("swaps a reversed range and falls back on invalid dates", () => {
    const swapped = resolveHoursFilter(
      { view: "range", from: "2026-01-06", to: "2026-01-04" },
      "2026-01-05"
    );
    expect(swapped.from).toBe("2026-01-04");
    expect(swapped.to).toBe("2026-01-06");
    expect(swapped.invalid).toBe(true);

    const invalid = resolveHoursFilter(
      { view: "day", date: "2026-02-31" },
      "2026-01-05"
    );
    expect(invalid.from).toBe("2026-01-05");
    expect(invalid.invalid).toBe(true);
  });

  it("clamps an oversized range", () => {
    const filter = resolveHoursFilter(
      { view: "range", from: "2026-01-01", to: "2026-12-31" },
      "2026-01-05"
    );
    expect(filter.clamped).toBe(true);
    expect(filter.days).toHaveLength(92);
  });

  it("validates real calendar dates", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-2-9")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("KID-2484 expected hours", () => {
  it("sums the recurring weekday shifts", () => {
    const rows = [
      { day_of_week: 1, start_time: "08:00", end_time: "12:00" },
      { day_of_week: 1, start_time: "13:00", end_time: "16:30" },
      { day_of_week: 2, start_time: "08:00", end_time: "16:00" },
    ];
    expect(expectedMinutesForDate(rows, "2026-01-05")).toBe(450);
    expect(expectedMinutesForDays(rows, ["2026-01-05", "2026-01-06"])).toBe(930);
  });

  it("does not double-count overlapping shifts", () => {
    const rows = [
      { day_of_week: 1, start_time: "08:00", end_time: "12:00" },
      { day_of_week: 1, start_time: "11:00", end_time: "14:00" },
    ];
    expect(expectedMinutesForDate(rows, "2026-01-05")).toBe(360);
  });

  it("supports overnight shifts", () => {
    const rows = [{ day_of_week: 1, start_time: "22:00", end_time: "02:00" }];
    expect(expectedMinutesForDate(rows, "2026-01-05")).toBe(240);
  });

  it("lets a dated entry override the recurring weekday entry", () => {
    const rows = [
      { day_of_week: 1, start_time: "08:00", end_time: "16:00" },
      { day_of_week: 1, date: "2026-01-05", start_time: "10:00", end_time: "12:00" },
    ];
    expect(expectedMinutesForDate(rows, "2026-01-05")).toBe(120);
    expect(expectedMinutesForDate(rows, "2026-01-12")).toBe(480);
  });
});

describe("KID-2484 actual hours", () => {
  it("sums closed check-in/out pairs and ignores other statuses", () => {
    const rows = [
      { kind: "checkin", created_at: "2026-01-05T08:00:00.000Z" },
      { kind: "sick", created_at: "2026-01-05T09:00:00.000Z" },
      { kind: "out", created_at: "2026-01-05T16:00:00.000Z" },
      { kind: "checkin", created_at: "2026-01-05T17:00:00.000Z" },
      { kind: "out", created_at: "2026-01-05T18:30:00.000Z" },
    ];
    const actual = actualMinutesForStaff(rows, ["2026-01-05"], "UTC", {
      now: new Date("2026-01-06T00:00:00.000Z"),
      rangeEnd: new Date("2026-01-06T00:00:00.000Z"),
    });
    expect(actual.minutes).toBe(570);
    expect(actual.checkins).toBe(2);
    expect(actual.open).toBe(false);
  });

  it("counts an open shift on today up to now", () => {
    const rows = [{ kind: "checkin", created_at: "2026-01-05T08:00:00.000Z" }];
    const actual = actualMinutesForStaff(rows, ["2026-01-05"], "UTC", {
      now: new Date("2026-01-05T12:00:00.000Z"),
      rangeEnd: new Date("2026-01-06T00:00:00.000Z"),
    });
    expect(actual.minutes).toBe(240);
    expect(actual.open).toBe(true);
  });

  it("marks a past check-in without a check-out instead of guessing", () => {
    const rows = [{ kind: "checkin", created_at: "2026-01-05T08:00:00.000Z" }];
    const actual = actualMinutesForStaff(rows, ["2026-01-05"], "UTC", {
      now: new Date("2026-01-07T12:00:00.000Z"),
      rangeEnd: new Date("2026-01-06T00:00:00.000Z"),
    });
    expect(actual.minutes).toBe(0);
    expect(actual.missingCheckout).toBe(true);
  });

  it("attributes a shift to the center-local check-in day", () => {
    const rows = [
      { kind: "checkin", created_at: "2026-01-05T22:30:00.000Z" },
      { kind: "out", created_at: "2026-01-06T00:30:00.000Z" },
    ];
    const cairo = actualMinutesForStaff(rows, ["2026-01-06"], "Africa/Cairo", {
      now: new Date("2026-01-07T00:00:00.000Z"),
      rangeEnd: new Date("2026-01-07T00:00:00.000Z"),
    });
    expect(cairo.minutes).toBe(120);
    const utc = actualMinutesForStaff(rows, ["2026-01-06"], "UTC", {
      now: new Date("2026-01-07T00:00:00.000Z"),
      rangeEnd: new Date("2026-01-07T00:00:00.000Z"),
    });
    expect(utc.minutes).toBe(0);
  });

  it("does not restart the clock on a duplicate check-in", () => {
    const rows = [
      { kind: "checkin", created_at: "2026-01-05T08:00:00.000Z" },
      { kind: "checkin", created_at: "2026-01-05T10:00:00.000Z" },
      { kind: "out", created_at: "2026-01-05T16:00:00.000Z" },
    ];
    const actual = actualMinutesForStaff(rows, ["2026-01-05"], "UTC");
    expect(actual.minutes).toBe(480);
  });
});

describe("KID-2484 difference", () => {
  it("classifies missing attendance, short and over shifts", () => {
    expect(classifyStaffHours({ expected: 480, actual: 0 }).status).toBe("absent");
    expect(classifyStaffHours({ expected: 480, actual: 300 }).status).toBe("short");
    expect(classifyStaffHours({ expected: 480, actual: 540 }).status).toBe("over");
    expect(classifyStaffHours({ expected: 480, actual: 485 }).status).toBe("on_time");
    expect(classifyStaffHours({ expected: 0, actual: 0 }).status).toBe("no_schedule");
    expect(classifyStaffHours({ expected: 0, actual: 60 }).status).toBe("unscheduled");
    expect(classifyStaffHours({ expected: 480, actual: 0, upcoming: true }).status).toBe("upcoming");
  });
});

describe("KID-2484 store reads", () => {
  it("loads every staff member's schedule in one batch", async () => {
    await queryRun(
      "INSERT INTO staff_schedule (id, staff_id, day_of_week, start_time, end_time, notes) VALUES (?, ?, 1, '08:00', '16:00', '')",
      "sched-2484",
      staffId
    );
    const rows = await listStaffSchedulesForStaffIds([staffId]);
    expect(rows).toHaveLength(1);
    expect(expectedMinutesForDays(rows as never[], ["2026-01-05"])).toBe(480);
  });

  it("reads check-in/out events inside the requested bounds", async () => {
    await queryRun(
      "INSERT INTO staff_status (id, staff_id, kind, note, created_by_account_id, created_at) VALUES (?, ?, 'checkin', NULL, NULL, ?)",
      "st-in-2484",
      staffId,
      "2026-01-05T08:00:00.000Z"
    );
    await queryRun(
      "INSERT INTO staff_status (id, staff_id, kind, note, created_by_account_id, created_at) VALUES (?, ?, 'out', NULL, NULL, ?)",
      "st-out-2484",
      staffId,
      "2026-01-05T16:00:00.000Z"
    );
    await queryRun(
      "INSERT INTO staff_status (id, staff_id, kind, note, created_by_account_id, created_at) VALUES (?, ?, 'sick', NULL, NULL, ?)",
      "st-sick-2484",
      staffId,
      "2026-01-05T12:00:00.000Z"
    );
    const rows = await staffStatusEventsBetween(
      [staffId],
      new Date("2026-01-04T00:00:00.000Z"),
      new Date("2026-01-07T00:00:00.000Z")
    );
    expect(rows.map((r) => String(r.kind)).sort()).toEqual(["checkin", "out", "sick"]);
    const actual = actualMinutesForStaff(rows as never[], ["2026-01-05"], "UTC", {
      now: new Date("2026-01-07T00:00:00.000Z"),
      rangeEnd: new Date("2026-01-06T00:00:00.000Z"),
    });
    expect(actual.minutes).toBe(480);
  });
});
