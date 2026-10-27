// KID-244: the billing-configuration store (Finance/1, parent KID-243).
//
// Reads/writes the per-daycare subscription settings created by
// supabase/migrations/0027_daycare_billing.sql (mirrored in sqlite-schema.ts).
// This module only stores configuration; the actual invoicing engine ships
// with Finance/2. All amounts are integers in Egyptian Pounds (EGP).
//
// The "signup month is free" rule lives in firstCycleStart: a new daycare's
// cycle starts on the 1st of the month AFTER signup. It is written at
// creation (and backfilled for pre-existing institutes at migration time,
// computed from created_at, never from "now") — the operator can shift the
// date afterwards like every other setting.

import { queryGet, queryRun, type Row } from "./db";

export type BillingPlan = "demo" | "monthly" | "annual";

export const BILLING_PLANS: BillingPlan[] = ["demo", "monthly", "annual"];

/** The platform defaults — every create-daycare form field is prefilled and
 *  editable; a stored row that predates a new column reads these too. */
export const BILLING_DEFAULTS = {
  plan: "demo" as BillingPlan,
  monthlyRateEgp: 500,
  perChildRateEgp: 50,
  freeChildThreshold: 10,
  annualAmountEgp: 24000,
};

export type DaycareBilling = {
  plan: BillingPlan;
  monthlyRateEgp: number;
  perChildRateEgp: number;
  freeChildThreshold: number;
  annualAmountEgp: number;
  /** ISO date (YYYY-MM-DD) of the first billed month, or "" when the row has
   *  no stored cycle start — the UI then treats the signup month as free and
   *  the invoicing engine (Finance/2) falls back to institute.created_at. */
  firstCycleStart: string;
};

/** The 1st of the month after `date` (the signup month is free). Pure; also
 *  used by tests and the HTTP/input wiring of the billing page. */
export function nextMonthStart(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
}

function mapPlan(raw: unknown): BillingPlan {
  const plan = String(raw ?? "");
  return (BILLING_PLANS as string[]).includes(plan) ? (plan as BillingPlan) : "demo";
}

function clampInt(v: unknown, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function rowToBilling(row: Row): DaycareBilling {
  return {
    plan: mapPlan(row.plan),
    monthlyRateEgp: clampInt(row.monthly_rate_egp ?? row.monthlyRateEgp, BILLING_DEFAULTS.monthlyRateEgp),
    perChildRateEgp: clampInt(row.per_child_rate_egp ?? row.perChildRateEgp, BILLING_DEFAULTS.perChildRateEgp),
    freeChildThreshold: clampInt(row.free_child_threshold ?? row.freeChildThreshold, BILLING_DEFAULTS.freeChildThreshold),
    annualAmountEgp: clampInt(row.annual_amount_egp ?? row.annualAmountEgp, BILLING_DEFAULTS.annualAmountEgp),
    firstCycleStart: String((row.first_cycle_start ?? row.firstCycleStart ?? "")).slice(0, 10),
  };
}

/** A daycare's billing settings. Reads the stored row; a daycare without one
 *  (brand new install, pre-migration data the backfill has not covered) gets
 *  the platform defaults — never a crash, never an unfinished read. */
export async function getDaycareBilling(instituteId: string): Promise<DaycareBilling> {
  const row = await queryGet("SELECT * FROM daycare_billing WHERE institute_id = ?", instituteId);
  if (row) return rowToBilling(row);
  const inst = await queryGet("SELECT created_at FROM institute WHERE id = ?", instituteId);
  const created = inst?.created_at ? new Date(String(inst.created_at)) : new Date();
  return {
    ...BILLING_DEFAULTS,
    firstCycleStart: Number.isNaN(created.getTime())
      ? nextMonthStart(new Date())
      : nextMonthStart(created),
  };
}

/** The monthly invoice amount for a daycare with `childCount` enrolled
 *  children (billing engine v1, already used by the settings UI preview):
 *  - demo bills 0, always.
 *  - annual bills the day rate — represented here as the flat annual amount
 *    (the actual billing is once per cycle in Finance/2).
 *  - monthly bills the flat rate; each child ABOVE the free threshold is the
 *    incremental rate — child #11 is the first charged child for the
 *    default threshold of 10. */
export function cycleAmountEgp(b: DaycareBilling, childCount: number): number {
  if (b.plan === "demo") return 0;
  if (b.plan === "annual") return b.annualAmountEgp;
  const extra = Math.max(0, Math.round(Number(childCount) || 0) - b.freeChildThreshold);
  return b.monthlyRateEgp + extra * b.perChildRateEgp;
}

/** The count the billing preview and the invoicing engine bill on: active
 *  children only (lib/sqlite-schema.ts line ~92 — withdrawn children never
 *  inflate the invoice). */
export async function enrolledChildCount(instituteId: string): Promise<number> {
  const row = await queryGet(
    "SELECT COUNT(*) AS n FROM child WHERE institute_id = ? AND status = 'active'",
    instituteId
  );
  return Number(row?.n ?? 0);
}

export type BillingPatch = Partial<{
  plan: BillingPlan;
  monthlyRateEgp: number;
  perChildRateEgp: number;
  freeChildThreshold: number;
  annualAmountEgp: number;
  firstCycleStart: string;
  touchedAt: string;
}>;

const NUMERIC_FIELDS = [
  ["monthlyRateEgp", "monthly_rate_egp"],
  ["perChildRateEgp", "per_child_rate_egp"],
  ["freeChildThreshold", "free_child_threshold"],
  ["annualAmountEgp", "annual_amount_egp"],
] as const;

/** Writes (upserts) a daycare's billing settings. Validates up front — an
 *  unknown plan or a negative amount throws a named error the action surfaces
 *  as a friendly message; multi-field writes stay consistent because every
 *  accepted field lands in one statement. */
export async function updateDaycareBilling(instituteId: string, patch: BillingPatch): Promise<void> {
  if (patch.plan !== undefined && !(BILLING_PLANS as string[]).includes(patch.plan)) {
    throw new Error("billing-plan-invalid");
  }
  for (const [key, column] of NUMERIC_FIELDS) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`billing-${column}-invalid`);
  }
  if (patch.firstCycleStart !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(patch.firstCycleStart)) {
    throw new Error("billing-cycle-invalid");
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.plan !== undefined) {
    sets.push("plan = ?");
    values.push(patch.plan);
  }
  for (const [key, column] of NUMERIC_FIELDS) {
    if (patch[key] === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(Math.round(Number(patch[key])));
  }
  if (patch.firstCycleStart !== undefined) {
    sets.push("first_cycle_start = ?");
    values.push(patch.firstCycleStart);
  }
  sets.push("updated_at = ?");
  values.push(patch.touchedAt ?? new Date().toISOString());
  const setCols = sets.map((s) => s.split(" = ")[0]!);
  const columns = ["institute_id", ...setCols];
  // One statement for both engines: INSERT ... ON CONFLICT covers SQLite and
  // Postgres alike, so a fresh row and an existing one follow the same path
  // and the two engines can never drift apart. The DO UPDATE branch repeats
  // the SET assignments, which is where the untouched values keep their raw
  // form (no read-modify-write, no lost update between read and write).
  const conflictCols = new Set(["institute_id", "updated_at"]);
  const updateSets = sets.filter((s) => !conflictCols.has(s.split(" = ")[0]!));
  if (updateSets.length === 0) updateSets.push("updated_at = excluded.updated_at");
  await queryRun(
    `INSERT INTO daycare_billing (${columns.join(", ")})
     VALUES (?, ${sets.map(() => "?").join(", ")})
     ON CONFLICT (institute_id) DO UPDATE SET ${updateSets.join(", ")}`,
    instituteId,
    ...values,
    ...values.filter((_, i) => !conflictCols.has(setCols[i]!)),
  );
}
