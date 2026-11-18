import { queryAll, queryGet, queryRun, type Row } from "./db";

export const ANNUAL_MULTIPLIER = 10;

export type PricingBandKey =
  | "seed"
  | "core"
  | "standard"
  | "plus"
  | "enterprise"
  | "enterprise_plus";

export const PRICING_BAND_KEYS: PricingBandKey[] = [
  "seed",
  "core",
  "standard",
  "plus",
  "enterprise",
  "enterprise_plus",
];

export type PricingBand = {
  key: PricingBandKey;
  name: string;
  minChildren: number;
  maxChildren: number | null;
  monthlyEgp: number;
  annualEgp: number | null;
  annualIsQuote: boolean;
  perChildOverageEgp: number;
  foundingMonthlyEgp: number | null;
  busTrackingIncluded: boolean;
  sortOrder: number;
};

export const STANDARD_PRICING_BANDS: PricingBand[] = [
  {
    key: "seed",
    name: "Seed",
    minChildren: 1,
    maxChildren: 15,
    monthlyEgp: 600,
    annualEgp: 6000,
    annualIsQuote: false,
    perChildOverageEgp: 0,
    foundingMonthlyEgp: 510,
    busTrackingIncluded: true,
    sortOrder: 1,
  },
  {
    key: "core",
    name: "Core",
    minChildren: 16,
    maxChildren: 30,
    monthlyEgp: 950,
    annualEgp: 9500,
    annualIsQuote: false,
    perChildOverageEgp: 0,
    foundingMonthlyEgp: 810,
    busTrackingIncluded: true,
    sortOrder: 2,
  },
  {
    key: "standard",
    name: "Standard",
    minChildren: 31,
    maxChildren: 50,
    monthlyEgp: 1400,
    annualEgp: 14000,
    annualIsQuote: false,
    perChildOverageEgp: 0,
    foundingMonthlyEgp: 1190,
    busTrackingIncluded: true,
    sortOrder: 3,
  },
  {
    key: "plus",
    name: "Plus",
    minChildren: 51,
    maxChildren: 80,
    monthlyEgp: 1900,
    annualEgp: 19000,
    annualIsQuote: false,
    perChildOverageEgp: 0,
    foundingMonthlyEgp: 1620,
    busTrackingIncluded: true,
    sortOrder: 4,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    minChildren: 81,
    maxChildren: 120,
    monthlyEgp: 2500,
    annualEgp: 25000,
    annualIsQuote: false,
    perChildOverageEgp: 0,
    foundingMonthlyEgp: 2130,
    busTrackingIncluded: true,
    sortOrder: 5,
  },
  {
    key: "enterprise_plus",
    name: "Enterprise+",
    minChildren: 121,
    maxChildren: null,
    monthlyEgp: 2500,
    annualEgp: null,
    annualIsQuote: true,
    perChildOverageEgp: 20,
    foundingMonthlyEgp: null,
    busTrackingIncluded: true,
    sortOrder: 6,
  },
];

export type PricingSettings = {
  demoTrialDays: number;
  demoRoomLimit: number;
  demoChildLimit: number;
  demoBrandedApp: boolean;
  demoBusTracking: boolean;
  foundingEnabled: boolean;
  foundingCap: number;
  foundingOfferDays: number;
  foundingLaunchDate: string;
  foundingPilotFeeEgp: number;
  foundingPilotDays: number;
  foundingPilotRoomLimit: number;
  foundingPilotChildLimit: number;
  foundingPilotCreditDays: number;
  foundingGlideMaxIncreasePct: number;
};

export const PRICING_SETTINGS_DEFAULTS: PricingSettings = {
  demoTrialDays: 30,
  demoRoomLimit: 1,
  demoChildLimit: 20,
  demoBrandedApp: false,
  demoBusTracking: false,
  foundingEnabled: true,
  foundingCap: 10,
  foundingOfferDays: 90,
  foundingLaunchDate: "",
  foundingPilotFeeEgp: 350,
  foundingPilotDays: 30,
  foundingPilotRoomLimit: 1,
  foundingPilotChildLimit: 20,
  foundingPilotCreditDays: 14,
  foundingGlideMaxIncreasePct: 20,
};

const SETTING_KEYS: Record<keyof PricingSettings, string> = {
  demoTrialDays: "demo.trial_days",
  demoRoomLimit: "demo.room_limit",
  demoChildLimit: "demo.child_limit",
  demoBrandedApp: "demo.branded_app",
  demoBusTracking: "demo.bus_tracking",
  foundingEnabled: "founding.enabled",
  foundingCap: "founding.cap",
  foundingOfferDays: "founding.offer_days",
  foundingLaunchDate: "founding.launch_date",
  foundingPilotFeeEgp: "founding.pilot_fee_egp",
  foundingPilotDays: "founding.pilot_days",
  foundingPilotRoomLimit: "founding.pilot_room_limit",
  foundingPilotChildLimit: "founding.pilot_child_limit",
  foundingPilotCreditDays: "founding.pilot_credit_days",
  foundingGlideMaxIncreasePct: "founding.glide_max_increase_pct",
};

const BOOLEAN_SETTINGS = new Set<keyof PricingSettings>([
  "demoBrandedApp",
  "demoBusTracking",
  "foundingEnabled",
]);

const NON_NEGATIVE_SETTINGS = new Set<keyof PricingSettings>([
  "demoTrialDays",
  "demoRoomLimit",
  "demoChildLimit",
  "foundingCap",
  "foundingOfferDays",
  "foundingPilotFeeEgp",
  "foundingPilotDays",
  "foundingPilotRoomLimit",
  "foundingPilotChildLimit",
  "foundingPilotCreditDays",
  "foundingGlideMaxIncreasePct",
]);

function clampInt(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

function isBandKey(value: unknown): value is PricingBandKey {
  return (PRICING_BAND_KEYS as readonly string[]).includes(String(value));
}

export function bandRowTo(row: Row): PricingBand {
  const key = isBandKey(row.key) ? row.key : "seed";
  return {
    key,
    name: String(row.name ?? key),
    minChildren: clampInt(row.min_children, 1),
    maxChildren:
      row.max_children === null || row.max_children === undefined
        ? null
        : clampInt(row.max_children, 0),
    monthlyEgp: clampInt(row.monthly_egp, 0),
    annualEgp:
      row.annual_egp === null || row.annual_egp === undefined
        ? null
        : clampInt(row.annual_egp, 0),
    annualIsQuote: bool(row.annual_is_quote, false),
    perChildOverageEgp: clampInt(row.per_child_overage_egp, 0),
    foundingMonthlyEgp:
      row.founding_monthly_egp === null || row.founding_monthly_egp === undefined
        ? null
        : clampInt(row.founding_monthly_egp, 0),
    busTrackingIncluded: bool(row.bus_tracking_included, true),
    sortOrder: clampInt(row.sort_order, 0),
  };
}

export function annualForMonthly(monthlyEgp: number): number {
  return Math.round(Number(monthlyEgp) || 0) * ANNUAL_MULTIPLIER;
}

export function pricingBandForChildCount(
  childCount: number,
  bands: PricingBand[] = STANDARD_PRICING_BANDS
): PricingBand {
  const n = Math.max(0, Math.round(Number(childCount) || 0));
  const sorted = [...bands].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const band of sorted) {
    if (n >= band.minChildren && (band.maxChildren === null || n <= band.maxChildren)) {
      return band;
    }
  }
  return sorted[0] ?? STANDARD_PRICING_BANDS[0]!;
}

export function monthlyForBand(band: PricingBand, childCount: number): number {
  const n = Math.max(0, Math.round(Number(childCount) || 0));
  if (band.maxChildren === null && band.perChildOverageEgp > 0) {
    const included = Math.max(0, band.minChildren - 1);
    return band.monthlyEgp + Math.max(0, n - included) * band.perChildOverageEgp;
  }
  return band.monthlyEgp;
}

export function annualForBand(band: PricingBand): number | null {
  return band.annualIsQuote ? null : annualForMonthly(band.monthlyEgp);
}

export function foundingYearOneForBand(band: PricingBand): number | null {
  return band.foundingMonthlyEgp;
}

export function foundingDiscountPct(band: PricingBand): number | null {
  if (band.foundingMonthlyEgp === null || band.monthlyEgp <= 0) return null;
  return Math.round((1 - band.foundingMonthlyEgp / band.monthlyEgp) * 100);
}

export type FoundingOfferState = {
  status: "disabled" | "not_started" | "open" | "closed";
  endsAt: string;
  signedClients: number;
  cap: number;
  capReached: boolean;
};

export function foundingOfferState(
  settings: PricingSettings,
  signedClients: number,
  now: Date = new Date()
): FoundingOfferState {
  const signed = Math.max(0, Math.round(Number(signedClients) || 0));
  const capReached = signed >= settings.foundingCap;
  const base = {
    signedClients: signed,
    cap: settings.foundingCap,
    capReached,
    endsAt: "",
  };
  if (!settings.foundingEnabled) return { ...base, status: "disabled" };
  if (capReached) return { ...base, status: "closed" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settings.foundingLaunchDate)) {
    return { ...base, status: "not_started" };
  }
  const launch = new Date(`${settings.foundingLaunchDate}T00:00:00Z`);
  if (Number.isNaN(launch.getTime())) return { ...base, status: "not_started" };
  const end = new Date(launch.getTime() + settings.foundingOfferDays * 86400000);
  const endsAt = end.toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  if (today < settings.foundingLaunchDate) return { ...base, status: "not_started", endsAt };
  if (today >= endsAt) return { ...base, status: "closed", endsAt };
  return { ...base, status: "open", endsAt };
}

export function pilotCreditEligible(
  pilotEndDate: string,
  signedDate: string,
  creditDays: number
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}/.test(pilotEndDate) || !/^\d{4}-\d{2}-\d{2}/.test(signedDate)) {
    return false;
  }
  const end = Date.parse(`${pilotEndDate.slice(0, 10)}T00:00:00Z`);
  const signed = Date.parse(`${signedDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(signed)) return false;
  const days = (signed - end) / 86400000;
  return days >= 0 && days <= Math.max(0, creditDays);
}

export function pilotCreditAmount(settings: PricingSettings, eligible: boolean): number {
  return eligible ? settings.foundingPilotFeeEgp : 0;
}

export function glideMaxNextAmount(previousAmountEgp: number, maxIncreasePct: number): number {
  const prev = Math.max(0, Number(previousAmountEgp) || 0);
  const pct = Math.max(0, Number(maxIncreasePct) || 0);
  return Math.floor(prev * (1 + pct / 100));
}

/** KID-2435: the exact (unrounded) glide rate. The approved 20% cap compounds
 *  on the rate itself, so the engine keeps the fractional EGP here and rounds
 *  only when it bills: 810 -> 972 -> 1,166.4 -> 1,399.68 stays under the
 *  1,400 Standard band and is billed as 1,400. */
export function glideRateExact(
  previousRateEgp: number,
  standardMonthlyEgp: number,
  maxIncreasePct: number
): number {
  const prev = Math.max(0, Number(previousRateEgp) || 0);
  const standard = Math.max(0, Number(standardMonthlyEgp) || 0);
  const pct = Math.max(0, Number(maxIncreasePct) || 0);
  return Math.min(standard, prev * (1 + pct / 100));
}

/** Whole calendar months from `fromIso` to `toIso` (day-of-month aware): a
 *  founding term that starts on the 15th does not roll over on the 1st of the
 *  anniversary month. */
export function wholeMonthsBetween(fromIso: string, toIso: string): number {
  const from = /^\d{4}-\d{2}-\d{2}/.exec(fromIso);
  const to = /^\d{4}-\d{2}-\d{2}/.exec(toIso);
  if (!from || !to) return 0;
  const [fy, fm, fd] = from[0].slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = to[0].slice(0, 10).split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}

/** KID-2435: which 12-month founding term a cycle falls in. 0 = the year-1
 *  founding rate, 1 = the first review, and so on. */
export function foundingTermIndex(foundingStartedAt: string, cycleStartIso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}/.test(foundingStartedAt)) return 0;
  return Math.max(0, Math.floor(wholeMonthsBetween(foundingStartedAt, cycleStartIso) / 12));
}

export function validatePricingBands(bands: PricingBand[]): void {
  const sorted = [...bands].sort((a, b) => a.sortOrder - b.sortOrder);
  if (sorted.length === 0) throw new Error("pricing-band-ladder");
  for (const band of sorted) {
    if (band.minChildren < 1) throw new Error("pricing-band-invalid");
    if (band.maxChildren !== null && band.maxChildren < band.minChildren) {
      throw new Error("pricing-band-invalid");
    }
    if (band.monthlyEgp < 0 || band.perChildOverageEgp < 0) {
      throw new Error("pricing-band-invalid");
    }
    if (band.annualIsQuote) {
      if (band.annualEgp !== null || band.maxChildren !== null) {
        throw new Error("pricing-band-invalid");
      }
    } else if (band.annualEgp !== annualForMonthly(band.monthlyEgp)) {
      throw new Error("pricing-band-annual-rule");
    }
  }
  if (sorted[0]!.minChildren !== 1) throw new Error("pricing-band-ladder");
  if (sorted[sorted.length - 1]!.maxChildren !== null) throw new Error("pricing-band-ladder");
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const current = sorted[i]!;
    if (prev.maxChildren === null || current.minChildren !== prev.maxChildren + 1) {
      throw new Error("pricing-band-ladder");
    }
  }
}

export async function getPricingBands(): Promise<PricingBand[]> {
  const rows = await queryAll("SELECT * FROM pricing_band ORDER BY sort_order, key");
  if (rows.length === 0) return STANDARD_PRICING_BANDS;
  return rows.map(bandRowTo);
}

export async function getPricingSettings(): Promise<PricingSettings> {
  const rows = await queryAll("SELECT key, value FROM pricing_config");
  const values = new Map(rows.map((r) => [String(r.key), String(r.value)]));
  const settings = { ...PRICING_SETTINGS_DEFAULTS };
  for (const key of Object.keys(SETTING_KEYS) as Array<keyof PricingSettings>) {
    const raw = values.get(SETTING_KEYS[key]);
    if (raw === undefined) continue;
    if (BOOLEAN_SETTINGS.has(key)) {
      settings[key] = bool(raw, settings[key] as boolean) as never;
    } else if (key === "foundingLaunchDate") {
      settings.foundingLaunchDate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
    } else {
      settings[key] = clampInt(raw, settings[key] as number) as never;
    }
  }
  return settings;
}

export type PricingBandPatch = Partial<{
  name: string;
  minChildren: number;
  maxChildren: number | null;
  monthlyEgp: number;
  annualIsQuote: boolean;
  perChildOverageEgp: number;
  foundingMonthlyEgp: number | null;
  busTrackingIncluded: boolean;
  sortOrder: number;
}>;

export async function updatePricingBand(
  key: string,
  patch: PricingBandPatch
): Promise<PricingBand> {
  if (!isBandKey(key)) throw new Error("pricing-band-unknown");
  const bands = await getPricingBands();
  const index = bands.findIndex((b) => b.key === key);
  if (index < 0) throw new Error("pricing-band-unknown");
  const current = bands[index]!;
  const next: PricingBand = { ...current };
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw new Error("pricing-band-invalid");
    next.name = name;
  }
  if (patch.minChildren !== undefined) next.minChildren = Math.round(Number(patch.minChildren));
  if (patch.maxChildren !== undefined) {
    next.maxChildren =
      patch.maxChildren === null ? null : Math.round(Number(patch.maxChildren));
  }
  if (patch.monthlyEgp !== undefined) next.monthlyEgp = Math.round(Number(patch.monthlyEgp));
  if (patch.annualIsQuote !== undefined) next.annualIsQuote = !!patch.annualIsQuote;
  if (patch.perChildOverageEgp !== undefined) {
    next.perChildOverageEgp = Math.round(Number(patch.perChildOverageEgp));
  }
  if (patch.foundingMonthlyEgp !== undefined) {
    next.foundingMonthlyEgp =
      patch.foundingMonthlyEgp === null ? null : Math.round(Number(patch.foundingMonthlyEgp));
  }
  if (patch.busTrackingIncluded !== undefined) {
    next.busTrackingIncluded = !!patch.busTrackingIncluded;
  }
  if (patch.sortOrder !== undefined) next.sortOrder = Math.round(Number(patch.sortOrder));
  if (
    !Number.isFinite(next.minChildren) ||
    !Number.isFinite(next.monthlyEgp) ||
    !Number.isFinite(next.perChildOverageEgp) ||
    (next.maxChildren !== null && !Number.isFinite(next.maxChildren)) ||
    (next.foundingMonthlyEgp !== null && !Number.isFinite(next.foundingMonthlyEgp))
  ) {
    throw new Error("pricing-band-invalid");
  }
  next.annualEgp = next.annualIsQuote ? null : annualForMonthly(next.monthlyEgp);
  const candidate = bands.map((b) => (b.key === key ? next : b));
  validatePricingBands(candidate);
  await queryRun(
    `UPDATE pricing_band
     SET name = ?, min_children = ?, max_children = ?, monthly_egp = ?,
         annual_egp = ?, annual_is_quote = ?, per_child_overage_egp = ?,
         founding_monthly_egp = ?, bus_tracking_included = ?, sort_order = ?,
         updated_at = ?
     WHERE key = ?`,
    next.name,
    next.minChildren,
    next.maxChildren,
    next.monthlyEgp,
    next.annualEgp,
    next.annualIsQuote ? 1 : 0,
    next.perChildOverageEgp,
    next.foundingMonthlyEgp,
    next.busTrackingIncluded ? 1 : 0,
    next.sortOrder,
    new Date().toISOString(),
    key
  );
  return next;
}

export async function updatePricingSettings(
  patch: Partial<PricingSettings>
): Promise<PricingSettings> {
  const current = await getPricingSettings();
  const next = { ...current };
  for (const key of Object.keys(patch) as Array<keyof PricingSettings>) {
    const value = patch[key];
    if (value === undefined) continue;
    if (BOOLEAN_SETTINGS.has(key)) {
      next[key] = !!value as never;
      continue;
    }
    if (key === "foundingLaunchDate") {
      const raw = String(value).trim();
      if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("pricing-setting-invalid");
      next.foundingLaunchDate = raw;
      continue;
    }
    if (NON_NEGATIVE_SETTINGS.has(key)) {
      const n = Math.round(Number(value));
      if (!Number.isFinite(n) || n < 0) throw new Error("pricing-setting-invalid");
      next[key] = n as never;
    }
  }
  if (next.demoRoomLimit < 1 || next.demoChildLimit < 1) {
    throw new Error("pricing-setting-invalid");
  }
  if (next.foundingPilotDays < 1 || next.foundingPilotRoomLimit < 1 || next.foundingPilotChildLimit < 1) {
    throw new Error("pricing-setting-invalid");
  }
  if (next.foundingGlideMaxIncreasePct > 100) throw new Error("pricing-setting-invalid");
  const now = new Date().toISOString();
  for (const key of Object.keys(SETTING_KEYS) as Array<keyof PricingSettings>) {
    if (patch[key] === undefined) continue;
    const raw = BOOLEAN_SETTINGS.has(key) ? (next[key] ? "1" : "0") : String(next[key]);
    await queryRun(
      `INSERT INTO pricing_config (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      SETTING_KEYS[key],
      raw,
      now
    );
  }
  return next;
}

export async function countFoundingClients(): Promise<number> {
  const row = await queryGet(
    "SELECT COUNT(*) AS n FROM daycare_billing WHERE founding_client = 1"
  );
  return Number(row?.n ?? 0);
}
