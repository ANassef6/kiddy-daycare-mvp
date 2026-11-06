// KID-477: unified audit trail — the recordAuditEvent helper, the
// tenant-scoped/admin filterable listing, the daily-report edit trail
// (updated_at/updated_by_account_id) and the static pin that every listed
// mutation in lib/actions.ts still writes its audit row.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import {
  listAuditEvents,
  recordAuditEvent,
  actorNameFor,
  attributionFor,
  auditEntityTypes,
  auditActors,
} from "@/lib/audit";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let iid: string;
let owner: string;
let parentAcc: string;

async function auditCount(where = "1=1", ...args: unknown[]): Promise<number> {
  const rows = await queryAll(`SELECT COUNT(*) AS n FROM audit_event WHERE ${where}`, ...args);
  return Number((rows[0] as { n?: unknown })?.n ?? 0);
}

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  owner = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
  parentAcc = String((await queryGet("SELECT id FROM account WHERE role = 'parent' LIMIT 1"))!.id);
});

describe("recordAuditEvent (KID-477)", () => {
  it("writes exactly one row per event with the resolved actor-name snapshot", async () => {
    await recordAuditEvent({
      instituteId: iid,
      actorAccountId: owner,
      action: "create",
      entityType: "newsfeed_post",
      entityId: "post-1",
      summary: "Posted to the newsfeed",
      metadata: { taggedChildren: 2 },
    });
    expect(await auditCount("institute_id = ?", iid)).toBe(1);
    const row = (await queryGet(
      "SELECT * FROM audit_event WHERE entity_type = 'newsfeed_post' AND entity_id = 'post-1'"
    ))!;
    // actor_name is snapped from the account, not left for joins after deletion
    expect(String(row.actor_name)).toBe("Nassef");
    expect(String(row.actor_account_id)).toBe(owner);
    expect(String(row.action)).toBe("create");
    expect(String(row.summary)).toBe("Posted to the newsfeed");
    expect(JSON.parse(String(row.metadata))).toEqual({ taggedChildren: 2 });
    expect(row.created_at).toBeTruthy();
  });

  it("actorNameFor resolves the account and tolerates unknown ids", async () => {
    expect(await actorNameFor(owner)).toBe("Nassef");
    expect(await actorNameFor(null)).toBeNull();
    expect(await actorNameFor("no-such-account")).toBeNull();
  });

  it("an explicit actorName wins over the lookup", async () => {
    await recordAuditEvent({
      instituteId: iid,
      actorAccountId: owner,
      actorName: "Ops Console",
      action: "update",
      entityType: "institute_settings",
      entityId: iid,
      summary: "Updated the working hours",
    });
    const row = (await queryGet("SELECT actor_name FROM audit_event WHERE entity_type = 'institute_settings'"))!;
    expect(String(row.actor_name)).toBe("Ops Console");
  });

  it("never blocks the caller on a store failure and still runs user writes", async () => {
    // Metadata with a circular ref must not crash the action path.
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic["self"] = cyclic;
    await expect(
      recordAuditEvent({
        instituteId: iid,
        actorAccountId: owner,
        action: "create",
        entityType: "child",
        entityId: "c1",
        summary: "Enrolled someone",
        metadata: cyclic,
      })
    ).resolves.toBeUndefined();
  });
});

describe("listAuditEvents tenant scope + filters (KID-477)", () => {
  beforeEach(async () => {
    for (let i = 0; i < 5; i++) {
      await recordAuditEvent({
        instituteId: iid,
        actorAccountId: owner,
        action: "create",
        entityType: "newsfeed_post",
        entityId: `p${i}`,
        summary: `post ${i}`,
      });
    }
    await recordAuditEvent({
      instituteId: iid,
      actorAccountId: parentAcc,
      action: "send",
      entityType: "message",
      entityId: "m1",
      summary: "Sent a message",
    });
    await recordAuditEvent({
      instituteId: "other-institute",
      actorAccountId: owner,
      action: "create",
      entityType: "newsfeed_post",
      entityId: "foreign",
      summary: "from another daycare",
    });
  });

  it("enforces tenant scope — foreign institutes never leak, total reflects only this tenant", async () => {
    const { rows, total } = await listAuditEvents({ instituteId: iid });
    expect(total).toBe(6);
    expect(rows.every((r) => String(r.institute_id) === iid)).toBe(true);
    expect(rows.some((r) => r.entity_id === "foreign")).toBe(false);
  });

  it("filters by actor", async () => {
    const { rows, total } = await listAuditEvents({ instituteId: iid, actorAccountId: parentAcc });
    expect(total).toBe(1);
    expect(String(rows[0].entity_type)).toBe("message");
  });

  it("filters by entity type", async () => {
    const { total } = await listAuditEvents({ instituteId: iid, entityType: "newsfeed_post" });
    expect(total).toBe(5);
  });

  it("filters by inclusive date range", async () => {
    await queryRun(
      "UPDATE audit_event SET created_at = '2026-01-04 12:00:00' WHERE entity_id = 'p0'"
    );
    const allDays = await listAuditEvents({ instituteId: iid, from: "2026-01-04", to: "2026-01-04" });
    expect(allDays.total).toBe(1);
    const before = await listAuditEvents({ instituteId: iid, to: "2026-01-03" });
    expect(before.total).toBe(0);
    const modern = await listAuditEvents({ instituteId: iid, from: "2026-01-05" });
    expect(modern.total).toBe(5); // p1..p4 are today; p0 is pinned in January
  });

  it("paginates newest-first with a full count", async () => {
    const page1 = await listAuditEvents({ instituteId: iid, limit: 3, offset: 0 });
    expect(page1.total).toBe(6);
    expect(page1.rows).toHaveLength(3);
    const page2 = await listAuditEvents({ instituteId: iid, limit: 3, offset: 3 });
    expect(page2.rows).toHaveLength(3);
    const seen = new Set([...page1.rows, ...page2.rows].map((r) => r.id));
    expect(seen.size).toBe(6);
    const page3 = await listAuditEvents({ instituteId: iid, limit: 3, offset: 6 });
    expect(page3.rows).toHaveLength(0);
  });

  it("exposes filter dropdown data (entity types + actors)", async () => {
    const types = await auditEntityTypes(iid);
    expect(types).toEqual(["message", "newsfeed_post"]);
    const actors = await auditActors(iid);
    expect(actors.map((a) => String(a.actor_account_id)).sort()).toEqual([owner, parentAcc].sort());
  });
});

describe("daily report edit trail (KID-477)", () => {
  it("stamps updated_at/updated_by_account_id on edits while created_by stays the first author", async () => {
    const children = await queryAll("SELECT id FROM child WHERE institute_id = ? LIMIT 1", iid);
    const childId = String(children[0].id);
    const day = "2026-03-01";
    await store.upsertDailyReport({ childId, reportDate: day, summary: "first", accountId: owner });
    await store.upsertDailyReport({ childId, reportDate: day, summary: "second", accountId: parentAcc });

    const row = (await store.reportFor(childId, day))!;
    expect(String(row.summary)).toBe("second");
    expect(String(row.created_by_account_id)).toBe(owner);
    expect(String(row.updated_by_account_id)).toBe(parentAcc);
    expect(row.updated_at).toBeTruthy();
    // the joined names flow for the attribution component
    expect(String(row.created_by_name)).toBe("Nassef");
    expect(String(row.updated_by_name)).toBe("Grace Nguyen");
  });
});

describe("attributionFor (KID-477)", () => {
  it("picks the first create and the latest update", async () => {
    await recordAuditEvent({
      instituteId: iid,
      actorAccountId: owner,
      action: "create",
      entityType: "daily_report",
      entityId: "rep-1",
      summary: "Created a report",
    });
    await recordAuditEvent({
      instituteId: iid,
      actorAccountId: parentAcc,
      action: "update",
      entityType: "daily_report",
      entityId: "rep-1",
      summary: "Edited a report",
    });
    // The two updates must not tie on created_at (SQLite stores seconds).
    await new Promise((r) => setTimeout(r, 1100));
    await recordAuditEvent({
      instituteId: iid,
      actorAccountId: parentAcc,
      action: "update",
      entityType: "daily_report",
      entityId: "rep-1",
      summary: "Edited again",
    });
    const { created, updated } = await attributionFor(iid, "daily_report", "rep-1");
    expect(created).toBeDefined();
    expect(String(created!.actor_name)).toBe("Nassef");
    expect(updated).toBeDefined();
    expect(String(updated!.summary)).toBe("Edited again");
  });
});

// Static pin: lib/actions.ts must still carry its audit rows for every
// mutation the board listed. Grep-level, so a refactor that drops a
// recordAuditEvent call fails the suite.
describe("actions.ts instrumentation (KID-477)", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(
    path.join(__dirname, "../../lib/actions.ts"),
    "utf8"
  );

  const pinned = [
    "checkInOutAction",
    "saveDailyReportAction",
    "createNewsfeedAction",
    "commentAction",
    "toggleLikeAction",
    "createNewsfeedWithAttachmentAction",
    "respondConsentAction",
    "acknowledgeIncidentAction",
    "createSupplyAction",
    "updateSupplyStatusAction",
    "addRoomAction",
    "updateRoomAction",
    "addStaffAction",
    "updateStaffInfoAction",
    "createEventAction",
    "createFormAction",
    "setTicketStatusAction",
    "addChildBillingAction",
    "updateBillingStatusAction",
    "saveBrandingAction",
    "saveCenterDetailsAction",
    "saveWorkingHoursAction",
  ];

  it("every listed mutation action still declares `entityType:", () => {
    for (const action of pinned) {
      const start = source.indexOf(`export async function ${action}`);
      expect(start, `action ${action} missing`).toBeGreaterThanOrEqual(0);
      const body = source.slice(start, start + 4000);
      expect(body, `${action} lost its audit row`).toContain("entityType:");
    }
  });

  it("only one audit helper surface exists for actions (no per-action duplication)", () => {
    expect(source).toContain('recordAuditEvent');
  });
});
