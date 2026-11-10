// KID-1371: server-side pickup-time boundary policy (P2 gap from KID-1330).
//
// The pickup loop (lib/actions.ts checkInOutAction on the web and
// POST /api/mobile/children/[id]/check-in on mobile) registers today's pickup
// time as the check-in ledger's 'out' event — and staff keep the same write
// for attendance. The KID-112/KID-1330 spec for that write:
//
//   - same-day only: a pickup time belongs to today; a cross-day value is
//     rejected (the approval "no staff approval" rule means the registration
//     must be right first time, so anything but today is refused),
//   - past times rejected: a registration can record "now" or a moment
//     submitted with the request, never a moment in the past,
//   - within the center's working hours: the moment must fall into that
//     day's open..close window and the day must be an open day
//     (institute.opening_hours — lib/working-hours.ts drives the config),
//   - one entry per child per day: a redundant same-type re-registration
//     updates today's entry in place instead of stacking rows
//     (lib/store.ts registerCheckInOut),
//
// The KID-58 gate (lib/actions.ts checkInAllowed for type "in") already
// refuses check-ins on a closed day / before opening; THIS module extends the
// same rules to the whole user-facing loop, including check-out/pickup
// registrations and any request-supplied time. System flows (the auto
// check-out sweep, the bus ledger side effects) keep writing through
// checkChildInOut directly and must stay untouched — the sweep's timestamps
// are now+3h-after-close by design.
//
// Everything here is pure: the callers resolve the center's working week and
// hand it in, so the whole matrix is testable without a database.

import { dayLabelFor, parseHM, workingHoursConfigured, type WorkingWeek } from "./working-hours";

/** Why a pickup-time candidate was refused (ordered test-matrix codes). */
export type PickupTimeCode = "invalid_time" | "past" | "cross_day" | "outside_hours" | "closed_day";

export type PickupTimeDecision =
  | { ok: true; at: Date }
  | { ok: false; code: PickupTimeCode; error: string };

/** The accepted request formats: ISO-8601 with T ("2026-11-11T15:30" in a
 *  datetime-local picker is local by definition) or a full ISO instant with
 *  Z/offset. Anything present but unparseable fails closed — silently
 *  ignoring a submitted time is what let KID-1330 see no rejection at all. */
export function parsePickupAtCandidate(raw: unknown): { state: "none" } | { state: "invalid" } | { state: "valid"; at: Date } {
  if (raw === undefined || raw === null) return { state: "none" };
  const s = String(raw).trim();
  if (!s) return { state: "none" };
  // Naive local datetime-local values must be explicitly local-parsed so the
  // day boundary is the day the user picked, not a UTC shift of it.
  const naive = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(s);
  let at: Date;
  if (naive) {
    const [, y, mo, d, h, mi, se, ms] = naive;
    at = new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(se ?? 0),
      ms ? Number(`0.${ms}`) * 1000 : 0
    );
  } else {
    if (Number.isNaN(new Date(s).getTime())) return { state: "invalid" };
    at = new Date(s);
  }
  if (Number.isNaN(at.getTime()) || at.getTime() < 0) return { state: "invalid" };
  return { state: "valid", at };
}

/** Full boundary matrix for one pickup-time registration. `at` is the
 *  optional request-supplied candidate; when the REQUEST carries one, the
 *  whole matrix applies (same-day, not past, open day, working hours). When
 *  absent, the registration records the LIVE server clock — a moment nobody
 *  could have chosen — so the request-side rules are meaningless there:
 *  past/cross-day are impossible by construction, and refusing real
 *  out-of-hours events (after-hours pickup, auto-sweep-shaped writes) would
 *  break the daily loop; the web action separately keeps its pre-existing
 *  KID-58 closed-day/pre-open gate for type "in". */
export function evaluatePickupTime(input: {
  type: "in" | "out";
  now: Date;
  week: WorkingWeek;
  at?: unknown;
}): PickupTimeDecision {
  const parsed = parsePickupAtCandidate(input.at);
  // Default: record the server clock. Equal timestamps pass the "not past"
  // check via >=, so a plain no-`at` registration never trips the rule.
  const at = parsed.state === "valid" ? parsed.at : new Date(input.now.getTime());

  if (parsed.state === "invalid") {
    return {
      ok: false,
      code: "invalid_time",
      error: "The pickup time could not be read — send it as an ISO date-time (e.g. 2026-11-11T15:30) and try again.",
    };
  }

  // A request chose the moment — bound it hard.
  if (parsed.state === "valid") {
    // Same-day only: the ledger day is the UTC date of recorded_at
    // (date(recorded_at) everywhere in lib/store.ts, and todayIso() builds
    // today from the server clock's UTC date), so the comparison is too.
    if (at.toISOString().slice(0, 10) !== input.now.toISOString().slice(0, 10)) {
      return {
        ok: false,
        code: "cross_day",
        error: "A pickup time can only be registered for today — past and future days are not accepted.",
      };
    }

    // Past times rejected.
    if (at.getTime() < input.now.getTime()) {
      return {
        ok: false,
        code: "past",
        error: "The pickup time is in the past — register a current or upcoming time for today only.",
      };
    }
  }

  // Opening-hours bounds apply when the request supplied the moment. With no
  // working-hours configured at all, the historical no-restriction behavior
  // holds (same rule as checkInOpen in lib/working-hours.ts).
  if (parsed.state !== "valid") return { ok: true, at };
  if (!workingHoursConfigured(input.week)) return { ok: true, at };

  // Working hours are keyed by the LOCAL day (existing convention).
  const key = String(at.getDay());
  const day = input.week[key];
  if (!day) {
    return {
      ok: false,
      code: "closed_day",
      error: `${dayLabelFor(key)} is a closed day — times cannot be registered on a day the center is closed.`,
    };
  }
  const open = parseHM(day.open);
  const close = parseHM(day.close);
  const atMinutes = at.getHours() * 60 + at.getMinutes();
  if (open) {
    const openMinutes = open.h * 60 + open.m;
    if (atMinutes < openMinutes) {
      return {
        ok: false,
        code: "outside_hours",
        error: `The center hasn't opened yet — opening time is ${day.open}. Times can be registered from ${day.open}.`,
      };
    }
  }
  if (close) {
    const closeMinutes = close.h * 60 + close.m;
    if (atMinutes >= closeMinutes) {
      return {
        ok: false,
        code: "outside_hours",
        error: `The center is closed after ${day.close} — times can only be registered until ${day.close}.`,
      };
    }
  }
  return { ok: true, at };
}
