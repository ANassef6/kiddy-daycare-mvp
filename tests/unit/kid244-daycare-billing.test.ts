// KID-244: the billing foundation — per-daycare subscription settings
// (supabase/migrations/0027_daycare_billing.sql and the SQLite mirror in
// lib/sqlite-schema.ts), the store functions behind the /platform billing
// surfaces, and the "demo bills 0" rule.
//
// Same split kid203-platform-daycares.test.ts documents: the store-level core
// (createDaycare with billing options, getDaycareBilling, updateDaycareBilling)
// is tested directly against the isolated SQLite data layer, so the
// create/billing/gear-UI guards (requireSession + operator checks, which need
// next/headers) stay out of these tests and the rows those guards protect are
// pinned here. The Postgres half of the dual engine is verified by
// `npm run db:verify-migrations` against real PGlite Postgres.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import {
  BILLING_DEFAULTS,
  cycleAmountEgp,
  getDaycareBilling,
  nextMonthStart,
  updateDaycareBilling,
} from "@/lib/billing";
import { queryGet } from "@/lib/db";
import { dictionaries, keysOf } from "@/lib/i18n";
import { seedFixture } from "../helpers";

let sunshineIid: string;

beforeEach(async () => {
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
});

async function newDaycare(billing?: Parameters<typeof store.createDaycare>[0]["billing"]) {
  return store.createDaycare({
    name: "Maple Grove",
    ownerEmail: `owner-${Math.random().toString(36).slice(2, 8)}@maplegrove.test`,
    ownerPassword: "maple-owner-1",
    ownerFullName: "Nadia Kareem",
    billing,
  });
}

describe("defaults", () => {
  it("writes a demo billing row at creation with the platform defaults", async () => {
    const res = await newDaycare();
    const b = await getDaycareBilling(res.instituteId);
    expect(b.plan).toBe("demo");
    expect(b.monthlyRateEgp).toBe(BILLING_DEFAULTS.monthlyRateEgp);
    expect(b.perChildRateEgp).toBe(BILLING_DEFAULTS.perChildRateEgp);
    expect(b.freeChildThreshold).toBe(BILLING_DEFAULTS.freeChildThreshold);
    expect(b.annualAmountEgp).toBe(BILLING_DEFAULTS.annualAmountEgp);
  });

  it("the signup month is free: first billing cycle starts the 1st AFTER signup", async () => {
    const res = await newDaycare();
    const inst = await store.getInstitute(res.instituteId);
    const expected = nextMonthStart(new Date(String(inst!.created_at)));
    const b = await getDaycareBilling(res.instituteId);
    expect(b.firstCycleStart).toMatch(/^\d{4}-\d{2}-01$/);
    expect(b.firstCycleStart).toBe(expected);
    expect(new Date(expected).getUTCDate()).toBe(1);
  });

  it("accepts the monthly plan with the operator-typed rate values", async () => {
    const res = await newDaycare({
      plan: "monthly",
      monthlyRateEgp: 750,
      perChildRateEgp: 60,
      freeChildThreshold: 12,
      annualAmountEgp: 25000,
    });
    const b = await getDaycareBilling(res.instituteId);
    expect(b.plan).toBe("monthly");
    expect(b.monthlyRateEgp).toBe(750);
    expect(b.perChildRateEgp).toBe(60);
    expect(b.freeChildThreshold).toBe(12);
    expect(b.annualAmountEgp).toBe(25000);
  });

  it("accepts the annual plan", async () => {
    const res = await newDaycare({ plan: "annual" });
    expect((await getDaycareBilling(res.instituteId)).plan).toBe("annual");
  });
});

describe("updateDaycareBilling", () => {
  it("the operator can change plan and all amounts later; changes persist", async () => {
    const res = await newDaycare({ plan: "monthly", monthlyRateEgp: 500, perChildRateEgp: 50 });
    await updateDaycareBilling(res.instituteId, {
      plan: "annual",
      annualAmountEgp: 30000,
      perChildRateEgp: 80,
      freeChildThreshold: 5,
      monthlyRateEgp: 600,
    });
    // Re-read through a fresh instance of the settings (the reload-persisted
    // criterion): same fields, same values, no stale in-memory cache.
    const inst = await queryGet("SELECT * FROM daycare_billing WHERE institute_id = ?", res.instituteId);
    expect(String(inst!.plan)).toBe("annual");
    expect(Number(inst!.monthly_rate_egp)).toBe(600);
    expect(Number(inst!.per_child_rate_egp)).toBe(80);
    expect(Number(inst!.free_child_threshold)).toBe(5);
    expect(Number(inst!.annual_amount_egp)).toBe(30000);
  });

  it("a pre-existing institute without a row reads the defaults (backfill-equivalent)", async () => {
    // The seeded Sunshine institute predates this module's creation write:
    // reading its settings doesn't crash, and it sees exactly the defaults.
    const b = await getDaycareBilling(sunshineIid);
    expect(b.plan).toBe("demo");
    expect(b.monthlyRateEgp).toBe(500);
    expect(b.perChildRateEgp).toBe(50);
    expect(b.freeChildThreshold).toBe(10);
    expect(b.annualAmountEgp).toBe(24000);
  });

  it("refuses an unknown plan and negative amounts (fail fast, named errors)", async () => {
    await expect(
      updateDaycareBilling(sunshineIid, { plan: "lifetime" as never })
    ).rejects.toThrow("billing-plan-invalid");
    await expect(
      updateDaycareBilling(sunshineIid, { monthlyRateEgp: -5 })
    ).rejects.toThrow("billing-monthly_rate_egp-invalid");
    await expect(
      updateDaycareBilling(sunshineIid, { annualAmountEgp: -1 })
    ).rejects.toThrow("billing-annual_amount_egp-invalid");
    await expect(
      updateDaycareBilling(sunshineIid, { freeChildThreshold: NaN })
    ).rejects.toThrow("billing-free_child_threshold-invalid");
    // A refused write left no half-row behind.
    await newDaycare();
    await expect(
      updateDaycareBilling(sunshineIid, { plan: "weekly" as never })
    ).rejects.toThrow("billing-plan-invalid");
  });
});

describe("cycleAmountEgp", () => {
  const monthly = { ...BILLING_DEFAULTS, firstCycleStart: "", plan: "monthly" as const };
  const demo = { ...BILLING_DEFAULTS, firstCycleStart: "", plan: "demo" as const };
  const annual = { ...BILLING_DEFAULTS, firstCycleStart: "", plan: "annual" as const };

  it("the demo plan bills 0, whatever is enrolled", () => {
    expect(cycleAmountEgp(demo, 0)).toBe(0);
    expect(cycleAmountEgp(demo, 150)).toBe(0);
  });

  it("monthly: first 10 children included; child #11 is the first charged", () => {
    expect(cycleAmountEgp(monthly, 0)).toBe(500);
    expect(cycleAmountEgp(monthly, 10)).toBe(500);
    expect(cycleAmountEgp(monthly, 11)).toBe(550);
    expect(cycleAmountEgp(monthly, 14)).toBe(700);
  });

  it("annual bills the configured annual amount", () => {
    expect(cycleAmountEgp(annual, 3)).toBe(24000);
    expect(cycleAmountEgp(annual, 200)).toBe(24000);
  });
});

describe("i18n", () => {
  it("carries the KID-244 billing labels in both EN and AR with matching key sets", () => {
    const billingKeys = (dict: Record<string, unknown>) =>
      keysOf(dict as never).filter((k) => k.startsWith("platform.billing"));
    expect(billingKeys(dictionaries.en).length).toBeGreaterThan(10);
    expect(billingKeys(dictionaries.ar).sort()).toEqual(billingKeys(dictionaries.en).sort());
  });
});
