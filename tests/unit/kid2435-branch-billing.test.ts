// KID-2435 v3: one subscription per branch (pricing plan v3, billing rule 12).
//
// The founder answered the branch-subscription card on 19 Nov 2026:
//   * the branch record holds the subscription;
//   * a branch with no active children is billed 0 (not invoiced until its
//     first active child);
//   * a new branch joining a founding group uses one new slot and gets the
//     founding rate for 12 months from its own start;
//   * a branch's first billed month starts on the 1st of the month after the
//     branch is created.
//
// These tests pin the engine behaviour directly against the isolated SQLite
// data layer; the Postgres migration (0050) is verified by
// `npm run db:verify-migrations`.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import {
  generateDueInvoices,
  getBranchBilling,
  listBranchBillings,
  rowToBranchBilling,
  listInvoices,
  nextMonthStart,
  updateBranchBilling,
  updateDaycareBilling,
} from "@/lib/billing";
import { countFoundingClients, updatePricingSettings } from "@/lib/pricing";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

const utcDate = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));

beforeEach(async () => {
  await seedFixture();
});

async function newDaycare(branches = 1): Promise<{ instituteId: string; branchIds: string[] }> {
  const res = await store.createDaycare({
    name: `Branches ${Math.random().toString(36).slice(2, 8)}`,
    ownerEmail: `branches-${Math.random().toString(36).slice(2, 8)}@example.test`,
    ownerPassword: "branches-owner-1",
    ownerFullName: "Branch Owner",
    branches,
    billing: { plan: "monthly" },
  });
  return { instituteId: res.instituteId, branchIds: res.branchIds };
}

async function seedChildren(
  instituteId: string,
  branchId: string | null,
  n: number,
  createdAt: string,
  tag: string
): Promise<void> {
  for (let i = 0; i < n; i++) {
    await queryRun(
      `INSERT INTO child (id, institute_id, branch_id, first_name, last_name, status, active, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', 1, ?)`,
      `child-${instituteId}-${tag}-${i}`,
      instituteId,
      branchId,
      `Kid${tag}${i}`,
      "Nassef",
      createdAt
    );
  }
}

describe("branch billing date shapes", () => {
  it("normalises Postgres Date objects and SQLite text to YYYY-MM-DD", () => {
    const pg = rowToBranchBilling({
      branch_id: "b1",
      institute_id: "i1",
      plan: "monthly",
      first_cycle_start: new Date(Date.UTC(2026, 0, 1)),
      founding_started_at: new Date(Date.UTC(2026, 0, 1)),
      pilot_end_date: new Date(Date.UTC(2025, 11, 20)),
      cancel_at: new Date(Date.UTC(2026, 5, 30)),
    });
    expect(pg.firstCycleStart).toBe("2026-01-01");
    expect(pg.foundingStartedAt).toBe("2026-01-01");
    expect(pg.pilotEndDate).toBe("2025-12-20");
    expect(pg.cancelAt).toBe("2026-06-30");

    const sqlite = rowToBranchBilling({
      branch_id: "b2",
      institute_id: "i1",
      plan: "monthly",
      first_cycle_start: "2026-02-01",
      founding_started_at: "2026-02-01 00:00:00",
      pilot_end_date: "2026-01-15",
    });
    expect(sqlite.firstCycleStart).toBe("2026-02-01");
    expect(sqlite.foundingStartedAt).toBe("2026-02-01");
    expect(sqlite.pilotEndDate).toBe("2026-01-15");
  });
});

describe("one subscription per branch", () => {
  it("bills each branch from its own child count and invoices it separately", async () => {
    const { instituteId, branchIds } = await newDaycare(2);
    await updateDaycareBilling(instituteId, { firstCycleStart: "2026-01-01" });
    await seedChildren(instituteId, branchIds[0]!, 5, "2025-12-01 09:00:00", "seed");
    await seedChildren(instituteId, branchIds[1]!, 20, "2025-12-01 09:00:00", "core");

    expect(await generateDueInvoices(utcDate(2026, 2, 2))).toBe(2);
    const invoices = await listInvoices(instituteId);
    expect(invoices).toHaveLength(2);

    const seed = invoices.find((i) => i.branchId === branchIds[0])!;
    const core = invoices.find((i) => i.branchId === branchIds[1])!;
    expect(seed.bandKey).toBe("seed");
    expect(seed.totalAmount).toBe(600);
    expect(seed.maxActiveChildren).toBe(5);
    expect(core.bandKey).toBe("core");
    expect(core.totalAmount).toBe(950);
    expect(core.maxActiveChildren).toBe(20);
    // Same cycle month, two subscriptions — the unique rule is per branch.
    expect(seed.cycleMonth).toBe("2026-01");
    expect(core.cycleMonth).toBe("2026-01");
  });

  it("bills 0 on a branch with no active children until its first child arrives", async () => {
    const { instituteId, branchIds } = await newDaycare(2);
    await updateDaycareBilling(instituteId, { firstCycleStart: "2026-01-01" });
    await seedChildren(instituteId, branchIds[0]!, 5, "2025-12-01 09:00:00", "active");

    expect(await generateDueInvoices(utcDate(2026, 2, 2))).toBe(1);
    expect((await listInvoices(instituteId)).map((i) => i.branchId)).toEqual([branchIds[0]]);

    // The empty branch's January peak was 0 and stays unbilled. Its first
    // child is enrolled in February, so only February is invoiced.
    await seedChildren(instituteId, branchIds[1]!, 3, "2026-02-10 09:00:00", "late");
    // February is due for the active branch and for the branch whose first
    // child arrived; January for the late branch stays unbilled (peak 0).
    expect(await generateDueInvoices(utcDate(2026, 3, 2))).toBe(2);
    const late = (await listInvoices(instituteId)).filter((i) => i.branchId === branchIds[1]);
    expect(late.map((i) => i.cycleMonth)).toEqual(["2026-02"]);
    expect(late[0]!.totalAmount).toBe(600);
  });

  it("anchors a branch's first cycle to the month after the branch is created", async () => {
    const { instituteId, branchIds } = await newDaycare(2);
    const branch = await queryGet("SELECT created_at FROM branch WHERE id = ?", branchIds[1]);
    const expected = nextMonthStart(new Date(String(branch!.created_at)));
    const billing = await getBranchBilling(branchIds[1]!);
    expect(billing!.firstCycleStart).toMatch(/^\d{4}-\d{2}-01$/);
    expect(billing!.firstCycleStart).toBe(expected);
    // Two branches of one group are two subscription rows.
    expect(await listBranchBillings(instituteId)).toHaveLength(2);
  });

  it("counts a child with no branch on the institute's first branch", async () => {
    const { instituteId, branchIds } = await newDaycare(2);
    await updateDaycareBilling(instituteId, { firstCycleStart: "2026-01-01" });
    await seedChildren(instituteId, null, 7, "2025-12-01 09:00:00", "unassigned");

    expect(await generateDueInvoices(utcDate(2026, 2, 2))).toBe(1);
    const invoice = (await listInvoices(instituteId))[0]!;
    expect(invoice.branchId).toBe(branchIds[0]);
    expect(invoice.maxActiveChildren).toBe(7);
    expect(invoice.totalAmount).toBe(600);
  });
});

describe("founding slots count branch subscriptions", () => {
  it("a later branch uses one new slot and gets its own 12-month start", async () => {
    const { instituteId, branchIds } = await newDaycare(2);
    // Flag the group: every existing branch consumes a slot.
    await updateDaycareBilling(instituteId, {
      foundingClient: true,
      foundingStartedAt: "2026-01-01",
    });
    expect(await countFoundingClients()).toBe(2);

    // A branch added to the same group joins the cohort with its own start.
    const third = await store.createBranch(instituteId, "Branch 3");
    const billing = await getBranchBilling(String(third.id));
    expect(billing!.foundingClient).toBe(true);
    expect(billing!.foundingStartedAt).toBe(billing!.firstCycleStart);
    expect(await countFoundingClients()).toBe(3);

    // And the engine gives that branch the founding rate, not the group's
    // original anchor: 5 children -> Seed founding 510.
    await updateDaycareBilling(instituteId, { firstCycleStart: "2026-01-01" });
    for (const branchId of [...branchIds, String(third.id)]) {
      await seedChildren(instituteId, branchId, 5, "2025-12-01 09:00:00", branchId.slice(-4));
    }
    await generateDueInvoices(utcDate(2026, 2, 2));
    const thirdInvoice = (await listInvoices(instituteId)).find((i) => i.branchId === String(third.id))!;
    expect(thirdInvoice.foundingApplied).toBe(true);
    expect(thirdInvoice.totalAmount).toBe(510);
  });

  it("refuses the flag past the configured cap at the branch level", async () => {
    const { instituteId, branchIds } = await newDaycare(2);
    await updatePricingSettings({ foundingCap: 1 });
    await updateBranchBilling(branchIds[0]!, {
      foundingClient: true,
      foundingStartedAt: "2026-01-01",
    });
    expect(await countFoundingClients()).toBe(1);
    let capReached = false;
    try {
      await updateBranchBilling(branchIds[1]!, {
        foundingClient: true,
        foundingStartedAt: "2026-01-01",
      });
    } catch (err) {
      capReached = String((err as Error).message) === "founding-cap-reached";
    }
    expect(capReached).toBe(true);
    expect(await countFoundingClients()).toBe(1);
  });
});
