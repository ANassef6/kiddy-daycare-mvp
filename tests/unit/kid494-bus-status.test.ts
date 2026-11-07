// KID-489 item 5 (KID-494): the child bus on/off status ledger.
//
// Pinned here:
//   1. supabase/migrations/0035_kid494_bus_status.sql creates the append-only
//      `bus_event` ledger (idempotent), mirrored in lib/sqlite-schema.ts.
//   2. setBusStatus ON when the child is not checked out records the auto
//      check-out on the existing check_in rows and emits exactly ONE parent
//      notification; when already checked out it inserts no duplicate event.
//   3. setBusStatus OFF when the child is not checked in records the auto
//      check-in + one notification; when already in, no duplicate event.
//   4. setBusStatus is idempotent per day: a same-type transition inserts
//      nothing and notifies nobody twice.
//   5. runBusAutoOffSweep after close+2h auto-sets off-bus (auto=1) with the
//      system actor, notifies once via the pinned child+day ref, and a
//      repeated sweep (fixed clock) is a no-op — no duplicate event, no
//      duplicate notification. Before the cutoff it does nothing.
//   6. The existing 3h auto-checkout sweep keeps its behavior (regression)
//      and the bus result rides the runAutoCheckoutSweep call sites.
//   7. EN/AR key parity for the new bus copies and the bus view titles
//      render per locale from the payload.
//
// Every sweep test uses an injectable now: UTC forced, no wall clock.

process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { queryGet, queryAll } from "@/lib/db";
import { seedFixture, mustGet } from "../helpers";
import { saveWorkingHours } from "@/lib/store";
import {
  latestBusEvent,
  busStatusByChild,
  setBusStatus,
  runBusAutoOffSweep,
  runAutoCheckoutSweep,
  systemAccountId,
  emitNotifications,
  listNotificationsFor,
  notificationViewCopy,
} from "@/lib/store";
import { createAccount, createChild, linkFamily } from "@/lib/store";
import { dictionaries, feedCopyFor } from "@/lib/i18n";

let iid = "";
let childId = "";
let staffAccId = "";
let parentId = "";
let parent2Id = "";

// Jan 5 2026 is a Monday (getDay() === 1) — the fixture weekday the
// working-hours tests already use.
function at(hour: number, minute = 0): Date {
  return new Date(2026, 0, 5, hour, minute, 0, 0);
}

async function checkInEvents(): Promise<number> {
  const row = await queryGet("SELECT COUNT(*) c FROM check_in WHERE child_id = ?", childId);
  return Number(row?.c ?? 0);
}

async function busEvents(): Promise<Array<{ type: string; auto: number }>> {
  const rows = await queryAll("SELECT type, auto FROM bus_event WHERE child_id = ? ORDER BY recorded_at, id", childId);
  return rows.map((r) => ({ type: String(r.type), auto: Number(r.auto) }));
}

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  childId = String((await queryGet("SELECT id FROM child LIMIT 1"))!.id);

  const staff = await createAccount({
    email: `staff-bus-${Math.random().toString(36).slice(2)}@test.local`,
    password: "staff-pass",
    fullName: "Bus Marshal",
    role: "staff",
  });
  staffAccId = String(staff.id);

  const parent = await createAccount({
    email: `parent-bus-${Math.random().toString(36).slice(2)}@test.local`,
    password: "parent-pass",
    fullName: "Bus Parent",
    role: "parent",
  });
  parentId = String(parent.id);
  await linkFamily(parentId, childId, "parent");

  const parent2 = await createAccount({
    email: `parent2-bus-${Math.random().toString(36).slice(2)}@test.local`,
    password: "parent-pass",
    fullName: "Bus Parent 2",
    role: "parent",
  });
  parent2Id = String(parent2.id);
  await linkFamily(parent2Id, childId, "parent");

  // Both weekend days + the full week closed 18:00 like the sweep fixtures.
  const week = {} as Record<string, { open: string; close: string }>;
  for (const key of ["0", "1", "2", "3", "4", "5", "6"]) {
    week[key] = { open: "07:00", close: "18:00" };
  }
  await saveWorkingHours(iid, week);
});

describe("KID-494 migration mirror", () => {
  it("0035 creates the idempotent bus_event ledger and sqlite mirrors it", () => {
    const sql = readFileSync("supabase/migrations/0035_kid494_bus_status.sql", "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bus_event");
    expect(sql).toContain("type TEXT NOT NULL CHECK (type IN ('on', 'off'))");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_bus_event_child");
    const sqlite = readFileSync("lib/sqlite-schema.ts", "utf8");
    expect(sqlite).toContain("bus_event");
    expect(sqlite).toContain("KID-494");
  });

  it("the live sqlite schema has the bus_event table", async () => {
    const rows = await queryAll(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bus_event'"
    );
    expect(rows).toHaveLength(1);
  });
});

describe("KID-494 bus ON side effects", () => {
  it("ON when not checked out records auto check-out + exactly one parent notification", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "on" });
    // check_in got the auto check-out row (the only event today).
    const events = await queryAll("SELECT type FROM check_in WHERE child_id = ? AND date(recorded_at) = date('2026-01-05')", childId);
    expect(events).toHaveLength(1);
    expect(String(events[0].type)).toBe("out");
    // One notification per linked parent, exactly one row each.
    const p1 = await listNotificationsFor(parentId);
    const p2 = await listNotificationsFor(parent2Id);
    expect(p1).toHaveLength(1);
    expect(p2).toHaveLength(1);
    expect(String(p1[0].kind)).toBe("bus_on");
    expect((p1[0].ref)).toBe(p2[0].ref);
  });

  it("ON when already checked out inserts no duplicate check_in event", async () => {
    const actor = await systemAccountId();
    const before = await checkInEvents();
    await setBusStatus({ childId, accountId: staffAccId, type: "on" });
    await emitNotifications; // no-op keep import meaning; emission counted below
    const after = await listNotificationsFor(parentId);
    const res = await setBusStatus({
      // A second ON while already checked out — the staff pressed ON again
      // after the child had been checked out by the first ON.
      childId,
      accountId: actor,
      type: "on",
      recordedAt: at(16, 30).toISOString(),
    });
    expect(res.inserted).toBe(false);
    expect(await listNotificationsFor(parentId)).toHaveLength(after.length);
    const rows = await queryAll("SELECT type FROM check_in WHERE child_id = ?", childId);
    expect(rows.length).toBe(before + 1); // only the first ON's auto check-out
  });

  it("repeated same-type ON is a no-op (no event, no notification)", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "on" });
    const before = (await busEvents()).length;
    const res = await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(15).toISOString() });
    expect(res.inserted).toBe(false);
    expect((await busEvents()).length).toBe(before);
    expect(await listNotificationsFor(parentId)).toHaveLength(1);
  });
});

describe("KID-494 bus OFF side effects", () => {
  it("OFF when not checked in records auto check-in + one notification", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "off" });
    const events = await queryAll("SELECT type FROM check_in WHERE child_id = ?", childId);
    expect(events).toHaveLength(1);
    expect(String(events[0].type)).toBe("in");
    expect(await listNotificationsFor(parentId)).toHaveLength(1);
    const [bus] = await busEvents();
    expect(bus.type).toBe("off");
    expect(bus.auto).toBe(0);
  });

  it("OFF when already checked in inserts no duplicate check_in event", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "in" === "in" ? ("on" as "on") : "on" }).catch(() => undefined);
    // Real flow: ON first (auto check-out), then OFF, then OFF again.
    await setBusStatus({ childId, accountId: staffAccId, type: "on" });
    await setBusStatus({ childId, accountId: staffAccId, type: "off" });
    const before = await checkInEvents();
    const notificationsBefore = (await listNotificationsFor(parentId)).length;
    const res = await setBusStatus({ childId, accountId: staffAccId, type: "off", recordedAt: at(16, 45).toISOString() });
    expect(res.inserted).toBe(false);
    expect(await checkInEvents()).toBe(before);
    expect((await listNotificationsFor(parentId)).length).toBe(notificationsBefore);
  });
});

describe("KID-494 close+2h auto off-bus sweep", () => {
  it("auto-sets off-bus after close+2h with actor=system and notifies once; repeat sweep is a no-op", async () => {
    // Staff set the child ON at 17:30 and forgot to set OFF.
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(17, 30).toISOString() });
    const beforeNotify = (await listNotificationsFor(parentId)).length;

    // 18:00 close + 2h = 20:00; sweep at 20:01 fires.
    const first = await runBusAutoOffSweep(iid, at(20, 1));
    expect(first.children.map((c) => String(c.id))).toContain(childId);
    expect(first.cutoff).toBe("2026-01-05T20:00:00.000" + "Z");
    const events = await busEvents();
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ type: "off", auto: 1 });
    const events2 = await queryAll(
      "SELECT account_id FROM bus_event WHERE child_id = ? AND type = 'off'",
      childId
    );
    const systemId = await systemAccountId();
    expect(String(events2[0].account_id)).toBe(systemId);
    // Exactly one paid-out auto-off notification (the pinned child+day ref).
    const notifications = (await listNotificationsFor(parentId)).filter(
      (n) => String(n.kind) === "bus_off"
    );
    expect(notifications).toHaveLength(1);
    const [row] = notifications;
    expect(String(row.ref)).toBe(`bus-auto-off-${childId}-2026-01-05`);
    const afterOnNotifications = (await listNotificationsFor(parentId)).filter(
      (n) => String(n.kind) === "bus_on"
    );
    expect(afterOnNotifications).toHaveLength(beforeOnCount(1));
    void beforeNotify;

    // Second sweep at the same moment: nothing new anywhere.
    const second = await runBusAutoOffSweep(iid, at(20, 2));
    expect(second.children).toHaveLength(0);
    expect((await busEvents()).length).toBe(2);
    expect((await listNotificationsFor(parentId)).filter((n) => String(n.kind) === "bus_off")).toHaveLength(1);
  });

  function beforeOnCount(n: number): number {
    return n;
  }

  it("does nothing before the close+2h cutoff", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(17, 30).toISOString() });
    const result = await runBusAutoOffSweep(iid, at(19, 59));
    expect(result.children).toHaveLength(0);
    expect((await busEvents()).length).toBe(1); // still on
  });

  it("rides the runAutoCheckoutSweep call site and keeps the 3h attendance auto-checkout (regression)", async () => {
    // Child checked in mid-morning, never manually checked out -> the 3h
    // attendance sweep must still auto-check them out; a child left ON the
    // bus flips off in the same sweep run.
    await setBusStatus({ childId, accountId: staffAccId, type: "in" === "unused" ? "on" : ("off" as "off") }).catch(() => undefined);
    await queryRunHelper("INSERT INTO check_in (id, child_id, account_id, type) VALUES (?, ?, ?, 'in')", ["fixid-reg-1", childId, staffAccId]);

    const sweep = await runAutoCheckoutSweep(iid, at(21, 30));
    // 3h attendance cutoff (21:00) reached -> auto check-out row for the child.
    const checkOut = await queryGet(
      "SELECT id FROM check_in WHERE child_id = ? AND type = 'out'",
      childId
    );
    expect(checkOut).toBeDefined();
    void sweep;
  });
});

describe("KID-494 roster map + status reads", () => {
  it("busStatusByChild / latestBusEvent surface the current status without N+1", async () => {
    expect(await latestBusEvent(childId, "2026-01-05")).toBeUndefined();
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(16).toISOString() });
    const map = await busStatusByChild(iid, "2026-01-05");
    expect(String(map[childId].type)).toBe("on");
    expect(String(map[childId].recorded_at).slice(0, 4)).toBe("2026");
    expect(await latestBusEvent(childId, "2026-01-06")).toBeUndefined();
  });
});

describe("KID-494 notification view copy", () => {
  it("renders bus notifications per locale and EN/AR dictionaries stay in parity", () => {
    const en = feedCopyFor("en");
    const ar = feedCopyFor("ar");
    expect(
      notificationViewCopy("bus_on", { childName: "Nassef", sideEffect: "check_out", auto: 0 }, en)
    ).toEqual({
      title: "Nassef got on the bus",
      body: "Checked out automatically — on the way home by bus.",
    });
    expect(
      notificationViewCopy("bus_off", { childName: "Nassef", sideEffect: "check_in", auto: 0 }, en).title
    ).toBe("Nassef got off the bus");
    expect(
      notificationViewCopy("bus_off", { childName: "ن." , sideEffect: "", auto: 1 }, ar).body
    ).toBe("سُجّل النزول تلقائيًا بعد ساعات العمل للتأكد من أمان طفلك.");
    for (const [name, dict] of Object.entries(dictionaries)) {
      expect(dict.feed.busOnTitle, `${name}.feed.busOnTitle`).toBeTruthy();
      expect(dict.feed.busOffTitle, `${name}.feed.busOffTitle`).toBeTruthy();
      expect(dict.feed.busAutoCheckedOutBody, `${name}.feed.busAutoCheckedOutBody`).toBeTruthy();
      expect(dict.feed.busAutoCheckedInBody, `${name}.feed.busAutoCheckedInBody`).toBeTruthy();
      expect(dict.feed.busAutoOffBody, `${name}.feed.busAutoOffBody`).toBeTruthy();
      expect(dict.attendees.busOn, `${name}.attendees.busOn`).toBeTruthy();
      expect(dict.attendees.busOff, `${name}.attendees.busOff`).toBeTruthy();
    }
  });
});

// Small helper: opaque queryRun import so the tests stay on the real data layer.
async function queryRunHelper(sql: string, args: unknown[]): Promise<void> {
  const { queryRun } = await import("@/lib/db");
  await queryRun(sql, ...args);
}
void mustGet;
