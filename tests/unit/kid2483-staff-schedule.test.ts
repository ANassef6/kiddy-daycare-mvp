// KID-2483: staff schedule specific dates, per-shift rooms, and duplication.
//
// The schedule keeps the legacy weekly pattern (`schedule_date` NULL) and adds
// one-off dated rows. A dated row for a staff member replaces the weekly
// pattern on that date. Repeats create concrete rows — there is no hidden
// recurrence rule stored. Rooms are many-to-many per shift.

import { beforeEach, describe, expect, it } from "vitest";
import { queryGet } from "@/lib/db";
import {
  createStaffSchedule,
  createStaffScheduleSeries,
  deleteStaffSchedule,
  listStaffSchedules,
  listStaffSchedulesForDate,
} from "@/lib/store";
import {
  MAX_REPEAT_DAYS,
  isIsoDate,
  repeatDates,
  schedulesForDay,
  weekdayOf,
} from "@/lib/staff-schedule";
import { seedFixture } from "../helpers";

let iid: string;
let staffId: string;
let toddlers: string;
let preschool: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  staffId = String((await queryGet("SELECT id FROM staff ORDER BY full_name LIMIT 1"))!.id);
  toddlers = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers' LIMIT 1"))!.id);
  preschool = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool' LIMIT 1"))!.id);
});

describe("KID-2483: date helpers", () => {
  it("accepts only real ISO calendar dates", () => {
    expect(isIsoDate("2026-01-01")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("01/01/2026")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });

  it("computes the weekday from the calendar date, not the server timezone", () => {
    expect(weekdayOf("2026-01-01")).toBe(4);
    expect(weekdayOf("2026-01-05")).toBe(1);
  });

  it("enumerates daily and weekly repeats inclusively", () => {
    expect(repeatDates("2026-01-01", "2026-01-03", "daily")).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
    expect(repeatDates("2026-01-01", "2026-01-15", "weekly")).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-01-15",
    ]);
  });

  it("rejects an inverted range, an invalid date, and an oversized range", () => {
    expect(repeatDates("2026-01-05", "2026-01-01", "daily")).toEqual([]);
    expect(repeatDates("2026-02-30", "2026-03-05", "daily")).toEqual([]);
    expect(repeatDates("2026-01-01", "2027-01-01", "daily")).toHaveLength(MAX_REPEAT_DAYS);
    expect(repeatDates("2026-01-01", "2027-01-02", "daily")).toEqual([]);
  });

  it("a dated row overrides the weekly pattern on that date only", () => {
    const recurring = { id: "r", day_of_week: 1, schedule_date: null };
    const dated = { id: "d", day_of_week: 1, schedule_date: "2026-01-05" };
    expect(schedulesForDay([recurring, dated], "2026-01-05").map((r) => r.id)).toEqual(["d"]);
    expect(schedulesForDay([recurring, dated], "2026-01-12").map((r) => r.id)).toEqual(["r"]);
    expect(schedulesForDay([recurring, dated], "2026-01-06")).toEqual([]);
  });
});

describe("KID-2483: store", () => {
  it("persists a specific date with its weekday and multiple rooms", async () => {
    const row = await createStaffSchedule({
      staffId,
      scheduleDate: "2026-01-01",
      startTime: "08:00",
      endTime: "16:00",
      roomIds: [toddlers, preschool],
    });

    expect(String(row.schedule_date)).toBe("2026-01-01");
    expect(Number(row.day_of_week)).toBe(4);
    expect(row.room_ids).toEqual(expect.arrayContaining([toddlers, preschool]));

    const [saved] = await listStaffSchedules(staffId);
    expect(String(saved.id)).toBe(String(row.id));
    expect(saved.room_names).toEqual(expect.arrayContaining(["Toddlers", "Preschool"]));
  });

  it("keeps a legacy weekday-only row and renders it on its weekday", async () => {
    const row = await createStaffSchedule({
      staffId,
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "17:00",
    });
    expect(row.schedule_date).toBeNull();

    const listed = await listStaffSchedules(staffId);
    expect(listed.map((r) => String(r.id))).toContain(String(row.id));

    expect((await listStaffSchedulesForDate(iid, "2026-01-05")).map((r) => String(r.id))).toContain(String(row.id));
    expect(await listStaffSchedulesForDate(iid, "2026-01-06")).toEqual([]);
  });

  it("lets a dated row replace the weekly pattern for that day", async () => {
    const recurring = await createStaffSchedule({
      staffId,
      dayOfWeek: 1,
      startTime: "08:00",
      endTime: "16:00",
      notes: "pattern",
    });
    const dated = await createStaffSchedule({
      staffId,
      scheduleDate: "2026-01-05",
      startTime: "10:00",
      endTime: "18:00",
      notes: "one-off",
    });

    const onDate = await listStaffSchedulesForDate(iid, "2026-01-05");
    expect(onDate.map((r) => String(r.id))).toEqual([String(dated.id)]);

    const nextMonday = await listStaffSchedulesForDate(iid, "2026-01-12");
    expect(nextMonday.map((r) => String(r.id))).toEqual([String(recurring.id)]);
  });

  it("creates one concrete row per repeated day with the same rooms", async () => {
    const dates = repeatDates("2026-01-01", "2026-01-03", "daily");
    const rows = await createStaffScheduleSeries({
      staffId,
      startTime: "08:00",
      endTime: "16:00",
      roomIds: [toddlers],
      dates,
    });

    expect(rows).toHaveLength(3);
    const dbRows = await listStaffSchedules(staffId);
    expect(dbRows.map((r) => String(r.schedule_date)).sort()).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
    for (const row of dbRows) {
      expect(row.room_ids).toEqual([toddlers]);
    }
  });

  it("repeats weekly on the same weekday until the end date", async () => {
    const dates = repeatDates("2026-01-01", "2026-01-15", "weekly");
    const rows = await createStaffScheduleSeries({
      staffId,
      startTime: "08:00",
      endTime: "16:00",
      dates,
    });
    expect(rows.map((r) => String(r.schedule_date))).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-01-15",
    ]);
    expect(rows.every((r) => Number(r.day_of_week) === 4)).toBe(true);
  });

  it("removes the room links when a shift is deleted", async () => {
    const row = await createStaffSchedule({
      staffId,
      scheduleDate: "2026-01-01",
      startTime: "08:00",
      endTime: "16:00",
      roomIds: [toddlers, preschool],
    });
    await deleteStaffSchedule(String(row.id));

    const links = await queryGet(
      "SELECT COUNT(*) AS c FROM staff_schedule_room WHERE schedule_id = ?",
      String(row.id)
    );
    expect(Number(links?.c ?? -1)).toBe(0);
  });
});
