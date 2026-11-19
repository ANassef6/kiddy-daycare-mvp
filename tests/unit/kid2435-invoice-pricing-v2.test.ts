// KID-2435: the invoice engine now prices from the approved pricing-v2
// configuration (pricing_band + pricing_config), not the legacy per-daycare
// flat/per-child columns. These tests pin Noor's implementation spec vectors,
// the founding year-1/review glide chain, the pilot credit, the Enterprise+
// quote behaviour and the invoice snapshot fields.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "@/lib/store";
import {
  BILLING_DEFAULTS,
  cycleEndDate,
  cyclePricing,
  generateDueInvoices,
  isInstituteReadOnly,
  listInvoices,
  rowToBilling,
  runBillingSweep,
  updateDaycareBilling,
  type DaycareBilling,
} from "@/lib/billing";
import {
  PRICING_SETTINGS_DEFAULTS,
  STANDARD_PRICING_BANDS,
  getPricingSettings,
  updatePricingBand,
  updatePricingSettings,
} from "@/lib/pricing";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

const utcDate = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));

beforeEach(async () => {
  await seedFixture();
});

async function newDaycare(
  plan: "monthly",
  firstCycleStart: string,
  founding: { foundingClient?: boolean; foundingStartedAt?: string; pilotEndDate?: string } = {}
): Promise<string> {
  const res = await store.createDaycare({
    name: `Pricing ${Math.random().toString(36).slice(2, 8)}`,
    ownerEmail: `pricing-${Math.random().toString(36).slice(2, 8)}@example.test`,
    ownerPassword: "pricing-owner-1",
    ownerFullName: "Pricing Owner",
    billing: { plan },
  });
  await updateDaycareBilling(res.instituteId, { firstCycleStart, ...founding });
  return res.instituteId;
}

async function seedChildren(
  instituteId: string,
  n: number,
  createdAt: string,
  tag = "a"
): Promise<void> {
  for (let i = 0; i < n; i++) {
    await queryRun(
      `INSERT INTO child (id, institute_id, first_name, last_name, status, active, created_at)
       VALUES (?, ?, ?, ?, 'active', 1, ?)`,
      `child-${instituteId}-${tag}-${i}`,
      instituteId,
      `Kid${tag}${i}`,
      "Nassef",
      createdAt
    );
  }
}

const monthlyBilling = (overrides: Partial<DaycareBilling> = {}): DaycareBilling => ({
  ...BILLING_DEFAULTS,
  plan: "monthly",
  firstCycleStart: "2026-01-01",
  ...overrides,
});

function priceFor(
  peak: number,
  opts: {
    plan?: DaycareBilling["plan"];
    cycleMonth?: string;
    billing?: Partial<DaycareBilling>;
  } = {}
) {
  return cyclePricing({
    plan: opts.plan ?? "monthly",
    peakChildren: peak,
    cycleMonth: opts.cycleMonth ?? "2026-01",
    billing: monthlyBilling({ plan: opts.plan ?? "monthly", ...opts.billing }),
    bands: STANDARD_PRICING_BANDS,
    settings: PRICING_SETTINGS_DEFAULTS,
  });
}

describe("Noor's band-resolution vectors (configured values, not code constants)", () => {
  it("bills the inclusive standard band at every boundary", () => {
    const cases: Array<[number, number, string]> = [
      [1, 600, "seed"],
      [15, 600, "seed"],
      [16, 950, "core"],
      [30, 950, "core"],
      [31, 1400, "standard"],
      [50, 1400, "standard"],
      [51, 1900, "plus"],
      [80, 1900, "plus"],
      [81, 2500, "enterprise"],
      [120, 2500, "enterprise"],
      [121, 2520, "enterprise_plus"],
      [150, 3100, "enterprise_plus"],
    ];
    for (const [children, amount, bandKey] of cases) {
      const p = priceFor(children);
      expect(p.grossAmount).toBe(amount);
      expect(p.band.key).toBe(bandKey);
      expect(p.standardAmountEgp).toBe(amount);
    }
  });

  it("founding year-1 steps to the standard band at month 13", () => {
    const founding = { foundingClient: true, foundingStartedAt: "2026-01-01" };
    expect(priceFor(22, { billing: founding }).grossAmount).toBe(810);
    expect(priceFor(22, { billing: founding, cycleMonth: "2026-12" }).grossAmount).toBe(810);
    expect(priceFor(22, { billing: founding, cycleMonth: "2027-01" }).grossAmount).toBe(950);
    expect(priceFor(45, { billing: founding }).grossAmount).toBe(1190);
    expect(priceFor(45, { billing: founding, cycleMonth: "2027-01" }).grossAmount).toBe(1400);
  });
});

describe("the invoice engine reads the operator configuration", () => {
  it("bills the configured band amount, not the legacy per-daycare settings", async () => {
    const iid = await newDaycare("monthly", "2026-01-01");
    // Legacy values that would bill 500 + 50/child under v1.
    await updateDaycareBilling(iid, { monthlyRateEgp: 500, perChildRateEgp: 50, freeChildThreshold: 10 });
    await seedChildren(iid, 22, "2025-12-01 09:00:00");

    expect(await generateDueInvoices(utcDate(2026, 2, 2))).toBe(1);
    const inv = (await listInvoices(iid))[0]!;
    expect(inv.bandKey).toBe("core");
    expect(inv.bandName).toBe("Core");
    expect(inv.totalAmount).toBe(950);
    expect(inv.flatRateAmount).toBe(950);
    expect(inv.standardMonthlyEgp).toBe(950);
    expect(inv.standardAmountEgp).toBe(950);
    expect(inv.foundingApplied).toBe(false);
    // The legacy snapshot columns are no longer the source of the amount.
    expect(inv.appliedMonthlyRate).toBe(950);
  });

  it("uses an operator-edited band amount on the next invoice", async () => {
    await updatePricingBand("seed", { monthlyEgp: 700 });
    const iid = await newDaycare("monthly", "2026-01-01");
    await seedChildren(iid, 5, "2025-12-01 09:00:00");
    await generateDueInvoices(utcDate(2026, 2, 2));
    expect((await listInvoices(iid))[0]!.totalAmount).toBe(700);
  });

  it("Enterprise+ monthly adds 20 per child above 120", async () => {
    const iid = await newDaycare("monthly", "2026-01-01");
    await seedChildren(iid, 130, "2025-12-01 09:00:00");
    await generateDueInvoices(utcDate(2026, 2, 2));
    const inv = (await listInvoices(iid))[0]!;
    expect(inv.bandKey).toBe("enterprise_plus");
    expect(inv.maxActiveChildren).toBe(130);
    expect(inv.billableChildren).toBe(10);
    expect(inv.incrementalRate).toBe(20);
    expect(inv.incrementalAmount).toBe(200);
    expect(inv.totalAmount).toBe(2700);
  });
});

describe("founding cohort", () => {
  it("keeps the year-1 rate for 12 months, then steps to standard at month 13", async () => {
    const iid = await newDaycare("monthly", "2026-01-01", {
      foundingClient: true,
      foundingStartedAt: "2026-01-01",
    });
    // Core founding client at 24 children; grows into Standard in month 3.
    await seedChildren(iid, 24, "2025-12-01 09:00:00");
    await seedChildren(iid, 11, "2026-03-01 09:00:00", "growth");

    // Catch up four years of cycles in one sweep.
    await generateDueInvoices(utcDate(2030, 1, 2));
    const invoices = (await listInvoices(iid)).sort((a, b) =>
      a.cycleMonth.localeCompare(b.cycleMonth)
    );
    const amount = (month: string) => invoices.find((i) => i.cycleMonth === month)!.totalAmount;

    // Year 1: fixed at 810 even after the band grew in month 3.
    for (const month of [
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
    ]) {
      expect(amount(month)).toBe(810);
    }
    // Month 13 steps once to the Standard band amount. There is no glide.
    expect(amount("2027-01")).toBe(1400);
    expect(amount("2028-01")).toBe(1400);
    expect(amount("2029-01")).toBe(1400);

    const yearOne = invoices.find((i) => i.cycleMonth === "2026-12")!;
    expect(yearOne.foundingApplied).toBe(true);
    expect(yearOne.foundingTermIndex).toBe(0);
    expect(yearOne.bandKey).toBe("standard");
    expect(yearOne.standardMonthlyEgp).toBe(1400);
    expect(yearOne.appliedMonthlyRateExact).toBe(810);

    const reviewTwo = invoices.find((i) => i.cycleMonth === "2028-01")!;
    expect(reviewTwo.glideCapped).toBe(false);
    expect(reviewTwo.foundingTermIndex).toBe(2);
    expect(reviewTwo.appliedMonthlyRateExact).toBe(1400);
  });

  it("enforces the configured founding cap in the data layer", async () => {
    await updatePricingSettings({ foundingCap: 1 });
    const first = await newDaycare("monthly", "2026-01-01", {
      foundingClient: true,
      foundingStartedAt: "2026-01-01",
    });
    const second = await newDaycare("monthly", "2026-01-01");
    await expect(
      updateDaycareBilling(second, { foundingClient: true })
    ).rejects.toThrow("founding-cap-reached");
    // An existing founding client can still have its dates edited.
    await updateDaycareBilling(first, { foundingClient: true, foundingStartedAt: "2026-01-02" });
  });

  it("a founding Core client at 22 children reviews to the standard 950, not 972", async () => {
    const iid = await newDaycare("monthly", "2026-01-01", {
      foundingClient: true,
      foundingStartedAt: "2026-01-01",
    });
    await seedChildren(iid, 22, "2025-12-01 09:00:00");
    await generateDueInvoices(utcDate(2027, 2, 2));
    const invoices = (await listInvoices(iid)).sort((a, b) =>
      a.cycleMonth.localeCompare(b.cycleMonth)
    );
    expect(invoices.find((i) => i.cycleMonth === "2026-12")!.totalAmount).toBe(810);
    const review = invoices.find((i) => i.cycleMonth === "2027-01")!;
    expect(review.totalAmount).toBe(950);
    expect(review.glideCapped).toBe(false);
  });
});

describe("pilot credit", () => {
  it("credits the configured pilot fee on the first invoice, within 14 days of pilot end", async () => {
    // Noor's vector: a 950 first invoice nets 600.
    const iid = await newDaycare("monthly", "2026-01-01", {
      foundingStartedAt: "2026-01-01",
      pilotEndDate: "2025-12-20",
    });
    await seedChildren(iid, 22, "2025-12-01 09:00:00");
    await generateDueInvoices(utcDate(2026, 3, 2));
    const invoices = (await listInvoices(iid)).sort((a, b) =>
      a.cycleMonth.localeCompare(b.cycleMonth)
    );
    expect(invoices[0]!.cycleMonth).toBe("2026-01");
    expect(invoices[0]!.pilotCreditEgp).toBe(350);
    expect(invoices[0]!.totalAmount).toBe(600); // 950 - 350
    expect(invoices[1]!.pilotCreditEgp).toBe(0);
    expect(invoices[1]!.totalAmount).toBe(950);

    // Seed founding vector: 510 - 350 = 160 net.
    const seedClient = await newDaycare("monthly", "2026-01-01", {
      foundingClient: true,
      foundingStartedAt: "2026-01-01",
      pilotEndDate: "2025-12-20",
    });
    await seedChildren(seedClient, 4, "2025-12-01 09:00:00");
    await generateDueInvoices(utcDate(2026, 2, 2));
    const seedInvoice = (await listInvoices(seedClient))[0]!;
    expect(seedInvoice.pilotCreditEgp).toBe(350);
    expect(seedInvoice.totalAmount).toBe(160);
  });

  it("gives no credit when signing is outside the configured window", async () => {
    const iid = await newDaycare("monthly", "2026-01-01", {
      foundingStartedAt: "2026-02-01",
      pilotEndDate: "2025-12-20",
    });
    await seedChildren(iid, 22, "2025-12-01 09:00:00");
    await generateDueInvoices(utcDate(2026, 2, 2));
    const inv = (await listInvoices(iid))[0]!;
    expect(inv.pilotCreditEgp).toBe(0);
    expect(inv.totalAmount).toBe(950);
  });

  it("carries a remainder to the next invoice only and never goes negative", async () => {
    await updatePricingSettings({ foundingPilotFeeEgp: 1000 });
    const iid = await newDaycare("monthly", "2026-01-01", {
      foundingClient: true,
      foundingStartedAt: "2026-01-01",
      pilotEndDate: "2025-12-20",
    });
    await seedChildren(iid, 4, "2025-12-01 09:00:00"); // Seed founding, 510/month
    await generateDueInvoices(utcDate(2026, 4, 2));
    const invoices = (await listInvoices(iid)).sort((a, b) =>
      a.cycleMonth.localeCompare(b.cycleMonth)
    );
    expect(invoices.map((i) => i.totalAmount)).toEqual([0, 20, 510]);
    expect(invoices.map((i) => i.pilotCreditEgp)).toEqual([510, 490, 0]);
    expect((await getPricingSettings()).foundingPilotFeeEgp).toBe(1000);
  });
});

describe("invoice snapshots stay frozen", () => {
  it("a later band edit never rewrites an issued invoice", async () => {
    const iid = await newDaycare("monthly", "2026-01-01");
    await seedChildren(iid, 22, "2025-12-01 09:00:00");
    await generateDueInvoices(utcDate(2026, 2, 2));
    const issued = (await listInvoices(iid))[0]!;
    expect(issued.totalAmount).toBe(950);

    await updatePricingBand("core", { monthlyEgp: 1100 });
    expect(await generateDueInvoices(utcDate(2026, 3, 2))).toBe(1);
    const invoices = await listInvoices(iid);
    const january = invoices.find((i) => i.cycleMonth === "2026-01")!;
    const february = invoices.find((i) => i.cycleMonth === "2026-02")!;
    expect(january.totalAmount).toBe(950);
    expect(january.standardMonthlyEgp).toBe(950);
    expect(february.totalAmount).toBe(1100);
    expect(february.standardMonthlyEgp).toBe(1100);
  });

  it("stores every pricing-v2 snapshot column", async () => {
    const iid = await newDaycare("monthly", "2026-01-01");
    await seedChildren(iid, 22, "2025-12-01 09:00:00");
    await generateDueInvoices(utcDate(2026, 2, 2));
    const inv = (await listInvoices(iid))[0]!;
    expect(inv.bandKey).toBe("core");
    expect(inv.standardMonthlyEgp).toBe(950);
    expect(inv.standardAmountEgp).toBe(950);
    expect(inv.appliedMonthlyRate).toBe(950);
    expect(inv.appliedMonthlyRateExact).toBe(950);
    expect(inv.foundingTermIndex).toBe(0);
    expect(inv.glideCapped).toBe(false);
    expect(inv.pilotCreditEgp).toBe(0);
    const row = await queryGet("SELECT * FROM daycare_invoice WHERE id = ?", inv.id);
    expect(String(row!.band_key)).toBe("core");
  });
});

describe("schema", () => {
  it("carries the pricing-v2 snapshot columns", async () => {
    const names = (await queryAll("PRAGMA table_info(daycare_invoice)")).map((c) => String(c.name));
    for (const col of [
      "band_key",
      "band_name",
      "standard_monthly_egp",
      "standard_amount_egp",
      "applied_monthly_rate_exact",
      "applied_monthly_rate",
      "founding_applied",
      "founding_term_index",
      "glide_capped",
      "pilot_credit_egp",
    ]) {
      expect(names).toContain(col);
    }
  });
});

describe("rowToBilling date shapes", () => {
  // KID-2435 regression: Postgres hands DATE/TIMESTAMP columns back as Date
  // objects. String(date).slice(0, 10) yielded "Thu Oct 01", so a Supabase
  // deployment never found the billing calendar and generated no invoices.
  it("normalises Postgres Date objects to YYYY-MM-DD", () => {
    const billing = rowToBilling({
      plan: "monthly",
      first_cycle_start: new Date(Date.UTC(2026, 9, 1)),
      founding_client: 1,
      founding_started_at: new Date(Date.UTC(2026, 9, 1)),
      pilot_end_date: new Date(Date.UTC(2026, 8, 25)),
    });
    expect(billing.firstCycleStart).toBe("2026-10-01");
    expect(billing.foundingStartedAt).toBe("2026-10-01");
    expect(billing.pilotEndDate).toBe("2026-09-25");
  });

  it("keeps SQLite text values byte-for-byte", () => {
    const billing = rowToBilling({
      plan: "monthly",
      first_cycle_start: "2026-10-01 00:00:00",
      founding_client: 0,
      founding_started_at: "2026-10-01",
      pilot_end_date: "",
    });
    expect(billing.firstCycleStart).toBe("2026-10-01");
    expect(billing.foundingStartedAt).toBe("2026-10-01");
    expect(billing.pilotEndDate).toBe("");
describe("v3 payment grace and read-only", () => {
  it("stays writable inside the 7-day grace, then becomes read-only without disabling the account", async () => {
    const iid = await newDaycare("monthly", "2026-03-01");
    await seedChildren(iid, 12, "2026-02-01 09:00:00");

    // Cycle 2026-03 closes 31 Mar, due 5 Apr, grace ends 12 Apr.
    await generateDueInvoices(utcDate(2026, 4, 1));
    const inGrace = await runBillingSweep(utcDate(2026, 4, 6));
    expect(inGrace.overdue).toBe(0);
    expect(await isInstituteReadOnly(iid)).toBe(false);
    expect((await listInvoices(iid))[0]!.status).toBe("pending");

    const afterGrace = await runBillingSweep(utcDate(2026, 4, 13));
    expect(afterGrace.overdue).toBe(1);
    expect((await listInvoices(iid))[0]!.status).toBe("overdue");
    // Read-only, not disabled: login still works and data is available.
    expect(Number((await store.getInstitute(iid))!.active)).toBe(1);
    expect(await isInstituteReadOnly(iid)).toBe(true);
  });
});

describe("v3 cancellation at the end of the paid month", () => {
  it("bills the paid months only and turns read-only the day after the cancellation date", async () => {
    const iid = await newDaycare("monthly", "2026-01-01");
    await seedChildren(iid, 12, "2025-12-01 09:00:00");
    await updateDaycareBilling(iid, { cancelAt: cycleEndDate("2026-02") });

    // Generation on 1 Jun would normally bill Jan-May; cancellation caps it
    // at the paid month (Feb).
    await generateDueInvoices(utcDate(2026, 6, 1));
    expect((await listInvoices(iid)).map((i) => i.cycleMonth).sort()).toEqual([
      "2026-01",
      "2026-02",
    ]);

    expect(await isInstituteReadOnly(iid, utcDate(2026, 2, 28))).toBe(false);
    expect(await isInstituteReadOnly(iid, utcDate(2026, 3, 1))).toBe(true);
  });

  it("clearing the cancellation date resumes billing for later cycles", async () => {
    const iid = await newDaycare("monthly", "2026-01-01");
    await seedChildren(iid, 12, "2025-12-01 09:00:00");
    await updateDaycareBilling(iid, { cancelAt: cycleEndDate("2026-02") });
    await generateDueInvoices(utcDate(2026, 6, 1));

    await updateDaycareBilling(iid, { cancelAt: "" });
    await generateDueInvoices(utcDate(2026, 6, 1));
    expect((await listInvoices(iid)).map((i) => i.cycleMonth).sort()).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
    ]);
    expect(await isInstituteReadOnly(iid, utcDate(2026, 6, 2))).toBe(false);
  });
});
