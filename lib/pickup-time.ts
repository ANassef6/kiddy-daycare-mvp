// KID-486: pure validation for same-day planned pickup times. No imports from
// lib/db or lib/store — the rules are unit-tested in isolation and consumed by
// lib/actions.ts (savePickupTimeAction) and the pickup page.
//
// Rules (from the approved plan):
//   - Same day only: the scheduled date must be today (server-local date).
//   - One entry per child per day: structural (UNIQUE(child_id, pickup_date)),
//     the store layer upserts instead.
//   - The center must be open that day: a configured working week with no
//     entry for today's weekday is a closed day.
//   - The time must fall within the center's working hours (inclusive).
//     No working-hours config at all behaves like the check-in gate: open.
//   - Past times are rejected.

import { normalizeWorkingHours, parseHM } from "./working-hours";

export type PickupTimeError =
  | "invalidDate"
  | "invalidTime"
  | "notToday"
  | "closedDay"
  | "outsideHours"
  | "pastTime";

export type PickupTimeCheck = { ok: true } | { ok: false; error: PickupTimeError };

/** The app's canonical "today" (UTC ISO date — the same definition
 *  report-dates.todayIso uses, so the write path and this gate agree). */
export function localIsoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function checkPickupTime(input: {
  week: unknown;
  date?: unknown;
  time?: unknown;
  now?: Date;
}): PickupTimeCheck {
  const now = input.now ?? new Date();
  const date = String(input.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "invalidDate" };
  if (date !== localIsoDate(now)) return { ok: false, error: "notToday" };

  const time = String(input.time ?? "").trim();
  const parsedTime = parseHM(time);
  if (!parsedTime) return { ok: false, error: "invalidTime" };

  // Callers hand either the stored JSON string or an already-normalized
  // WorkingWeek object; both must resolve to the same config, so object
  // inputs round-trip through JSON (normalizeWorkingHours only reads strings).
  const week = normalizeWorkingHours(
    input.week && typeof input.week === "object" ? JSON.stringify(input.week) : input.week
  );
  if (Object.keys(week).length > 0) {
    const day = week[String(now.getDay())];
    if (!day) return { ok: false, error: "closedDay" };
    const minutes = parsedTime.h * 60 + parsedTime.m;
    const open = parseHM(day.open);
    const close = parseHM(day.close);
    if (open && minutes < open.h * 60 + open.m) return { ok: false, error: "outsideHours" };
    if (close && minutes > close.h * 60 + close.m) return { ok: false, error: "outsideHours" };
  }
  // A missing day with NO config at all is treated as open (same as checkInOpen).

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (parsedTime.h * 60 + parsedTime.m <= nowMinutes) return { ok: false, error: "pastTime" };

  return { ok: true };
}
