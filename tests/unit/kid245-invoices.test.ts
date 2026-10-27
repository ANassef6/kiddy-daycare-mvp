// KID-245: Finance/2 — invoice records (supabase/migrations/0028_daycare_invoice.sql
// + the SQLite mirror), the per-cycle PEAK max-children measurement, the
// board-confirmed monthly formula, due dates, the demo/annual plan rules, the
// overdue auto-disable, the mark-paid re-enable, and the manual amount
// override — plus the login gate that tells a billing block apart from a
// manual disable, in EN and AR.
//
// Same split kid244 documents: the engine core (lib/billing.ts) is tested
// directly against the isolated SQLite data layer with an injected "today",
// so no test depends on the wall clock. The login gate runs loginAction
// itself (next/headers mocked empty, same harness as kid238). The Postgres
// half of the dual engine is verified by `npm run db:verify-migrations`
// against real PGlite Postgres.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "@/lib/store";
import {
  addCycleMonths,
  BILLING_DEFAULTS,
  cycleEndDate,
  dueDateForCycleEnd,
  generateDueInvoices,
  getInvoice,
  invoiceBreakdown,
  listInvoices,
  markInvoicePaid,
  newestEndedCycleMonth,
  peakActiveChildren,
  runBillingSweep,
  updateDaycareBilling,
  updateInvoiceAmount,
  type DaycareBilling,
} from "@/lib/billing";
import { enrolledChildCount } from "@/lib/billing";
import { queryAll, queryGet, queryRun, type Row } from "@/lib/db";
import { dictionaries, keysOf } from "@/lib/i18n";
import { PLATFORM_CONTACT_EMAIL } from "@/lib/site";
import { seedFixture } from "../helpers";

// lib/actions reads the session cookie through next/headers, which has no
// request scope under vitest (same harness as kid238).
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => undefined }),
  headers: () => new Headers(),
}));

const utcDate = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));

let sunshineIid: string;

beforeEach(async () => {
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
});

// A monthly-plan daycare with the default 500/50/10 rates, its first billed
// month pinned by the test (the operator-configurable setting) so the
// calendar is deterministic. The signup month itself (created_at = now) is
// never billed: generation starts strictly at first_cycle_start.
async function newMonthlyDaycare(firstCycleStart?: string): Promise<string> {
  const res = await store.createDaycare({
    name: "Maple Grove",
    ownerEmail: `owner-${Math.random().toString(36).slice(2, 8)}@maplegrove.test`,
    ownerPassword: "maple-owner-1",
    ownerFullName: "Nadia Kareem",
    billing: { plan: "monthly" },
  });
  if (firstCycleStart) await updateDaycareBilling(res.instituteId, { firstCycleStart });
  return res.instituteId;
}

/** Seed `n` children registered at `createdAt`; the first `withdrawn` of them
 *  are withdrawn (active=0) with the given last_date. `tag` keeps ids unique
 *  across multiple calls for the same institute. */
async function seedChildren(
  instituteId: string,
  n: number,
  createdAt: string,
  withdrawn = 0,
  lastDate = "",
  tag = "a"
): Promise<void> {
  for (let i = 0; i < n; i++) {
    const isWithdrawn = i < withdrawn;
    await queryRun(
      `INSERT INTO child (id, institute_id, first_name, last_name, status, active, created_at, last_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      `child-${instituteId}-${tag}-${i}`,
      instituteId,
      `Kid${tag}${i}`,
      "Nassef",
      isWithdrawn ? "withdrawn" : "active",
      isWithdrawn ? 0 : 1,
      createdAt,
      isWithdrawn ? lastDate : null
    );
  }
}

describe("pure date/cycle helpers", () => {
  it("the due date is the 5th of the month after the cycle ends", () => {
    expect(dueDateForCycleEnd("2026-02-28")).toBe("2026-03-05");
    expect(dueDateForCycleEnd("2026-01-31")).toBe("2026-02-05");
    expect(dueDateForCycleEnd("2026-12-31")).toBe("2027-01-05");
    // An annual block ending 2027-01-31 is due 2027-02-05.
    expect(dueDateForCycleEnd(cycleEndDate("2027-01"))).toBe("2027-02-05");
  });

  it("cycle months cross year boundaries correctly", () => {
    expect(addCycleMonths("2026-11", 2)).toBe("2027-01");
    expect(addCycleMonths("2026-01", -1)).toBe("2025-12");
    expect(cycleEndDate("2026-02")).toBe("2026-02-28");
    expect(cycleEndDate("2028-02")).toBe("2028-02-29");
  });

  it("a cycle ends before today, never during today (generation runs the day after)", () => {
    expect(newestEndedCycleMonth("2026-04-01")).toBe("2026-03");
    expect(newestEndedCycleMonth("2026-03-31")).toBe("2026-02");
    expect(newestEndedCycleMonth("2026-01-01")).toBe("2025-12");
  });
});

describe("the board-confirmed formula (invoiceBreakdown)", () => {
  const monthly: DaycareBilling = {
    ...BILLING_DEFAULTS,
    plan: "monthly",
    firstCycleStart: "",
  };

  it("exactly 10 children bills the flat rate only; 11 adds the first 50", () => {
    expect(invoiceBreakdown(monthly, 10).totalAmount).toBe(500);
    expect(invoiceBreakdown(monthly, 11).totalAmount).toBe(550);
    expect(invoiceBreakdown(monthly, 11).billableChildren).toBe(1);
  });

  it("20 peak children bills 500 + 10x50 = 1000 EGP — never flat-rate-times-all", () => {
    const b = invoiceBreakdown(monthly, 20);
    expect(b.maxActiveChildren).toBe(20);
    expect(b.billableChildren).toBe(10);
    expect(b.flatRateAmount).toBe(500);
    expect(b.incrementalRate).toBe(50);
    expect(b.incrementalAmount).toBe(500);
    expect(b.totalAmount).toBe(1000);
  });

  it("respects operator-configured thresholds and rates", () => {
    const custom: DaycareBilling = { ...monthly, freeChildThreshold: 5, monthlyRateEgp: 700, perChildRateEgp: 25 };
    expect(invoiceBreakdown(custom, 7).totalAmount).toBe(750);
    expect(invoiceBreakdown(custom, 5).totalAmount).toBe(700);
  });

  it("the annual plan bills the configured annual amount regardless of the roster", () => {
    const annual: DaycareBilling = { ...BILLING_DEFAULTS, plan: "annual", firstCycleStart: "" };
    const b = invoiceBreakdown(annual, 87);
    expect(b.totalAmount).toBe(24000);
    expect(b.billableChildren).toBe(0);
    expect(b.maxActiveChildren).toBe(87);
  });
});

describe("peak max-children measurement", () => {
  it("uses the PEAK, not the end-of-month count: 20 peak / 15 end -> 20", async () => {
    const iid = await newMonthlyDaycare("2026-03-01");
    // 20 children enrolled since February; 5 of them withdrawn mid-cycle
    // (last day 2026-03-15). At cycle end only 15 remain — the invoice
    // must still bill the 20 that were active at the same time.
    await seedChildren(iid, 20, "2026-02-01 09:00:00", 5, "2026-03-15");
    expect(await enrolledChildCount(iid)).toBe(15); // the end-of-month count
    expect(await peakActiveChildren(iid, "2026-03-01", "2026-03-31")).toBe(20);
  });

  it("a same-day handover counts both children on the shared day", async () => {
    const iid = await newMonthlyDaycare("2026-03-01");
    // 3 children from February; one leaves after its last day 2026-03-10.
    await seedChildren(iid, 3, "2026-02-01 09:00:00", 1, "2026-03-10");
    // One child joining on that exact day: all 4 are active on 2026-03-10.
    await queryRun(
      `INSERT INTO child (id, institute_id, first_name, last_name, status, active, created_at)
       VALUES ('child-late-1', ?, 'Late', 'Joiner', 'active', 1, '2026-03-10 12:00:00')`,
      iid
    );
    expect(await peakActiveChildren(iid, "2026-03-01", "2026-03-31")).toBe(4);
  });

  it("children withdrawn before the cycle and children enrolled after it never count", async () => {
    const iid = await newMonthlyDaycare("2026-03-01");
    await seedChildren(iid, 2, "2026-01-01 09:00:00", 2, "2026-02-20", "early");
    await seedChildren(iid, 1, "2026-04-05 09:00:00", 0, "", "late");
    expect(await peakActiveChildren(iid, "2026-03-01", "2026-03-31")).toBe(0);
  });
});

describe("invoice generation", () => {
  it("generates the ended monthly cycle with peak, formula fields, due date and EGP", async () => {
    const iid = await newMonthlyDaycare("2026-03-01");
    await seedChildren(iid, 20, "2026-02-01 09:00:00", 5, "2026-03-15");

    const generated = await generateDueInvoices(utcDate(2026, 4, 1));
    expect(generated).toBe(1);
    const invoices = await listInvoices(iid);
    expect(invoices).toHaveLength(1);
    const inv = invoices[0]!;
    expect(inv.cycleMonth).toBe("2026-03");
    expect(inv.plan).toBe("monthly");
    expect(inv.maxActiveChildren).toBe(20);
    expect(inv.billableChildren).toBe(10);
    expect(inv.flatRateAmount).toBe(500);
    expect(inv.incrementalRate).toBe(50);
    expect(inv.incrementalAmount).toBe(500);
    expect(inv.totalAmount).toBe(1000);
    expect(inv.currency).toBe("EGP");
    expect(inv.dueDate).toBe("2026-04-05"); // the 5th of the following month
    expect(inv.status).toBe("pending");
  });

  it("the signup month is free: no invoice before the first cycle and never for it", async () => {
    // First billed month 2026-02 (the month after signup). While February is
    // still running, nothing exists — not for the signup month, not for February.
    const iid = await newMonthlyDaycare("2026-02-01");
    await seedChildren(iid, 4, "2026-01-05 09:00:00");
    expect(await generateDueInvoices(utcDate(2026, 2, 10))).toBe(0);
    expect(await listInvoices(iid)).toHaveLength(0);

    // The day after February closes, exactly one invoice exists: February's.
    await generateDueInvoices(utcDate(2026, 3, 2));
    const invoices = await listInvoices(iid);
    expect(invoices.map((i) => i.cycleMonth)).toEqual(["2026-02"]);
    expect(invoices[0]!.dueDate).toBe("2026-03-05");
  });

  it("catches up every ended cycle with one invoice per month, then idles", async () => {
    const iid = await newMonthlyDaycare("2026-01-01");
    await seedChildren(iid, 12, "2025-12-01 09:00:00");
    expect(await generateDueInvoices(utcDate(2026, 3, 15))).toBe(2);
    expect((await listInvoices(iid)).map((i) => i.cycleMonth)).toEqual(["2026-02", "2026-01"]);
    // Re-running the same date changes nothing (idempotent sweep).
    expect(await generateDueInvoices(utcDate(2026, 3, 15))).toBe(0);
    expect(await listInvoices(iid)).toHaveLength(2);
  });

  it("the demo plan never generates an invoice", async () => {
    const res = await store.createDaycare({
      name: "Demo Grove",
      ownerEmail: `demo-${Math.random().toString(36).slice(2, 8)}@demogrove.test`,
      ownerPassword: "demo-owner-1",
      ownerFullName: "Demo Owner",
      billing: { plan: "demo" },
    });
    await seedChildren(res.instituteId, 30, "2025-01-01 09:00:00");
    // Long past cycles, big roster — still nothing to bill.
    expect(await generateDueInvoices(utcDate(2026, 4, 1))).toBe(0);
    expect(await listInvoices(res.instituteId)).toHaveLength(0);
  });

  it("the annual plan bills one invoice per 12-month cycle, due the 5th after the block", async () => {
    const res = await store.createDaycare({
      name: "Annual Grove",
      ownerEmail: `annual-${Math.random().toString(36).slice(2, 8)}@annualgrove.test`,
      ownerPassword: "annual-owner-1",
      ownerFullName: "Annual Owner",
      billing: { plan: "annual" },
    });
    await updateDaycareBilling(res.instituteId, { firstCycleStart: "2026-02-01" });
    await seedChildren(res.instituteId, 40, "2026-01-01 09:00:00");

    // The 12-month block has not ended — nothing yet, even mid-block.
    expect(await generateDueInvoices(utcDate(2026, 9, 1))).toBe(0);
    expect(await listInvoices(res.instituteId)).toHaveLength(0);

    // The block 2026-02..2027-01 ends 2027-01-31; the invoice is due 2027-02-05.
    expect(await generateDueInvoices(utcDate(2027, 2, 3))).toBe(1);
    const first = (await listInvoices(res.instituteId))[0]!;
    expect(first.cycleMonth).toBe("2026-02");
    expect(first.totalAmount).toBe(24000);
    expect(first.billableChildren).toBe(0);
    expect(first.dueDate).toBe("2027-02-05");

    // The NEXT block (2027-02..2028-01) gets its own single invoice.
    expect(await generateDueInvoices(utcDate(2028, 2, 10))).toBe(1);
    expect((await listInvoices(res.instituteId)).map((i) => i.cycleMonth).sort()).toEqual([
      "2026-02",
      "2027-02",
    ]);
  });

  it("the bootstrap sweep generates and enforces in one pass", async () => {
    const iid = await newMonthlyDaycare("2026-03-01");
    await seedChildren(iid, 11, "2026-02-01 09:00:00");
    const res = await runBillingSweep(utcDate(2026, 4, 6));
    expect(res.generated).toBe(1);
    const inv = (await listInvoices(iid))[0]!;
    expect(inv.status).toBe("overdue"); // due 2026-04-05, now 2026-04-06
    expect(res.disabled).toBe(1);
    expect(Number((await store.getInstitute(iid))!.active)).toBe(0);
  });

  it("the lazy bootstrap actually runs the sweep (lib/bootstrap.ts wiring)", async () => {
    // A monthly daycare whose first cycles already ended relative to the REAL
    // clock (pinned two months back, day 01) — ensureSeeded() must generate
    // its invoice(s) with no explicit call from the test. Fresh module import
    // per the kid216 pattern: lib/bootstrap caches `initialized`.
    const iid = await newMonthlyDaycare();
    const now = new Date();
    const firstMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    await updateDaycareBilling(iid, { firstCycleStart: firstMonth.toISOString().slice(0, 10) });
    const registered = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
    await seedChildren(iid, 11, registered.toISOString());
    vi.resetModules();
    const { ensureSeeded } = await import("@/lib/bootstrap");
    await ensureSeeded();
    const invoices = await listInvoices(iid);
    expect(invoices.length).toBeGreaterThanOrEqual(1);
    expect(invoices.some((i) => i.status === "pending" || i.status === "overdue")).toBe(true);
  });
});

describe("overdue enforcement and re-enable", () => {
  it("an unpaid invoice past its due date becomes overdue and disables the daycare", async () => {
    const iid = await newMonthlyDaycare("2026-03-01");
    await seedChildren(iid, 5, "2026-02-01 09:00:00");
    await generateDueInvoices(utcDate(2026, 4, 1));
    expect(Number((await store.getInstitute(iid))!.active)).toBe(1);

    const disabled = await runBillingSweep(utcDate(2026, 4, 6)).then((r) => r.disabled);
    expect(disabled).toBe(1);
    const inv = (await listInvoices(iid))[0]!;
    expect(inv.status).toBe("overdue");
    expect(Number((await store.getInstitute(iid))!.active)).toBe(0);
    // Idempotent: a re-run (next warm instance) changes nothing.
    expect((await runBillingSweep(utcDate(2026, 4, 7))).disabled).toBe(0);
    expect(Number((await store.getInstitute(iid))!.active)).toBe(0);
  });

  it("marking the invoice paid flips the daycare back to active", async () => {
    const iid = await newMonthlyDaycare("2026-03-01");
    await seedChildren(iid, 5, "2026-02-01 09:00:00");
    await runBillingSweep(utcDate(2026, 4, 6));
    expect(Number((await store.getInstitute(iid))!.active)).toBe(0);
    const inv = (await listInvoices(iid))[0]!;

    await markInvoicePaid(inv.id, { paidAt: "2026-04-07T10:00:00.000Z" });
    const paid = await getInvoice(inv.id);
    expect(paid!.status).toBe("paid");
    expect(paid!.paidAt.slice(0, 10)).toBe("2026-04-07");
    expect(Number((await store.getInstitute(iid))!.active)).toBe(1);

    // Idempotent: paying twice is a no-op, never an error.
    await markInvoicePaid(inv.id);
    expect((await getInvoice(inv.id))!.status).toBe("paid");
  });

  it("the daycare stays disabled while any OTHER overdue invoice remains", async () => {
    const iid = await newMonthlyDaycare("2026-02-01");
    await seedChildren(iid, 5, "2026-01-01 09:00:00");
    await generateDueInvoices(utcDate(2026, 4, 1)); // cycles 2026-02 + 2026-03
    await runBillingSweep(utcDate(2026, 4, 6));
    expect(Number((await store.getInstitute(iid))!.active)).toBe(0);

    const invoices = await listInvoices(iid);
    expect(invoices).toHaveLength(2);
    // Paying one of two overdue invoices does not restore access…
    await markInvoicePaid(invoices[0]!.id);
    expect(Number((await store.getInstitute(iid))!.active)).toBe(0);
    // …paying the last one does.
    await markInvoicePaid(invoices[1]!.id);
    expect(Number((await store.getInstitute(iid))!.active)).toBe(1);
  });
});

describe("manual amount override (superadmin)", () => {
  it("overrides the total with a note before payment; the formula snapshot stays", async () => {
    const iid = await newMonthlyDaycare("2026-03-01");
    await seedChildren(iid, 20, "2026-02-01 09:00:00", 5, "2026-03-15");
    await generateDueInvoices(utcDate(2026, 4, 1));
    const inv = (await listInvoices(iid))[0]!;
    expect(inv.totalAmount).toBe(1000);

    await updateInvoiceAmount(inv.id, { totalAmountEgp: 700, note: "goodwill discount" });
    const row = await queryGet("SELECT * FROM daycare_invoice WHERE id = ?", inv.id);
    expect(Number(row!.total_amount)).toBe(700);
    expect(String(row!.manual_adjustment)).toBe("goodwill discount");
    // The formula fields keep their snapshot — the override is explicit.
    expect(Number(row!.max_active_children)).toBe(20);
    expect(Number(row!.flat_rate_amount)).toBe(500);
    // The override persists on a fresh read of the typed row.
    expect((await getInvoice(inv.id))!.totalAmount).toBe(700);
  });

  it("refuses negative or nonsense totals and locks paid invoices", async () => {
    const iid = await newMonthlyDaycare("2026-03-01");
    await seedChildren(iid, 12, "2026-02-01 09:00:00");
    await generateDueInvoices(utcDate(2026, 4, 1));
    const inv = (await listInvoices(iid))[0]!;
    await expect(updateInvoiceAmount(inv.id, { totalAmountEgp: -5 })).rejects.toThrow("invoice-total-invalid");
    await expect(updateInvoiceAmount(inv.id, { totalAmountEgp: NaN })).rejects.toThrow("invoice-total-invalid");
    await expect(updateInvoiceAmount("no-such-invoice", { totalAmountEgp: 5 })).rejects.toThrow("invoice-not-found");

    await markInvoicePaid(inv.id);
    await expect(updateInvoiceAmount(inv.id, { totalAmountEgp: 1 })).rejects.toThrow("invoice-paid-locked");
    await expect(updateInvoiceAmount(inv.id, { note: "late edit" })).rejects.toThrow("invoice-paid-locked");
    expect((await getInvoice(inv.id))!.totalAmount).toBe(600); // 12 children: 500 + 2x50
  });
});

describe("the login gate distinguishes billing from manual disable (EN + AR)", () => {
  async function overdueInvoiceFor(instituteId: string): Promise<void> {
    await queryRun(
      `INSERT INTO daycare_invoice
         (id, institute_id, cycle_month, plan, max_active_children, billable_children,
          flat_rate_amount, incremental_rate, incremental_amount, total_amount, currency,
          due_date, status)
       VALUES ('inv-kid245', ?, '2026-09', 'monthly', 12, 2, 500, 50, 100, 600, 'EGP',
               '2026-10-05', 'overdue')`,
      instituteId
    );
  }

  async function loginAsAdmin(): Promise<{ error?: string }> {
    const { loginAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("email", "admin@sunshinedaycare.test");
    form.set("password", "kiddy-admin");
    return (await loginAction(form)) as { error?: string };
  }

  it("a manually disabled daycare keeps the generic disabled message (EN)", async () => {
    await queryRun("UPDATE institute SET active = 0 WHERE id = ?", sunshineIid);
    const res = await loginAsAdmin();
    expect(res.error).toContain("This daycare is currently disabled.");
    expect(res.error).toContain(PLATFORM_CONTACT_EMAIL);
  });

  it("a billing-blocked daycare shows the temporary-block message (EN)", async () => {
    await overdueInvoiceFor(sunshineIid);
    await queryRun("UPDATE institute SET active = 0 WHERE id = ?", sunshineIid);
    const res = await loginAsAdmin();
    expect(res.error).toContain("temporarily blocked due to an overdue invoice");
    expect(res.error).toContain(PLATFORM_CONTACT_EMAIL);
  });

  it("the billing message ships in Arabic for an Arabic account", async () => {
    await overdueInvoiceFor(sunshineIid);
    await queryRun("UPDATE institute SET active = 0 WHERE id = ?", sunshineIid);
    await queryRun("UPDATE account SET language = 'ar' WHERE email = 'admin@sunshinedaycare.test'");
    const res = await loginAsAdmin();
    expect(res.error).toContain("مؤقتًا");
    expect(res.error).toContain(PLATFORM_CONTACT_EMAIL);
  });

  it("paying the overdue invoice restores the login (redirect, no error)", async () => {
    await overdueInvoiceFor(sunshineIid);
    await queryRun("UPDATE institute SET active = 0 WHERE id = ?", sunshineIid);
    await markInvoicePaid("inv-kid245");
    expect(Number((await store.getInstitute(sunshineIid))!.active)).toBe(1);

    let digest = "";
    try {
      await loginAsAdmin();
    } catch (err) {
      digest = String((err as { digest?: unknown })?.digest ?? "");
    }
    // The seeded owner lands on the portal dashboard — signed in, not blocked.
    expect(digest).toContain("NEXT_REDIRECT");
    expect(digest).toContain("/portal/dashboard");
  });

  it("isTenancyBillingBlocked reads the overdue-invoice signature, not the flag alone", async () => {
    const adminId = String(
      (await queryGet("SELECT id FROM account WHERE email = 'admin@sunshinedaycare.test'"))!.id
    );
    expect(await store.isTenancyBillingBlocked(adminId)).toBe(false);
    await queryRun("UPDATE institute SET active = 0 WHERE id = ?", sunshineIid);
    // Disabled by hand, no invoice: NOT a billing block.
    expect(await store.isTenancyBillingBlocked(adminId)).toBe(false);
    await overdueInvoiceFor(sunshineIid);
    expect(await store.isTenancyBillingBlocked(adminId)).toBe(true);
  });
});

describe("the shared gate message builder", () => {
  it("renders both reasons in EN and AR, always naming the contact inbox", async () => {
    const { tenancyDisabledMessage } = await import("@/lib/i18n");
    const enManual = tenancyDisabledMessage("manual", "en");
    const enBilling = tenancyDisabledMessage("billing", "en");
    const arManual = tenancyDisabledMessage("manual", "ar");
    const arBilling = tenancyDisabledMessage("billing", "ar");

    expect(enManual).toContain("This daycare is currently disabled.");
    expect(enBilling).toContain("temporarily blocked due to an overdue invoice");
    expect(arManual).toContain("معطّلة حاليًا");
    expect(arBilling).toContain("مؤقتًا");
    for (const msg of [enManual, enBilling, arManual, arBilling]) {
      expect(msg).toContain(PLATFORM_CONTACT_EMAIL);
    }
    // Unknown locales fall back to English, unknown reasons to the manual text.
    expect(tenancyDisabledMessage("manual", "fr")).toBe(enManual);
    expect(tenancyDisabledMessage("billing", "ar-EG")).toBe(arBilling);
  });
});

describe("i18n", () => {
  it("carries the KID-245 invoice labels in both EN and AR with matching key sets", () => {
    const invoiceKeys = (dict: Record<string, unknown>) =>
      keysOf(dict as never).filter((k) => k.startsWith("platform.invoice"));
    expect(invoiceKeys(dictionaries.en).length).toBeGreaterThan(20);
    expect(invoiceKeys(dictionaries.ar).sort()).toEqual(invoiceKeys(dictionaries.en).sort());
  });
});

describe("schema", () => {
  it("the invoice table carries the issue-specified columns and one invoice per cycle", async () => {
    const iid = await newMonthlyDaycare("2026-03-01");
    const cols = (await queryAll("PRAGMA table_info(daycare_invoice)")) as Row[];
    const names = cols.map((c) => String(c.name));
    for (const col of [
      "id",
      "institute_id",
      "cycle_month",
      "max_active_children",
      "billable_children",
      "flat_rate_amount",
      "incremental_rate",
      "incremental_amount",
      "total_amount",
      "currency",
      "due_date",
      "status",
      "paid_at",
      "manual_adjustment",
    ]) {
      expect(names).toContain(col);
    }
    // A cycle is billed once: the unique (institute_id, cycle_month) index
    // rejects a second insert for the same cycle.
    await queryRun(
      `INSERT INTO daycare_invoice (id, institute_id, cycle_month, due_date, status, total_amount)
       VALUES ('dup-1', ?, '2026-03', '2026-04-05', 'pending', 500)`,
      iid
    );
    let dupRejected = false;
    try {
      await queryRun(
        `INSERT INTO daycare_invoice (id, institute_id, cycle_month, due_date, status, total_amount)
         VALUES ('dup-2', ?, '2026-03', '2026-04-05', 'pending', 500)`,
        iid
      );
    } catch {
      dupRejected = true;
    }
    expect(dupRejected).toBe(true);
  });
});
