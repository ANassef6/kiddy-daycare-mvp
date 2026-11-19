// KID-2448: the bus transport attendance cycle (morning pair + afternoon pair).
//
// Pinned here:
//   1. supabase/migrations/0051_kid2448_bus_cycle.sql adds the nullable
//      `check_in.source` marker (idempotent) and lib/sqlite-schema.ts mirrors it.
//   2. The strict sequence: On bus -> Off bus -> On bus -> Off bus. A morning
//      off-bus auto-checks the child IN (source 'bus'); an afternoon off-bus
//      auto-checks them OUT (source 'bus'). The two on-bus transitions write no
//      attendance row (the child is en route).
//   3. Guards: off-bus without a prior on-bus is rejected (`off_without_on`);
//      a fifth transition is rejected (`cycle_complete`); a repeat of the
//      latest type is an idempotent no-op (double click / repeated sweep).
//   4. Exactly one guardian notification per transition, with the phase that
//      distinguishes pick-up / arrival / departure / drop-off in EN and AR.
//   5. The close+2h bus sweep sets the forgotten off-bus with actor=system and
//      its side effect follows the phase (morning -> check-in, afternoon ->
//      check-out); a second sweep is a no-op.
//   6. The end-of-day child sweep does not write its own check-out for a child
//      whose latest bus state is "on" (KID-2447 coordination).
//   7. Parent-facing roster/child status phases and EN/AR dictionary parity.
//
// Every sweep test uses an injectable `now` — no wall clock.

process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { queryGet, queryAll, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";
import { createAccount } from "@/lib/auth";
import {
  BUS_SOURCE,
  BusCycleError,
  busNextAction,
  busPhaseForCount,
  busStatusByChild,
  latestBusEvent,
  listNotificationsFor,
  notificationViewCopy,
  linkFamily,
  runAutoCheckoutSweep,
  runBusAutoOffSweep,
  saveWorkingHours,
  setBusStatus,
  systemAccountId,
} from "@/lib/store";
import type { Row } from "@/lib/db";
import { dictionaries, feedCopyFor } from "@/lib/i18n";

let iid = "";
let childId = "";
let staffAccId = "";
let parentId = "";
let parent2Id = "";
let systemId = "";

// Jan 5 2026 is a Monday (getDay() === 1).
function at(hour: number, minute = 0): Date {
  return new Date(2026, 0, 5, hour, minute, 0, 0);
}

async function checkInRows(): Promise<Array<{ type: string; source: string | null }>> {
  const rows = await queryAll(
    "SELECT type, source FROM check_in WHERE child_id = ? ORDER BY recorded_at, id",
    childId
  );
  return rows.map((r) => ({ type: String(r.type), source: r.source == null ? null : String(r.source) }));
}

async function busEvents(): Promise<Array<{ type: string; auto: number }>> {
  const rows = await queryAll(
    "SELECT type, auto FROM bus_event WHERE child_id = ? ORDER BY recorded_at, id",
    childId
  );
  return rows.map((r) => ({ type: String(r.type), auto: Number(r.auto) }));
}

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  childId = String((await queryGet("SELECT id FROM child LIMIT 1"))!.id);
  systemId = await systemAccountId();

  const staff = await createAccount({
    email: `staff-bus1-${Math.random().toString(36).slice(2)}@test.local`,
    password: "staff-pass",
    fullName: "Bus Marshal",
    role: "staff",
  });
  staffAccId = String(staff.id);

  const parent = await createAccount({
    email: `parent-bus1-${Math.random().toString(36).slice(2)}@test.local`,
    password: "parent-pass",
    fullName: "Bus Parent",
    role: "parent",
  });
  parentId = String(parent.id);
  await linkFamily(parentId, childId, "parent");

  const parent2 = await createAccount({
    email: `parent2-bus1-${Math.random().toString(36).slice(2)}@test.local`,
    password: "parent-pass",
    fullName: "Bus Parent 2",
    role: "parent",
  });
  parent2Id = String(parent2.id);
  await linkFamily(parent2Id, childId, "parent");

  const week: Record<string, { open: string; close: string }> = {};
  for (const key of ["0", "1", "2", "3", "4", "5", "6"]) {
    week[key] = { open: "07:00", close: "18:00" };
  }
  await saveWorkingHours(iid, week);
});

describe("KID-2448 migration mirror", () => {
  it("0051 adds the nullable source marker and sqlite mirrors the column", async () => {
    const sql = readFileSync("supabase/migrations/0051_kid2448_bus_cycle.sql", "utf8");
    expect(sql).toContain("ALTER TABLE check_in ADD COLUMN IF NOT EXISTS source TEXT");
    const sqlite = readFileSync("lib/sqlite-schema.ts", "utf8");
    expect(sqlite).toContain("0051_kid2448_bus_cycle");
    const cols = await queryAll("PRAGMA table_info(check_in)");
    expect(cols.some((c: Row) => String(c.name) === "source")).toBe(true);
  });
});

describe("KID-2448 cycle helpers", () => {
  it("maps counts to the four phases and the next action", () => {
    expect(busPhaseForCount(0)).toBeNull();
    expect(busPhaseForCount(1)).toBe("morning_on");
    expect(busPhaseForCount(2)).toBe("morning_off");
    expect(busPhaseForCount(3)).toBe("afternoon_on");
    expect(busPhaseForCount(4)).toBe("afternoon_off");
    expect(busPhaseForCount(5)).toBeNull();
    expect([0, 1, 2, 3, 4].map(busNextAction)).toEqual(["on", "off", "on", "off", null]);
  });
});

describe("KID-2448 full bus cycle", () => {
  it("morning on -> off auto-checks in, afternoon on -> off auto-checks out, all marked source=bus", async () => {
    // Morning: On bus (no attendance write).
    const on1 = await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(7, 15).toISOString() });
    expect(on1).toMatchObject({ inserted: true, sideEffect: null, phase: "morning_on", next: "off" });
    expect(await checkInRows()).toEqual([]);

    // Morning: Off bus -> auto check-in with source 'bus'.
    const off1 = await setBusStatus({ childId, accountId: staffAccId, type: "off", recordedAt: at(7, 45).toISOString() });
    expect(off1).toMatchObject({ inserted: true, sideEffect: "check_in", phase: "morning_off", next: "on" });
    expect(await checkInRows()).toEqual([{ type: "in", source: BUS_SOURCE }]);

    // Afternoon: On bus -> no attendance write.
    const on2 = await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(16).toISOString() });
    expect(on2).toMatchObject({ inserted: true, sideEffect: null, phase: "afternoon_on", next: "off" });
    expect(await checkInRows()).toEqual([{ type: "in", source: BUS_SOURCE }]);

    // Afternoon: Off bus -> auto check-out with source 'bus'.
    const off2 = await setBusStatus({ childId, accountId: staffAccId, type: "off", recordedAt: at(16, 40).toISOString() });
    expect(off2).toMatchObject({ inserted: true, sideEffect: "check_out", phase: "afternoon_off", next: null });
    expect(await checkInRows()).toEqual([
      { type: "in", source: BUS_SOURCE },
      { type: "out", source: BUS_SOURCE },
    ]);
    expect(await busEvents()).toEqual([
      { type: "on", auto: 0 },
      { type: "off", auto: 0 },
      { type: "on", auto: 0 },
      { type: "off", auto: 0 },
    ]);

    // One notification per transition for both linked guardians.
    const p1 = await listNotificationsFor(parentId);
    const p2 = await listNotificationsFor(parent2Id);
    expect(p1).toHaveLength(4);
    expect(p2).toHaveLength(4);
    // Newest first: the four transitions are still one of each kind per pair.
    expect(p1.map((n) => String(n.kind))).toEqual(["bus_off", "bus_on", "bus_off", "bus_on"]);
  });

  it("rejects off-bus without a prior on-bus", async () => {
    await expect(
      setBusStatus({ childId, accountId: staffAccId, type: "off", recordedAt: at(16).toISOString() })
    ).rejects.toMatchObject({ code: "off_without_on" });
    expect(await busEvents()).toEqual([]);
    expect(await checkInRows()).toEqual([]);
  });

  it("rejects a fifth transition after both pairs", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(7, 15).toISOString() });
    await setBusStatus({ childId, accountId: staffAccId, type: "off", recordedAt: at(7, 45).toISOString() });
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(16).toISOString() });
    await setBusStatus({ childId, accountId: staffAccId, type: "off", recordedAt: at(16, 40).toISOString() });
    await expect(
      setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(17).toISOString() })
    ).rejects.toBeInstanceOf(BusCycleError);
    expect(await busEvents()).toHaveLength(4);
  });

  it("treats a repeat of the latest transition as an idempotent no-op", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(7, 15).toISOString() });
    const before = (await listNotificationsFor(parentId)).length;
    const again = await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(7, 20).toISOString() });
    expect(again.inserted).toBe(false);
    expect(await busEvents()).toHaveLength(1);
    expect((await listNotificationsFor(parentId)).length).toBe(before);
  });
});

describe("KID-2448 bus sweep", () => {
  it("sets a forgotten morning off-bus after close+2h and auto-checks in", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(7, 15).toISOString() });
    const first = await runBusAutoOffSweep(iid, at(20, 1));
    expect(first.children.map((c: Row) => String(c.id))).toContain(childId);
    expect(await busEvents()).toEqual([
      { type: "on", auto: 0 },
      { type: "off", auto: 1 },
    ]);
    expect(await checkInRows()).toEqual([{ type: "in", source: BUS_SOURCE }]);
    const systemRows = await queryAll(
      "SELECT account_id FROM bus_event WHERE child_id = ? AND type = 'off'",
      childId
    );
    expect(String(systemRows[0].account_id)).toBe(systemId);

    const second = await runBusAutoOffSweep(iid, at(20, 2));
    expect(second.children).toHaveLength(0);
    expect(await busEvents()).toHaveLength(2);
  });

  it("sets a forgotten afternoon off-bus after close+2h and auto-checks out", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(7, 15).toISOString() });
    await setBusStatus({ childId, accountId: staffAccId, type: "off", recordedAt: at(7, 45).toISOString() });
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(16).toISOString() });
    await runBusAutoOffSweep(iid, at(20, 1));
    expect(await checkInRows()).toEqual([
      { type: "in", source: BUS_SOURCE },
      { type: "out", source: BUS_SOURCE },
    ]);
    const offs = (await listNotificationsFor(parentId)).filter((n) => String(n.kind) === "bus_off");
    expect(offs).toHaveLength(2);
    expect(
      offs.some((n) => String(n.ref) === `bus-auto-off-${childId}-2026-01-05`)
    ).toBe(true);
  });

  it("the end-of-day child sweep skips a child whose latest bus state is on", async () => {
    // Morning pair complete -> checked in. Then the afternoon On bus.
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(7, 15).toISOString() });
    await setBusStatus({ childId, accountId: staffAccId, type: "off", recordedAt: at(7, 45).toISOString() });
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(16).toISOString() });

    // At close+3h the child half must leave the on-bus child to the bus net.
    const sweep = await runAutoCheckoutSweep(iid, at(21, 30));
    expect(sweep.children.map((c: Row) => String(c.id))).not.toContain(childId);
    expect(sweep.busOff.map((c: Row) => String(c.id))).toContain(childId);

    // Exactly one check-out row (the afternoon off-bus), marked source=bus.
    const outs = await queryAll(
      "SELECT source FROM check_in WHERE child_id = ? AND type = 'out'",
      childId
    );
    expect(outs).toHaveLength(1);
    expect(String(outs[0].source)).toBe(BUS_SOURCE);
  });
});

describe("KID-2448 roster + status reads", () => {
  it("busStatusByChild and latestBusEvent expose the phase count without N+1", async () => {
    expect(await latestBusEvent(childId, "2026-01-05")).toBeUndefined();
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(7, 15).toISOString() });
    const map = await busStatusByChild(iid, "2026-01-05");
    expect(String(map[childId].type)).toBe("on");
    expect(Number(map[childId].day_count)).toBe(1);
    const latest = await latestBusEvent(childId, "2026-01-05");
    expect(Number(latest?.day_count)).toBe(1);
    expect(await latestBusEvent(childId, "2026-01-06")).toBeUndefined();
  });
});

describe("KID-2448 notification copy", () => {
  it("renders each phase per locale and keeps EN/AR dictionary parity", () => {
    const en = feedCopyFor("en");
    const ar = feedCopyFor("ar");
    expect(notificationViewCopy("bus_on", { childName: "Nassef", phase: "morning_on" }, en)).toEqual({
      title: "Nassef was picked up by the daycare bus",
      body: "On the way to the daycare.",
    });
    expect(
      notificationViewCopy("bus_off", { childName: "Nassef", phase: "morning_off" }, en).title
    ).toBe("Nassef arrived at the daycare");
    expect(
      notificationViewCopy("bus_on", { childName: "Nassef", phase: "afternoon_on" }, en).body
    ).toContain("On the way home");
    expect(
      notificationViewCopy("bus_off", { childName: "ن.", phase: "afternoon_off" }, ar).title
    ).toBe("وصول ن. إلى المنزل");
    // Legacy payloads (no phase) keep their old copy.
    expect(
      notificationViewCopy("bus_on", { childName: "Nassef", sideEffect: "check_out", auto: 0 }, en)
        .title
    ).toBe("Nassef got on the bus");

    for (const [name, dict] of Object.entries(dictionaries)) {
      expect(dict.feed.busPickedUpTitle, `${name}.feed.busPickedUpTitle`).toBeTruthy();
      expect(dict.feed.busArrivedTitle, `${name}.feed.busArrivedTitle`).toBeTruthy();
      expect(dict.feed.busDepartedTitle, `${name}.feed.busDepartedTitle`).toBeTruthy();
      expect(dict.feed.busDroppedOffTitle, `${name}.feed.busDroppedOffTitle`).toBeTruthy();
      expect(dict.attendees.busOnMorning, `${name}.attendees.busOnMorning`).toBeTruthy();
      expect(dict.attendees.busOffAfternoon, `${name}.attendees.busOffAfternoon`).toBeTruthy();
      expect(dict.attendance.busOnMorning, `${name}.attendance.busOnMorning`).toBeTruthy();
      expect(dict.attendance.busErrorOffWithoutOn, `${name}.attendance.busErrorOffWithoutOn`).toBeTruthy();
    }
  });
});
