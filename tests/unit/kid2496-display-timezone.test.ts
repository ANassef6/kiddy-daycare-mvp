// KID-2496: a stored UTC instant must render on the CENTER's clock. The
// founder saw a 16:34 Cairo check-in as 14:34 on staging because the server
// components formatted with Intl's default (host) timezone — UTC on the
// Workers/Vercel renderer. These assertions pin the display counterpart of
// the KID-2437 working-hours helpers.

process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { fmtDateFor, fmtDateTimeFor, fmtTimeFor, feedCopyFor } from "@/lib/i18n";
import { DEFAULT_CENTER_TIMEZONE, formatZonedValue, zonedWallClock } from "@/lib/timezone";

const CAIRO = "Africa/Cairo";
const NEW_YORK = "America/New_York";
// 2026-11-11 is a Wednesday. Both zones are on standard time: Cairo is UTC+2,
// New York is UTC-5. The founder's 16:34 Cairo check-in was stored as 14:34Z.
const CHECK_IN = "2026-11-11T14:34:00.000Z";

describe("KID-2496 center-clock display", () => {
  it("renders a UTC check-in instant on the Cairo clock", () => {
    expect(fmtTimeFor("en", CHECK_IN, CAIRO)).toBe("16:34");
    expect(fmtDateTimeFor("en", CHECK_IN, CAIRO)).toBe("11 Nov 2026, 16:34");
  });

  it("never falls back to the host (UTC) clock", () => {
    // The regression: no explicit zone rendered the stored UTC value.
    expect(fmtTimeFor("en", CHECK_IN, "UTC")).toBe("14:34");
    expect(fmtTimeFor("en", CHECK_IN, CAIRO)).not.toBe(fmtTimeFor("en", CHECK_IN, "UTC"));
  });

  it("defaults to the platform operating zone when no tenant is supplied", () => {
    expect(DEFAULT_CENTER_TIMEZONE).toBe(CAIRO);
    expect(fmtTimeFor("en", CHECK_IN)).toBe("16:34");
    expect(fmtTimeFor("en", CHECK_IN, undefined)).toBe("16:34");
  });

  it("uses each center's own IANA zone instead of a hard-coded Cairo offset", () => {
    expect(fmtTimeFor("en", CHECK_IN, NEW_YORK)).toBe("09:34");
    expect(fmtDateTimeFor("en", CHECK_IN, NEW_YORK)).toBe("11 Nov 2026, 09:34");
  });

  it("keeps date-only values on their stored calendar day", () => {
    // dob / report_date / due_date are date-only: rendering them in a negative
    // offset must not move them to the previous day.
    expect(fmtDateFor("en", "2026-11-26", "America/Los_Angeles")).toBe("26 Nov 2026");
    expect(fmtDateFor("en", "2026-11-26T02:30:00.000Z", "America/Los_Angeles")).toBe("25 Nov 2026");
  });

  it("localizes in Arabic while keeping the Cairo clock", () => {
    const arTime = fmtTimeFor("ar", CHECK_IN, CAIRO);
    expect(arTime).not.toBe("14:34");
    expect(arTime).not.toBe(fmtTimeFor("ar", CHECK_IN, "UTC"));
    expect(fmtDateTimeFor("ar", CHECK_IN, CAIRO)).toContain("نوفمبر");
  });

  it("feeds the notification copy the same center clock", () => {
    expect(feedCopyFor("en", CAIRO).dateTime(CHECK_IN)).toBe("11 Nov 2026, 16:34");
  });

  it("exports CSV timestamps as center-local wall clock", () => {
    expect(zonedWallClock(CHECK_IN, CAIRO)).toBe("2026-11-11 16:34:00");
    expect(zonedWallClock(CHECK_IN, NEW_YORK)).toBe("2026-11-11 09:34:00");
    expect(zonedWallClock("2026-11-26", "America/Los_Angeles")).toBe("2026-11-26 00:00:00");
    expect(zonedWallClock("", CAIRO)).toBe("");
  });

  it("formats invalid/empty values as an em dash", () => {
    expect(formatZonedValue("en-GB", "", CAIRO, "datetime")).toBe("—");
    expect(formatZonedValue("en-GB", "not-a-date", CAIRO, "datetime")).toBe("—");
  });
});
