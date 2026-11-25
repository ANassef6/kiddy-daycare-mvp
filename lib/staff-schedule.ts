// KID-2483: pure date rules for the staff schedule.
//
// A `staff_schedule` row is either:
//   - a weekly pattern row (`schedule_date` empty, `day_of_week` 0..6), or
//   - a one-off dated row (`schedule_date` = ISO `YYYY-MM-DD`).
//
// Display rule for a single day: dated rows for that date replace the weekly
// pattern for that staff member (a specific date overrides the pattern). When
// there is no dated row, the weekly pattern applies. Keeping the rule here
// makes it testable without a database.

export type RepeatMode = "none" | "daily" | "weekly";

export const MAX_REPEAT_DAYS = 366;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isoFromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** True only for a real calendar date in ISO `YYYY-MM-DD` form. */
export function isIsoDate(value: unknown): value is string {
  const s = String(value ?? "");
  if (!ISO_DATE.test(s)) return false;
  const d = utcDate(s);
  return !Number.isNaN(d.getTime()) && isoFromUtc(d) === s;
}

/** Weekday of an ISO date, 0 = Sunday .. 6 = Saturday. */
export function weekdayOf(iso: string): number {
  return utcDate(iso).getUTCDay();
}

/**
 * Concrete dates from `start` through `end` (inclusive), stepping one day or
 * seven days. Returns [] for an invalid date, an end before the start, an
 * unknown mode, or a range longer than `MAX_REPEAT_DAYS`.
 */
export function repeatDates(start: string, end: string, mode: Exclude<RepeatMode, "none">): string[] {
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) return [];
  const step = mode === "weekly" ? 7 : mode === "daily" ? 1 : 0;
  if (step === 0) return [];

  const out: string[] = [];
  const last = utcDate(end).getTime();
  for (let t = utcDate(start).getTime(); t <= last; t += step * 86_400_000) {
    out.push(isoFromUtc(new Date(t)));
    if (out.length > MAX_REPEAT_DAYS) return [];
  }
  return out;
}

/**
 * Rows that apply on `date` for one staff member. Dated rows for that date
 * override the weekly pattern; otherwise every row matching the weekday
 * applies. Rows with neither a valid date nor a weekday are ignored.
 */
export function schedulesForDay<T extends { schedule_date?: unknown; day_of_week?: unknown }>(
  rows: T[],
  date: string
): T[] {
  if (!isIsoDate(date)) return [];
  const dated = rows.filter((r) => String(r.schedule_date ?? "") === date);
  if (dated.length > 0) return dated;
  const weekday = weekdayOf(date);
  return rows.filter(
    (r) => !r.schedule_date && Number(r.day_of_week) === weekday
  );
}
