// KID-2436: center-local time for working-hours rules.
//
// Timestamps stay stored as UTC instants. Every business rule that compares a
// moment with the center's configured working hours (check-in gate, pickup-time
// validation, auto check-out / auto off-bus cutoffs) must first project that
// instant into the CENTER's IANA timezone. Before this module the code used
// Date#getHours/getDay, i.e. the SERVER timezone (UTC on Vercel), so a parent
// in Egypt at 08:47 local (06:47 UTC) was refused as "before opening 07:00".
//
// Pure and dependency-free: safe for server actions, route handlers, and unit
// tests.

export const DEFAULT_CENTER_TIMEZONE = "Africa/Cairo";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(value: unknown): boolean {
  const timeZone = String(value ?? "").trim();
  if (!timeZone) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Stored/selected value -> a usable IANA zone (defaults to the platform's
 *  operating timezone, Egypt/Cairo). */
export function normalizeTimeZone(value: unknown, fallback: string = DEFAULT_CENTER_TIMEZONE): string {
  const trimmed = String(value ?? "").trim();
  if (isValidTimeZone(trimmed)) return trimmed;
  return isValidTimeZone(fallback) ? fallback : DEFAULT_CENTER_TIMEZONE;
}

const FALLBACK_TIMEZONES = [
  "Africa/Cairo",
  "Africa/Casablanca",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "America/Chicago",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "America/Toronto",
  "Asia/Amman",
  "Asia/Baghdad",
  "Asia/Beirut",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Riyadh",
  "Asia/Singapore",
  "Asia/Tehran",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "UTC",
];

/** The IANA zones offered by the center settings selector. Intl knows the full
 *  list at runtime; the curated fallback keeps older runtimes working. */
export function supportedTimeZones(): string[] {
  try {
    const zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf?.("timeZone");
    if (Array.isArray(zones) && zones.length > 0) {
      return zones.includes(DEFAULT_CENTER_TIMEZONE)
        ? zones
        : [DEFAULT_CENTER_TIMEZONE, ...zones];
    }
  } catch {
    // Older runtime without Intl.supportedValuesOf — use the curated list.
  }
  return FALLBACK_TIMEZONES;
}

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday … 6 = Saturday, for the local calendar date
};

function partNumber(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const found = parts.find((p) => p.type === type);
  return Number(found?.value ?? "0");
}

/** The wall-clock calendar/clock fields of `at` in `timeZone`. */
export function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(at);
  const year = partNumber(parts, "year");
  const month = partNumber(parts, "month");
  const day = partNumber(parts, "day");
  return {
    year,
    month,
    day,
    hour: partNumber(parts, "hour"),
    minute: partNumber(parts, "minute"),
    second: partNumber(parts, "second"),
    // Weekday of the LOCAL calendar date, independent of the host timezone.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Local calendar day as YYYY-MM-DD. */
export function zonedDateKey(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function zonedMinutesOfDay(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  return p.hour * 60 + p.minute;
}

export function zonedWeekday(at: Date, timeZone: string): number {
  return zonedParts(at, timeZone).weekday;
}

// Offset of the zone at `instant`, in milliseconds (east of UTC is positive).
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const wholeSecond = instant.getTime() - (instant.getTime() % 1000);
  return asUtc - wholeSecond;
}

export type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
};

/** Converts a wall-clock moment in `timeZone` to the UTC instant that shows
 *  that clock there. Handles DST offsets by re-checking the offset at the
 *  guessed instant; day/month overflow is delegated to Date.UTC. */
export function zonedDateTimeToInstant(local: LocalDateTime, timeZone: string): Date {
  const target = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second ?? 0
  );
  const firstGuess = target - offsetMs(new Date(target), timeZone);
  const secondGuess = target - offsetMs(new Date(firstGuess), timeZone);
  return new Date(secondGuess);
}

/** UTC bounds of a center-local calendar day: [start, end). */
export function localDayBoundsUtc(day: string, timeZone: string): { start: Date; end: Date } {
  const [year, month, date] = String(day).split("-").map(Number);
  const start = zonedDateTimeToInstant(
    { year, month, day: date, hour: 0, minute: 0, second: 0 },
    timeZone
  );
  const end = zonedDateTimeToInstant(
    { year, month, day: date + 1, hour: 0, minute: 0, second: 0 },
    timeZone
  );
  return { start, end };
}

// ---------------------------------------------------------------------------
// KID-2496: center-clock DISPLAY formatting.
//
// Timestamps stay stored as UTC instants, exactly like the working-hours rules
// above. Before this section every user-visible date/time went through
// `Intl.DateTimeFormat` with no `timeZone`, which uses the HOST zone: the
// Workers/Vercel renderer runs in UTC, so a 16:34 Cairo check-in rendered as
// 14:34. These helpers are the single display counterpart of the business-rule
// helpers, so server components format with the center's clock instead of the
// server's.
//
// Date-only values ("YYYY-MM-DD": dob, report_date, due_date) are rendered in
// UTC so their calendar date never shifts across the zone boundary.
// ---------------------------------------------------------------------------

export type ZonedFormatKind = "date" | "time" | "datetime";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseForDisplay(value: unknown): { date: Date; dateOnly: boolean } | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = value instanceof Date ? value.toISOString() : String(value);
  if (DATE_ONLY_RE.test(raw)) {
    const d = new Date(`${raw}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : { date: d, dateOnly: true };
  }
  const d = value instanceof Date ? value : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : { date: d, dateOnly: false };
}

function displayOptions(dateOnly: boolean, kind: ZonedFormatKind, timeZone: string): Intl.DateTimeFormatOptions {
  // A date-only value keeps its literal calendar day: formatting it in UTC
  // means "the date that was stored", independent of the center's offset.
  const zone = dateOnly ? "UTC" : timeZone;
  if (kind === "time" && !dateOnly) return { hour: "2-digit", minute: "2-digit", timeZone: zone };
  if (kind === "date") return { day: "numeric", month: "short", year: "numeric", timeZone: zone };
  return { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: zone };
}

function fallbackDisplay(value: { date: Date; dateOnly: boolean }, kind: ZonedFormatKind, timeZone: string): string {
  const zone = value.dateOnly ? "UTC" : normalizeTimeZone(timeZone);
  const p = zonedParts(value.date, zone);
  const day = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  const clock = `${pad2(p.hour)}:${pad2(p.minute)}`;
  if (kind === "date") return day;
  if (kind === "time") return clock;
  return `${day} ${clock}`;
}

/** Center-local wall clock as "YYYY-MM-DD HH:MM:SS" for CSV / data exports.
 *  Same projection as the display helpers, without locale month names. */
export function zonedWallClock(value: unknown, timeZone: string): string {
  const parsed = parseForDisplay(value);
  if (!parsed) return "";
  const p = zonedParts(parsed.date, parsed.dateOnly ? "UTC" : normalizeTimeZone(timeZone));
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

/** Formats a stored timestamp in `locale` on the CENTER's clock. */
export function formatZonedValue(
  locale: string,
  value: unknown,
  timeZone: string,
  kind: ZonedFormatKind
): string {
  const parsed = parseForDisplay(value);
  if (!parsed) return "—";
  try {
    return new Intl.DateTimeFormat(locale, displayOptions(parsed.dateOnly, kind, timeZone)).format(parsed.date);
  } catch {
    // Older runtime without this IANA zone in Intl: never fall back to the host
    // zone, which is the UTC bug this module exists to remove.
    return fallbackDisplay(parsed, kind, timeZone);
  }
}
