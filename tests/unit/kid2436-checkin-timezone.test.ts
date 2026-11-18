// KID-2436: working-hours rules must use the CENTER's timezone, not the
// server's (UTC on Vercel). The founder report: 08:47 local in Egypt was
// refused as "before opening 07:00" because 08:47 Cairo = 06:47 UTC.

process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";
import {
  checkInOpen,
  closeCutoff,
  busAutoOffCutoff,
  type WorkingWeek,
} from "@/lib/working-hours";
import { saveWorkingHours, checkInAllowed } from "@/lib/store";
import { evaluatePickupTime } from "@/lib/pickup-policy";

const CAIRO = "Africa/Cairo";
// 2026-11-11 is a Wednesday in both UTC and Cairo.
const WED: WorkingWeek = { "3": { open: "07:00", close: "18:00" } };

describe("KID-2436 check-in gate uses the center timezone", () => {
  it("allows 08:47 Cairo (06:47 UTC) for a 07:00-opening center", () => {
    const at = new Date("2026-11-11T06:47:00.000Z");
    expect(checkInOpen(WED, at, CAIRO)).toEqual({ allowed: true });
  });

  it("still refuses a genuinely pre-opening center-local moment", () => {
    // 04:30 UTC = 06:30 Cairo.
    const out = checkInOpen(WED, new Date("2026-11-11T04:30:00.000Z"), CAIRO);
    expect(out.allowed).toBe(false);
    expect(out.code).toBe("before_open");
    expect(out.open).toBe("07:00");
    expect(out.error).toContain("07:00");
  });

  it("uses the center-local weekday for the closed-day branch", () => {
    // Thursday 22:30 UTC is Friday 00:30 in Cairo; Friday is closed.
    const fridayClosed: WorkingWeek = { "4": { open: "07:00", close: "18:00" } };
    const out = checkInOpen(fridayClosed, new Date("2026-11-12T22:30:00.000Z"), CAIRO);
    expect(out.allowed).toBe(false);
    expect(out.code).toBe("closed_day");
    expect(out.dayIndex).toBe("5");
  });

  it("checkInAllowed reads the center's configured timezone from the institute", async () => {
    await seedFixture();
    const iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
    await saveWorkingHours(iid, WED);
    // The fixture pins UTC; move it to Cairo for this test.
    const { queryRun } = await import("@/lib/db");
    await queryRun("UPDATE institute SET timezone = ? WHERE id = ?", CAIRO, iid);

    expect((await checkInAllowed(iid, new Date("2026-11-11T06:47:00.000Z"))).allowed).toBe(true);
    expect((await checkInAllowed(iid, new Date("2026-11-11T04:30:00.000Z"))).allowed).toBe(false);
  });
});

describe("KID-2436 pickup-time validation uses the center timezone", () => {
  it("accepts a center-local 08:47 pickup submitted as a naive datetime", () => {
    const decision = evaluatePickupTime({
      type: "out",
      now: new Date("2026-11-11T06:00:00.000Z"), // 08:00 Cairo
      week: WED,
      timeZone: CAIRO,
      at: "2026-11-11T08:47",
    });
    expect(decision.ok).toBe(true);
    expect(decision.ok && decision.at.toISOString()).toBe("2026-11-11T06:47:00.000Z");
  });

  it("compares same-day in the center zone across the UTC midnight boundary", () => {
    // 00:30 Cairo on Nov 11 is 22:30 UTC on Nov 10.
    const decision = evaluatePickupTime({
      type: "out",
      now: new Date("2026-11-10T22:30:00.000Z"),
      week: WED,
      timeZone: CAIRO,
      at: "2026-11-11T07:30", // 05:30 UTC on Nov 11
    });
    expect(decision.ok).toBe(true);
    expect(decision.ok && decision.at.toISOString()).toBe("2026-11-11T05:30:00.000Z");
  });

  it("refuses a previous center-local day even when its UTC date differs", () => {
    const decision = evaluatePickupTime({
      type: "out",
      now: new Date("2026-11-11T10:00:00.000Z"), // 12:00 Cairo
      week: WED,
      timeZone: CAIRO,
      at: "2026-11-10T23:00", // 23:00 Cairo on Nov 10
    });
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.code).toBe("cross_day");
  });

  it("applies open/close bounds in the center zone", () => {
    const beforeOpen = evaluatePickupTime({
      type: "out",
      now: new Date("2026-11-11T04:00:00.000Z"), // 06:00 Cairo
      week: WED,
      timeZone: CAIRO,
      at: "2026-11-11T06:30",
    });
    expect(!beforeOpen.ok && beforeOpen.code).toBe("outside_hours");

    const afterClose = evaluatePickupTime({
      type: "out",
      now: new Date("2026-11-11T10:00:00.000Z"),
      week: WED,
      timeZone: CAIRO,
      at: "2026-11-11T18:30",
    });
    expect(!afterClose.ok && afterClose.code).toBe("outside_hours");
  });
});

describe("KID-2436 working-hours cutoffs use the center timezone", () => {
  it("close + 3h is computed in center-local wall clock", () => {
    // Monday 12:00 UTC = 14:00 Cairo; close 18:00 Cairo -> cutoff 21:00 Cairo
    // = 19:00 UTC.
    const cutoff = closeCutoff(WED, new Date("2026-11-11T12:00:00.000Z"), CAIRO);
    expect(cutoff?.toISOString()).toBe("2026-11-11T19:00:00.000Z");
  });

  it("bus auto-off is close + 2h in center-local wall clock", () => {
    const cutoff = busAutoOffCutoff(WED, new Date("2026-11-11T12:00:00.000Z"), CAIRO);
    expect(cutoff?.toISOString()).toBe("2026-11-11T18:00:00.000Z");
  });
});
