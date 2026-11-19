import { beforeEach, describe, expect, it } from "vitest";
import {
  PRICING_BAND_KEYS,
  PRICING_SETTINGS_DEFAULTS,
  STANDARD_PRICING_BANDS,
  bandRowTo,
  countFoundingClients,
  foundingDiscountPct,
  foundingOfferState,
  foundingYearOneForBand,
  getPricingBands,
  getPricingSettings,
  monthlyForBand,
  pilotCreditAmount,
  pilotCreditEligible,
  pricingBandForChildCount,
  updatePricingBand,
  updatePricingSettings,
  validatePricingBands,
} from "@/lib/pricing";
import { queryAll, queryGet, queryRun, type Row } from "@/lib/db";
import { dictionaries, keysOf } from "@/lib/i18n";
import { seedFixture } from "../helpers";

beforeEach(async () => {
  await seedFixture();
});

describe("the approved standard bands", () => {
  it("seeds all six bands with the KID-2433 amounts and ranges", async () => {
    const bands = await getPricingBands();
    expect(bands.map((b) => b.key)).toEqual(PRICING_BAND_KEYS);
    expect(bands.map((b) => [b.minChildren, b.maxChildren, b.monthlyEgp])).toEqual([
      [1, 15, 600],
      [16, 30, 950],
      [31, 50, 1400],
      [51, 80, 1900],
      [81, 120, 2500],
      [121, null, 2500],
    ]);
    expect(bands[5]!.perChildOverageEgp).toBe(20);
    expect(bands.every((b) => b.busTrackingIncluded)).toBe(true);
  });

  it("selects the band from the active-child count at every boundary", () => {
    const cases: Array<[number, string]> = [
      [1, "seed"],
      [15, "seed"],
      [16, "core"],
      [30, "core"],
      [31, "standard"],
      [50, "standard"],
      [51, "plus"],
      [80, "plus"],
      [81, "enterprise"],
      [120, "enterprise"],
      [121, "enterprise_plus"],
      [500, "enterprise_plus"],
    ];
    for (const [count, key] of cases) {
      expect(pricingBandForChildCount(count).key).toBe(key);
    }
  });

  it("Enterprise+ adds 20 EGP for each child above 120", () => {
    const band = pricingBandForChildCount(130);
    expect(band.key).toBe("enterprise_plus");
    expect(monthlyForBand(band, 120)).toBe(2500);
    expect(monthlyForBand(band, 121)).toBe(2520);
    expect(monthlyForBand(band, 130)).toBe(2700);
    expect(monthlyForBand(pricingBandForChildCount(30), 30)).toBe(950);
  });

  it("updates a monthly amount without storing an annual amount", async () => {
    const updated = await updatePricingBand("seed", { monthlyEgp: 700 });
    expect(updated.monthlyEgp).toBe(700);
    const row = await queryGet("SELECT * FROM pricing_band WHERE key = 'seed'");
    expect(Number(row!.monthly_egp)).toBe(700);
    expect(row).not.toHaveProperty("annual_egp");
  });

  it("refuses a gapped or overlapping ladder and keeps the stored bands intact", async () => {
    await expect(updatePricingBand("core", { minChildren: 15 })).rejects.toThrow(
      "pricing-band-ladder"
    );
    await expect(updatePricingBand("seed", { maxChildren: 20 })).rejects.toThrow(
      "pricing-band-ladder"
    );
    const bands = await getPricingBands();
    expect(bands.find((b) => b.key === "core")!.minChildren).toBe(16);
    expect(bands.find((b) => b.key === "seed")!.maxChildren).toBe(15);
  });

  it("refuses an unknown band and negative amounts", async () => {
    await expect(updatePricingBand("platinum", { monthlyEgp: 1 })).rejects.toThrow(
      "pricing-band-unknown"
    );
    await expect(updatePricingBand("seed", { monthlyEgp: -1 })).rejects.toThrow(
      "pricing-band-invalid"
    );
  });

  it("validatePricingBands accepts the defaults and reports broken ladders", () => {
    expect(() => validatePricingBands(STANDARD_PRICING_BANDS)).not.toThrow();
    const broken = STANDARD_PRICING_BANDS.map((b) =>
      b.key === "core" ? { ...b, minChildren: 17 } : b
    );
    expect(() => validatePricingBands(broken)).toThrow("pricing-band-ladder");
  });

  it("bandRowTo maps a database row to the typed band", () => {
    const row: Row = {
      key: "core",
      name: "Core",
      min_children: 16,
      max_children: 30,
      monthly_egp: 950,
      per_child_overage_egp: 0,
      founding_monthly_egp: 810,
      bus_tracking_included: 1,
      sort_order: 2,
    };
    expect(bandRowTo(row)).toEqual(STANDARD_PRICING_BANDS[1]);
  });
});

describe("demo plan configuration", () => {
  it("matches the approved time-box and limits", async () => {
    const settings = await getPricingSettings();
    expect(settings.demoTrialDays).toBe(30);
    expect(settings.demoRoomLimit).toBe(1);
    expect(settings.demoChildLimit).toBe(20);
    expect(settings.demoBrandedApp).toBe(false);
    expect(settings.demoBusTracking).toBe(false);
  });

  it("persists operator edits", async () => {
    await updatePricingSettings({ demoTrialDays: 14, demoChildLimit: 15 });
    const settings = await getPricingSettings();
    expect(settings.demoTrialDays).toBe(14);
    expect(settings.demoChildLimit).toBe(15);
    const row = await queryGet("SELECT value FROM pricing_config WHERE key = 'demo.trial_days'");
    expect(String(row!.value)).toBe("14");
  });

  it("refuses nonsense demo limits", async () => {
    await expect(updatePricingSettings({ demoRoomLimit: 0 })).rejects.toThrow(
      "pricing-setting-invalid"
    );
    await expect(updatePricingSettings({ demoTrialDays: -1 })).rejects.toThrow(
      "pricing-setting-invalid"
    );
  });
});

describe("founding cohort configuration", () => {
  it("keeps the year-1 amounts and the ~15% discount on each paid band", async () => {
    const bands = await getPricingBands();
    expect(bands.map(foundingYearOneForBand)).toEqual([510, 810, 1190, 1620, 2130, null]);
    for (const band of bands) {
      if (band.foundingMonthlyEgp === null) continue;
      expect(foundingDiscountPct(band)).toBe(15);
      expect(band.foundingMonthlyEgp).toBeLessThan(band.monthlyEgp);
    }
  });

  it("configures the cap, 90-day window, pilot and glide rule", async () => {
    const settings = await getPricingSettings();
    expect(settings.foundingEnabled).toBe(true);
    expect(settings.foundingCap).toBe(10);
    expect(settings.foundingOfferDays).toBe(90);
    expect(settings.foundingPilotFeeEgp).toBe(350);
    expect(settings.foundingPilotDays).toBe(30);
    expect(settings.foundingPilotRoomLimit).toBe(1);
    expect(settings.foundingPilotChildLimit).toBe(20);
    expect(settings.foundingPilotCreditDays).toBe(14);
    expect(settings.billingGraceDays).toBe(7);
  });

  it("opens for 90 days from launch, then closes, and closes early at the cap", () => {
    const settings = {
      ...PRICING_SETTINGS_DEFAULTS,
      foundingLaunchDate: "2026-01-01",
    };
    expect(foundingOfferState(settings, 0, new Date("2026-01-01T00:00:00Z")).status).toBe("open");
    expect(foundingOfferState(settings, 0, new Date("2026-03-31T00:00:00Z")).status).toBe("open");
    expect(foundingOfferState(settings, 0, new Date("2026-04-01T00:00:00Z")).status).toBe("closed");
    expect(foundingOfferState(settings, 0, new Date("2025-12-31T00:00:00Z")).status).toBe("not_started");
    expect(foundingOfferState(settings, 10, new Date("2026-01-10T00:00:00Z")).status).toBe("closed");
    expect(foundingOfferState({ ...settings, foundingEnabled: false }, 0).status).toBe("disabled");
    expect(foundingOfferState({ ...settings, foundingLaunchDate: "" }, 0).status).toBe("not_started");
  });

  it("credits the 350 pilot fee only when signing within 14 days of pilot end", () => {
    const settings = PRICING_SETTINGS_DEFAULTS;
    expect(pilotCreditEligible("2026-01-31", "2026-02-01", 14)).toBe(true);
    expect(pilotCreditEligible("2026-01-31", "2026-02-14", 14)).toBe(true);
    expect(pilotCreditEligible("2026-01-31", "2026-02-15", 14)).toBe(false);
    expect(pilotCreditEligible("2026-01-31", "2026-01-30", 14)).toBe(false);
    expect(pilotCreditAmount(settings, true)).toBe(350);
    expect(pilotCreditAmount(settings, false)).toBe(0);
  });

  it("counts only daycares marked as founding clients", async () => {
    expect(await countFoundingClients()).toBe(0);
    const institute = await queryGet("SELECT id FROM institute LIMIT 1");
    await queryRun("UPDATE daycare_billing SET founding_client = 1 WHERE institute_id = ?", String(institute!.id));
    expect(await countFoundingClients()).toBe(1);
  });
});

describe("schema", () => {
  it("carries the pricing tables, the founding-client flag and the seed policy", async () => {
    const bandCols = (await queryAll("PRAGMA table_info(pricing_band)")) as Row[];
    for (const col of [
      "key",
      "name",
      "min_children",
      "max_children",
      "monthly_egp",
      "per_child_overage_egp",
      "founding_monthly_egp",
      "bus_tracking_included",
      "sort_order",
    ]) {
      expect(bandCols.map((c) => String(c.name))).toContain(col);
    }
    const billingCols = (await queryAll("PRAGMA table_info(daycare_billing)")) as Row[];
    expect(billingCols.map((c) => String(c.name))).toContain("founding_client");
    expect((await queryAll("SELECT key FROM pricing_config")).length).toBe(15);
  });
});

describe("i18n", () => {
  it("carries the pricing labels in both EN and AR with matching key sets", () => {
    const pricingKeys = (dict: Record<string, unknown>) =>
      keysOf(dict as never).filter((k) => k.startsWith("platform.pricing"));
    expect(pricingKeys(dictionaries.en).length).toBeGreaterThan(20);
    expect(pricingKeys(dictionaries.ar).sort()).toEqual(pricingKeys(dictionaries.en).sort());
  });
});
