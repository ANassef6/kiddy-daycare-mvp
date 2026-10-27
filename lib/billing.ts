// KID-244: the billing-configuration store (Finance/1, parent KID-243).
//
// Reads/writes the per-daycare subscription settings created by
// supabase/migrations/0027_daycare_billing.sql (mirrored in sqlite-schema.ts).
// All amounts are integers in Egyptian Pounds (EGP).
//
// KID-245: Finance/2 — the invoice engine lives in this module too (the
// configuration half and the billing half share the settings shape):
//   - a daycare's cycle starts the 1st of the month after signup (the signup
//     month is free) — first_cycle_start, written at creation;
//   - an invoice is generated when its cycle ends, due by the 5th of the
//     following month;
//   - the billed child count is the PEAK number of children active at any
//     point during the cycle (not the end-of-month count);
//   - monthly total = flat rate + max(0, peak - freeChildThreshold) x rate
//     (board-confirmed on KID-243: only children from #11 onward add 50 EGP);
//   - annual: one invoice per 12-month block at annual_amount_egp;
//   - demo: no invoices at all;
//   - an invoice past its due date and unpaid makes the daycare overdue ->
//     institute.active = 0 (the existing KID-199.3 disable), which blocks
//     every user at login; marking the invoice paid re-activates the daycare;
//   - the operator can override an invoice's total (with a note) before
//     payment; paid invoices are locked.
//
// The engine is lazy: runBillingSweep() is invoked from the bootstrap pass
// (lib/bootstrap.ts), so no external scheduler is needed — the same pattern
// the KID-86 withdrawal sweep uses. It is idempotent (unique
// (institute_id, cycle_month)), so warm instances re-running it change
// nothing.
//
// The "signup month is free" rule lives in firstCycleStart: a new daycare's
// cycle starts on the 1st of the month AFTER signup. It is written at
// creation (and backfilled for pre-existing institutes at migration time,
// computed from created_at, never from "now") — the operator can shift the
// date afterwards like every other setting.

import { queryAll, queryGet, queryRun, uid, type Row } from "./db";

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

// ---------------------------------------------------------------------------
// KID-245: Finance/2 — the invoice engine (daycare_invoice, migration 0028)
// ---------------------------------------------------------------------------

export const INVOICE_STATUSES = ["pending", "paid", "overdue"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type DaycareInvoice = {
  id: string;
  instituteId: string;
  /** First month of the billed cycle, YYYY-MM (the month itself for monthly
   *  plans, the first month of a 12-month block for annual). */
  cycleMonth: string;
  plan: BillingPlan;
  maxActiveChildren: number;
  billableChildren: number;
  flatRateAmount: number;
  incrementalRate: number;
  incrementalAmount: number;
  totalAmount: number;
  currency: string;
  /** YYYY-MM-DD — the 5th of the month after the cycle ends. */
  dueDate: string;
  status: InvoiceStatus;
  paidAt: string;
  manualAdjustment: string;
  createdAt: string;
};

// ----- date/cycle helpers (pure; exported for tests and the UI) -----

const CYCLE_MONTH = /^\d{4}-\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export function isCycleMonth(value: unknown): value is string {
  return CYCLE_MONTH.test(String(value ?? ""));
}

/** Any stored timestamp value -> "YYYY-MM-DD" (UTC). The two engines return
 *  different shapes: pg hands back real Date objects, SQLite stores text —
 *  "YYYY-MM-DD HH:MM:SS" from datetime('now') or ISO from the application. */
export function datePart(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  const s = String(value ?? "");
  return ISO_DATE.test(s) ? s.slice(0, 10) : "";
}

function dayNumberOf(dateIso: string): number {
  const [y, m, d] = dateIso.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / 86400000);
}

function dateOfDayNumber(day: number): string {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

/** Today's UTC date, YYYY-MM-DD. The whole engine works in UTC calendar
 *  dates so both engines (and the tests) measure the same "day". */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** "YYYY-MM" shifted by n months, always day 01. */
export function addCycleMonths(cycleMonth: string, months: number): string {
  if (!isCycleMonth(cycleMonth)) throw new Error(`cycle-month-invalid: ${cycleMonth}`);
  const [y, m] = cycleMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 7);
}

export function cycleStartDate(cycleMonth: string): string {
  if (!isCycleMonth(cycleMonth)) throw new Error(`cycle-month-invalid: ${cycleMonth}`);
  return `${cycleMonth}-01`;
}

/** The LAST day of a cycle month (the cycle's final billable day). */
export function cycleEndDate(cycleMonth: string): string {
  if (!isCycleMonth(cycleMonth)) throw new Error(`cycle-month-invalid: ${cycleMonth}`);
  const [y, m] = cycleMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** KID-245 due rule: the 5th of the month AFTER the cycle ends. */
export function dueDateForCycleEnd(cycleEndIso: string): string {
  const end = datePart(cycleEndIso);
  return `${addCycleMonths(end.slice(0, 7), 1)}-05`;
}

/** The newest month whose cycle has fully ended STRICTLY before `today` —
 *  generation happens the day after the cycle closes, so the peak is never
 *  measured from a partially elapsed month. */
export function newestEndedCycleMonth(todayIsoStr: string): string {
  const firstOfMonth = new Date(Date.UTC(
    Number(todayIsoStr.slice(0, 4)),
    Number(todayIsoStr.slice(5, 7)) - 1,
    1
  ));
  return new Date(firstOfMonth.getTime() - 86400000).toISOString().slice(0, 7);
}

/** The cycle months a plan still needs invoices for, from the first billed
 *  month through every cycle that has already ended by `today`. Monthly:
 *  one month per calendar month. Annual: the FIRST month of every 12-month
 *  block. */
export function pendingCycleMonths(
  plan: BillingPlan,
  firstCycleMonth: string,
  today: string
): string[] {
  const months: string[] = [];
  if (plan === "annual") {
    for (let k = 0; k < 600; k++) {
      const blockStart = addCycleMonths(firstCycleMonth, 12 * k);
      const blockEnd = cycleEndDate(addCycleMonths(firstCycleMonth, 12 * k + 11));
      if (!(blockEnd < today)) break;
      months.push(blockStart);
    }
    return months;
  }
  const newestEnded = newestEndedCycleMonth(today);
  if (newestEnded < firstCycleMonth) return [];
  for (let m = firstCycleMonth; m <= newestEnded; m = addCycleMonths(m, 1)) {
    months.push(m);
  }
  return months;
}

// ----- the amount formula (pure; the acceptance-criteria arithmetic) -----

export type InvoiceBreakdown = {
  maxActiveChildren: number;
  billableChildren: number;
  flatRateAmount: number;
  incrementalRate: number;
  incrementalAmount: number;
  totalAmount: number;
};

/** KID-245, board-confirmed on KID-243: only children ABOVE the free
 *  threshold add money — flat 500 + rate 50 at a peak of 20 bills
 *  500 + 10x50 = 1000 EGP, never the flat rate times every child. Annual
 *  bills the configured annual amount regardless of the roster; its
 *  breakdown records the measured peak for information only. */
export function invoiceBreakdown(b: DaycareBilling, peakChildren: number): InvoiceBreakdown {
  const maxActive = Math.max(0, Math.round(Number(peakChildren) || 0));
  if (b.plan === "annual") {
    return {
      maxActiveChildren: maxActive,
      billableChildren: 0,
      flatRateAmount: 0,
      incrementalRate: 0,
      incrementalAmount: 0,
      totalAmount: b.annualAmountEgp,
    };
  }
  const billable = Math.max(0, maxActive - b.freeChildThreshold);
  const incrementalAmount = billable * b.perChildRateEgp;
  return {
    maxActiveChildren: maxActive,
    billableChildren: billable,
    flatRateAmount: b.monthlyRateEgp,
    incrementalRate: b.perChildRateEgp,
    incrementalAmount,
    totalAmount: b.monthlyRateEgp + incrementalAmount,
  };
}

// ----- peak measurement -----

/** KID-245: the PEAK number of children active at any point inside the cycle
 *  window, measured from the child table's own history: created_at (the
 *  registration) plus the withdrawal fields (status + last_date). A child
 *  withdrawn mid-cycle still counts for the days it was enrolled — the
 *  20-peak/15-end case bills 20. Overlap sweep: +1 at each child's first
 *  active day in the window and -1 the day after its last; the running
 *  total's maximum is the peak.
 *
 *  A withdrawn child with no recorded last_date is treated as active through
 *  the whole window (it was enrolled for at least part of it and the
 *  operator can override the total); a child withdrawn BEFORE the window
 *  never counts. */
export async function peakActiveChildren(
  instituteId: string,
  cycleStartIso: string,
  cycleEndIso: string
): Promise<number> {
  const rows = await queryAll(
    "SELECT created_at, status, active, last_date FROM child WHERE institute_id = ?",
    instituteId
  );
  const startDay = dayNumberOf(cycleStartIso);
  const endDay = dayNumberOf(cycleEndIso);
  const events: Array<[number, number]> = [];
  for (const row of rows) {
    const registered = datePart(row.created_at);
    if (!registered) continue;
    const regDay = dayNumberOf(registered);
    if (regDay > endDay) continue; // enrolled after the cycle ended
    const withdrawn = String(row.status ?? "") === "withdrawn" || Number(row.active ?? 1) === 0;
    let fromDay = Math.max(regDay, startDay);
    let toDay = endDay;
    if (withdrawn) {
      const lastDate = datePart(row.last_date);
      if (!lastDate) {
        // Withdrawn with no recorded date: unknown leaving day, billed
        // through the window (conservative; overridable by the operator).
      } else {
        const lastDay = dayNumberOf(lastDate);
        if (lastDay < startDay) continue; // left before the cycle began
        toDay = Math.min(lastDay, endDay);
      }
    }
    if (fromDay > toDay) continue;
    events.push([fromDay, 1], [toDay + 1, -1]);
  }
  // Group by day: the count is only meaningful once EVERY delta for the day
  // is applied (+1 and -1 can share a day — one child's day-after-last is
  // another's first day).
  events.sort((a, b) => a[0] - b[0]);
  let running = 0;
  let peak = 0;
  for (let i = 0; i < events.length; ) {
    const day = events[i][0];
    for (; i < events.length && events[i][0] === day; i++) running += events[i][1];
    if (running > peak) peak = running;
  }
  return peak;
}

// ----- invoice rows -----

export function invoiceRowTo(row: Row): DaycareInvoice {
  const status = String(row.status ?? "pending");
  return {
    id: String(row.id ?? ""),
    instituteId: String(row.institute_id ?? ""),
    cycleMonth: String(row.cycle_month ?? ""),
    plan: mapPlan(row.plan),
    maxActiveChildren: clampInt(row.max_active_children, 0),
    billableChildren: clampInt(row.billable_children, 0),
    flatRateAmount: clampInt(row.flat_rate_amount, 0),
    incrementalRate: clampInt(row.incremental_rate, 0),
    incrementalAmount: clampInt(row.incremental_amount, 0),
    totalAmount: clampInt(row.total_amount, 0),
    currency: String(row.currency ?? "EGP"),
    dueDate: String(row.due_date ?? "").slice(0, 10),
    status: ((INVOICE_STATUSES as readonly string[]).includes(status) ? status : "pending") as InvoiceStatus,
    paidAt: row.paid_at instanceof Date ? row.paid_at.toISOString() : String(row.paid_at ?? ""),
    manualAdjustment: String(row.manual_adjustment ?? ""),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
  };
}

export async function getInvoice(invoiceId: string): Promise<DaycareInvoice | undefined> {
  const row = await queryGet("SELECT * FROM daycare_invoice WHERE id = ?", invoiceId);
  return row ? invoiceRowTo(row) : undefined;
}

/** One daycare's invoice history, newest cycle first (the /platform list). */
export async function listInvoices(instituteId: string): Promise<DaycareInvoice[]> {
  const rows = await queryAll(
    "SELECT * FROM daycare_invoice WHERE institute_id = ? ORDER BY cycle_month DESC, id DESC",
    instituteId
  );
  return rows.map(invoiceRowTo);
}

/** KID-245: an unpaid overdue invoice exists for this daycare — the data
 *  signature that distinguishes a billing block from a manual disable at the
 *  login gate (lib/actions.ts tenancyDisabledError). */
export async function hasOverdueInvoice(instituteId: string): Promise<boolean> {
  const row = await queryGet(
    "SELECT id FROM daycare_invoice WHERE institute_id = ? AND status = 'overdue' LIMIT 1",
    instituteId
  );
  return !!row;
}

// ----- generation -----

/** Every invoice the current date requires but the ledger does not have yet.
 *  Idempotent: the (institute_id, cycle_month) unique index turns a re-run
 *  (another warm instance, a retry) into a no-op. Returns the count of
 *  invoices actually inserted. */
export async function generateDueInvoices(now: Date = new Date()): Promise<number> {
  const today = todayIso(now);
  const configs = await queryAll(
    `SELECT b.institute_id, b.plan, b.monthly_rate_egp, b.per_child_rate_egp,
            b.free_child_threshold, b.annual_amount_egp, b.first_cycle_start
     FROM daycare_billing b
     JOIN institute i ON i.id = b.institute_id`
  );
  let generated = 0;
  for (const cfg of configs) {
    const settings = rowToBilling(cfg);
    const instituteId = String(cfg.institute_id);
    // Demo never bills (KID-244); a config without a first cycle cannot
    // define a billing calendar.
    if (settings.plan === "demo" || !settings.firstCycleStart) continue;
    const firstMonth = settings.firstCycleStart.slice(0, 7);
    if (!isCycleMonth(firstMonth)) continue;

    const existing = new Set(
      (
        await queryAll(
          "SELECT cycle_month FROM daycare_invoice WHERE institute_id = ?",
          instituteId
        )
      ).map((r) => String(r.cycle_month))
    );
    const missing = pendingCycleMonths(settings.plan, firstMonth, today).filter(
      (m) => !existing.has(m)
    );

    for (const cycleMonth of missing) {
      const start = cycleStartDate(cycleMonth);
      // Monthly cycles span their single month; annual blocks span 12 months
      // from the block's first month.
      const end =
        settings.plan === "annual"
          ? cycleEndDate(addCycleMonths(cycleMonth, 11))
          : cycleEndDate(cycleMonth);
      const breakdown = invoiceBreakdown(
        settings,
        await peakActiveChildren(instituteId, start, end)
      );
      const dueDate = dueDateForCycleEnd(end);
      const res = await queryRun(
        `INSERT INTO daycare_invoice
           (id, institute_id, cycle_month, plan, max_active_children, billable_children,
            flat_rate_amount, incremental_rate, incremental_amount, total_amount, currency,
            due_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EGP', ?, 'pending')
         ON CONFLICT (institute_id, cycle_month) DO NOTHING`,
        uid(),
        instituteId,
        cycleMonth,
        settings.plan,
        breakdown.maxActiveChildren,
        breakdown.billableChildren,
        breakdown.flatRateAmount,
        breakdown.incrementalRate,
        breakdown.incrementalAmount,
        breakdown.totalAmount,
        dueDate
      );
      generated += res.rowCount > 0 ? 1 : 0;
    }
  }
  return generated;
}

// ----- enforcement, payment, overrides -----

/** KID-245 enforcement: every pending invoice whose due date has passed
 *  becomes overdue, and every daycare still ACTIVE that carries an unpaid
 *  overdue invoice is disabled (the existing KID-199.3 setInstituteActive —
 *  all of its users are then blocked at login). Returns how many daycares
 *  were flipped. Idempotent: an already-disabled daycare is not re-written. */
export async function applyOverdueEnforcement(now: Date = new Date()): Promise<number> {
  const today = todayIso(now);
  await queryRun(
    "UPDATE daycare_invoice SET status = 'overdue' WHERE status = 'pending' AND due_date < ?",
    today
  );
  // Only institutes that are still active need the flip — the typical sweep
  // is a single cheap SELECT returning nothing.
  const active = await queryAll(
    `SELECT DISTINCT di.institute_id
     FROM daycare_invoice di
     JOIN institute i ON i.id = di.institute_id
     WHERE di.status = 'overdue' AND i.active = 1`
  );
  let disabled = 0;
  // store.ts imports this module statically, so setInstituteActive must be
  // reached dynamically (same pattern lib/actions.ts uses for its gates).
  const { setInstituteActive } = await import("./store");
  for (const row of active) {
    await setInstituteActive(String(row.institute_id), false);
    disabled += 1;
  }
  return disabled;
}

/** KID-245: mark an invoice paid. Flips the invoice to `paid` (paid_at), and
 *  re-activates the daycare — the billing block lifts — as soon as no OTHER
 *  unpaid overdue invoice remains. Marking an already-paid invoice paid
 *  again is a no-op. */
export async function markInvoicePaid(
  invoiceId: string,
  opts: { paidAt?: string } = {}
): Promise<void> {
  const row = await queryGet("SELECT * FROM daycare_invoice WHERE id = ?", invoiceId);
  if (!row) throw new Error("invoice-not-found");
  if (String(row.status) === "paid") return;
  const paidAt = opts.paidAt ?? new Date().toISOString();
  await queryRun(
    "UPDATE daycare_invoice SET status = 'paid', paid_at = ? WHERE id = ?",
    paidAt,
    invoiceId
  );
  const remaining = await queryGet(
    "SELECT id FROM daycare_invoice WHERE institute_id = ? AND status = 'overdue' LIMIT 1",
    String(row.institute_id)
  );
  if (!remaining) {
    const { setInstituteActive } = await import("./store");
    await setInstituteActive(String(row.institute_id), true);
  }
}

/** KID-245: the operator's manual override of an invoice's payable amount
 *  (with an explanatory note) — allowed only BEFORE payment; a paid invoice
 *  is locked. The formula fields keep their snapshot; only total_amount and
 *  manual_adjustment move. */
export async function updateInvoiceAmount(
  invoiceId: string,
  patch: { totalAmountEgp?: number; note?: string }
): Promise<void> {
  const row = await queryGet("SELECT * FROM daycare_invoice WHERE id = ?", invoiceId);
  if (!row) throw new Error("invoice-not-found");
  if (String(row.status) === "paid") throw new Error("invoice-paid-locked");
  if (patch.totalAmountEgp !== undefined) {
    const n = Number(patch.totalAmountEgp);
    if (!Number.isFinite(n) || n < 0) throw new Error("invoice-total-invalid");
    await queryRun(
      "UPDATE daycare_invoice SET total_amount = ? WHERE id = ?",
      Math.round(n),
      invoiceId
    );
  }
  if (patch.note !== undefined) {
    await queryRun(
      "UPDATE daycare_invoice SET manual_adjustment = ? WHERE id = ?",
      String(patch.note).trim() || null,
      invoiceId
    );
  }
}

/** The one entry point the bootstrap pass calls (lib/bootstrap.ts): generate
 *  the invoices the date requires, then enforce the overdue rule. Failures
 *  are the caller's concern — the sweep itself throws loudly. */
export async function runBillingSweep(
  now: Date = new Date()
): Promise<{ generated: number; disabled: number }> {
  const generated = await generateDueInvoices(now);
  const disabled = await applyOverdueEnforcement(now);
  return { generated, disabled };
}
