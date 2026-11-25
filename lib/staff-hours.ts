import { zonedDateKey } from "./timezone";
import { parseHM } from "./working-hours";

export const MAX_HOURS_RANGE_DAYS = 92;
export const HOURS_TOLERANCE_MINUTES = 15;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type HoursView = "day" | "range";

export type HoursFilterInput = {
  view?: string;
  date?: string;
  from?: string;
  to?: string;
};

export type HoursFilter = {
  view: HoursView;
  from: string;
  to: string;
  today: string;
  days: string[];
  invalid: boolean;
  clamped: boolean;
};

export type StaffScheduleLike = {
  day_of_week?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  date?: unknown;
};

export type StaffStatusLike = {
  staff_id?: unknown;
  kind?: unknown;
  created_at?: unknown;
};

export type StaffHoursStatus =
  | "on_time"
  | "short"
  | "over"
  | "absent"
  | "unscheduled"
  | "no_schedule"
  | "upcoming";

export type ActualHours = {
  minutes: number;
  open: boolean;
  missingCheckout: boolean;
  checkins: number;
};

export type StaffHoursDelta = {
  minutes: number;
  status: StaffHoursStatus;
};

export function isDateKey(value: unknown): boolean {
  const key = String(value ?? "");
  const match = DATE_KEY.exec(key);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const at = new Date(Date.UTC(year, month - 1, day));
  return (
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === day
  );
}

function utcDateKey(at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return utcDateKey(new Date(Date.UTC(year, month - 1, day + days)));
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000
  );
}

export function enumerateDateKeys(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to && days.length < MAX_HOURS_RANGE_DAYS) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function weekdayOfDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function resolveHoursFilter(
  input: HoursFilterInput | undefined,
  today: string
): HoursFilter {
  const rawView = String(input?.view ?? "");
  const hasRange = Boolean(input?.from || input?.to);
  const view: HoursView =
    rawView === "range" || rawView === "day"
      ? rawView
      : hasRange
        ? "range"
        : "day";
  let invalid = false;
  let clamped = false;

  const accepted = (value: unknown, fallback: string): string => {
    if (value == null || value === "") return fallback;
    if (isDateKey(value)) return String(value);
    invalid = true;
    return fallback;
  };

  let from: string;
  let to: string;
  if (view === "day") {
    from = accepted(input?.date, today);
    to = from;
  } else {
    from = accepted(input?.from, today);
    to = accepted(input?.to, from);
    if (to < from) {
      invalid = true;
      [from, to] = [to, from];
    }
    if (daysBetween(from, to) > MAX_HOURS_RANGE_DAYS - 1) {
      to = addDays(from, MAX_HOURS_RANGE_DAYS - 1);
      clamped = true;
    }
  }

  return {
    view,
    from,
    to,
    today,
    days: enumerateDateKeys(from, to),
    invalid,
    clamped,
  };
}

function shiftInterval(row: StaffScheduleLike): [number, number] | undefined {
  const start = parseHM(String(row.start_time ?? ""));
  const end = parseHM(String(row.end_time ?? ""));
  if (!start || !end) return undefined;
  const startMinutes = start.h * 60 + start.m;
  let endMinutes = end.h * 60 + end.m;
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  return [startMinutes, endMinutes];
}

function mergedMinutes(intervals: Array<[number, number]>): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [start, end] = sorted[0];
  for (const [nextStart, nextEnd] of sorted.slice(1)) {
    if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  return total + (end - start);
}

export function expectedMinutesForDate(
  rows: StaffScheduleLike[],
  dateKey: string
): number {
  const dated = rows.filter((row) => isDateKey(row.date));
  const datedForDay = dated.filter((row) => String(row.date) === dateKey);
  const weekday = weekdayOfDateKey(dateKey);
  const recurring = rows.filter(
    (row) => !isDateKey(row.date) && Number(row.day_of_week) === weekday
  );
  const applicable = datedForDay.length > 0 ? datedForDay : recurring;
  const intervals = applicable
    .map(shiftInterval)
    .filter((interval): interval is [number, number] => Boolean(interval));
  return mergedMinutes(intervals);
}

export function expectedMinutesForDays(
  rows: StaffScheduleLike[],
  days: string[]
): number {
  return days.reduce(
    (total, day) => total + expectedMinutesForDate(rows, day),
    0
  );
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (value == null || value === "") return undefined;
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const at = new Date(normalized);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

function workedMinutes(start: Date, end: Date): number {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (minutes <= 0) return 0;
  return Math.min(minutes, 24 * 60);
}

export function actualMinutesForStaff(
  rows: StaffStatusLike[],
  days: string[],
  timeZone: string,
  options: { now?: Date; rangeEnd?: Date } = {}
): ActualHours {
  const now = options.now ?? new Date();
  const rangeEnd = options.rangeEnd ?? now;
  const daySet = new Set(days);
  const todayKey = zonedDateKey(now, timeZone);
  const events = rows
    .map((row) => ({
      kind: String(row.kind ?? ""),
      at: toDate(row.created_at),
    }))
    .filter(
      (event): event is { kind: string; at: Date } =>
        Boolean(event.at) && (event.kind === "checkin" || event.kind === "out")
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  let total = 0;
  let checkins = 0;
  let openAt: Date | undefined;
  let openDay: string | undefined;
  let open = false;
  let missingCheckout = false;

  for (const event of events) {
    if (event.kind === "checkin") {
      checkins += 1;
      if (!openAt) {
        openAt = event.at;
        openDay = zonedDateKey(event.at, timeZone);
      }
      continue;
    }
    if (openAt && openDay) {
      if (daySet.has(openDay)) {
        total += workedMinutes(openAt, event.at);
      }
      openAt = undefined;
      openDay = undefined;
    }
  }

  if (openAt && openDay && daySet.has(openDay)) {
    const canCountToNow =
      openDay === todayKey &&
      now.getTime() > openAt.getTime() &&
      now.getTime() < rangeEnd.getTime();
    if (canCountToNow) {
      total += workedMinutes(openAt, now);
      open = true;
    } else {
      missingCheckout = true;
    }
  }

  return { minutes: total, open, missingCheckout, checkins };
}

export function classifyStaffHours(input: {
  expected: number;
  actual: number;
  upcoming?: boolean;
  tolerance?: number;
}): StaffHoursDelta {
  const { expected, actual } = input;
  const tolerance = input.tolerance ?? HOURS_TOLERANCE_MINUTES;
  if (input.upcoming) {
    return { minutes: expected - actual, status: "upcoming" };
  }
  if (expected === 0 && actual === 0) {
    return { minutes: 0, status: "no_schedule" };
  }
  if (expected === 0) {
    return { minutes: actual, status: "unscheduled" };
  }
  if (actual === 0) {
    return { minutes: -expected, status: "absent" };
  }
  if (actual < expected - tolerance) {
    return { minutes: actual - expected, status: "short" };
  }
  if (actual > expected + tolerance) {
    return { minutes: actual - expected, status: "over" };
  }
  return { minutes: 0, status: "on_time" };
}

export function formatDurationParts(minutes: number): { hours: number; minutes: number } {
  const safe = Math.max(0, Math.round(minutes));
  return { hours: Math.floor(safe / 60), minutes: safe % 60 };
}
