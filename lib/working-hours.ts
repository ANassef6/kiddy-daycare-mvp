// Working-hours configuration + attendance policy (KID-55 item 3 / KID-58).
//
// The center stores per-day opening hours on the `institute.opening_hours`
// column as JSON keyed by the JS day-of-week number (0 = Sunday … 6 =
// Saturday). Each value is `{ "open": "HH:MM", "close": "HH:MM" }`; a day that
// is missing (or explicitly cleared) counts as a closed day.
//
// Two behaviors ride on this config:
//   1. Early check-in is rejected ("No one can be checked-in before the
//      working hours").
//   2. Any child/staff still checked-in 3 hours after the closing time is
//      auto checked-out by the system (actor = system account).

export const AUTO_CHECKOUT_GRACE_HOURS = 3;

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type DayHours = { open: string; close: string };

// Persisted/returned shape: `{ "0"?: DayHours, "1"?: DayHours, … }`.
export type WorkingWeek = Record<string, DayHours>;

// Legacy seed shapes `{ mon: "07:00-18:00", … }` from the first iteration map
// onto the same day-of-week numbering.
const LEGACY_DAY_INDEX: Record<string, string> = {
  sun: "0",
  mon: "1",
  tue: "2",
  wed: "3",
  thu: "4",
  fri: "5",
  sat: "6",
};

export function todayKey(now: Date): string {
  return String(now.getDay());
}

export function parseHM(value: string): { h: number; m: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!match) return undefined;
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  return { h, m: min };
}

// Normalizes whatever is stored (legacy `{day:"HH:MM-HH:MM"}`, the current
// `{ "0": {open,close} }`, or nothing) into a WorkingWeek.
export function normalizeWorkingHours(raw: unknown): WorkingWeek {
  const out: WorkingWeek = {};
  if (!raw) return out;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  for (const [key, value] of Object.entries(parsed)) {
    const dayIndex = LEGACY_DAY_INDEX[key.toLowerCase()] ?? key;
    if (!/^[0-6]$/.test(dayIndex)) continue;
    if (typeof value === "string") {
      // Legacy `"07:00-18:00"` format.
      const parts = (value as string).split("-").map((p) => p.trim());
      if (parts.length === 2 && parseHM(parts[0]) && parseHM(parts[1])) {
        out[dayIndex] = { open: parts[0], close: parts[1] };
      }
    } else if (value && typeof value === "object") {
      const obj = value as { open?: unknown; close?: unknown };
      const open = String(obj.open ?? "").trim();
      const close = String(obj.close ?? "").trim();
      if (parseHM(open) && parseHM(close)) {
        out[dayIndex] = { open, close };
      }
    }
  }
  return out;
}

// Serializes a WorkingWeek into the persisted JSON (empty string when no day
// is open, so a fresh institute keeps "no config = no restriction").
export function encodeWorkingHours(week: WorkingWeek): string {
  const entries: Record<string, DayHours> = {};
  for (const key of Object.keys(week)) {
    const day = week[key];
    if (day?.open && day.close) entries[key] = day;
  }
  return Object.keys(entries).length > 0 ? JSON.stringify(entries) : "";
}

export function workingHoursConfigured(week: WorkingWeek): boolean {
  return Object.keys(week).length > 0;
}

export function dayLabelFor(key: string): string {
  const idx = Number(key);
  return Number.isInteger(idx) && idx >= 0 && idx <= 6 ? DAY_LABELS[idx] : key;
}

// Check-in gate: returns an error when the center has working-hours config
// and the given moment falls on a closed day or before that day's opening
// time. With no config at all, check-in is always allowed.
export function checkInOpen(
  week: WorkingWeek,
  now = new Date()
): { allowed: boolean; error?: string; open?: string } {
  if (!workingHoursConfigured(week)) return { allowed: true };
  const key = todayKey(now);
  const day = week[key];
  if (!day) {
    return {
      allowed: false,
      error: `${dayLabelFor(key)} is a closed day — no check-ins are allowed today.`,
    };
  }
  const parsed = parseHM(day.open);
  if (!parsed) return { allowed: true };
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const openMins = parsed.h * 60 + parsed.m;
  if (nowMins < openMins) {
    return {
      allowed: false,
      open: day.open,
      error: `The center hasn't opened yet — opening time is ${day.open}. Check-ins start at ${day.open}.`,
    };
  }
  return { allowed: true };
}

// Moment 3 hours after today's closing time (the auto-check-out cutoff), or
// undefined when today has no configured close time.
export function closeCutoff(week: WorkingWeek, now = new Date()): Date | undefined {
  if (!workingHoursConfigured(week)) return undefined;
  const day = week[todayKey(now)];
  if (!day) return undefined;
  const parsed = parseHM(day.close);
  if (!parsed) return undefined;
  const cutoff = new Date(now);
  cutoff.setHours(parsed.h + AUTO_CHECKOUT_GRACE_HOURS, parsed.m, 0, 0);
  return cutoff;
}