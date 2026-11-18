// KID-2437: the IANA timezone choices shown in Settings → Center details.
//
// The list comes from the runtime's ICU data (Intl.supportedValuesOf), so it
// follows the same tz database the comparison helpers in lib/timezone.ts use.
// The current value and the platform default are always present even on an
// older runtime that falls back to the curated list.

import { DEFAULT_CENTER_TIMEZONE, isValidTimeZone, supportedTimeZones } from "./timezone";

/** All IANA zones known to this runtime, sorted, with the current value and
 *  platform default guaranteed to appear exactly once. */
export function timeZoneOptions(current?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const zone of [current, DEFAULT_CENTER_TIMEZONE, ...supportedTimeZones()]) {
    const value = String(zone ?? "").trim();
    if (!value || seen.has(value) || !isValidTimeZone(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
