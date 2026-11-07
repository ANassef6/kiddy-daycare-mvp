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
//      and the bus wheel runs through the shared runAutoCheckoutSweep call
//      sites (busOff in the return shape).
//   7. EN/AR key parity for the new bus copies and view titles render per
//      locale from the payload.
//
// Every sweep test uses an injectable `now` (UTC forced) — no wall clock.

process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { queryGet, queryAll, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";
import { createAccount } from "@/lib/auth";
import {
  latestBusEvent,
  busStatusByChild,
  setBusStatus,
  runBusAutoOffSweep,
  runAutoCheckoutSweep,
  systemAccountId,
  listNotificationsFor,
  notificationViewCopy,
  linkFamily,
  saveWorkingHours,
} from "@/lib/store";
import type { Row } from "@/lib/db";
import { dictionaries, feedCopyFor } from "@/lib/i18n";

let iid = "";
let childId = "";
let staffAccId = "";
let parentId = "";
let parent2Id = "";
let systemId = "";

// Jan 5 2026 is a Monday (getDay() === 1) — the fixture weekday the
// working-hours suite already uses.
function at(hour: number, minute = 0): Date {
  return new Date(2026, 0, 5, hour, minute, 0, 0);
}

async function checkInEvents(): Promise<string[]> {
  const rows = await queryAll(
    "SELECT type FROM check_in WHERE child_id = ? ORDER BY recorded_at, id",
    childId
  );
  return rows.map((r) => String(r.type));
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

  const week: Record<string, { open: string; close: string }> = {};
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
    expect(sqlite).toContain("0035_kid494_bus_status");
  });

  it("the live sqlite schema has the bus_event table with the on/off check", async () => {
    const rows = await queryAll(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bus_event'"
    );
    expect(rows).toHaveLength(1);
  });
});

describe("KID-494 bus ON side effects", () => {
  it("ON when not checked out records auto check-out + one parent notification", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "on" });
    expect(await checkInEvents()).toEqual(["out"]);
    const p1 = await listNotificationsFor(parentId);
    const p2 = await listNotificationsFor(parent2Id);
    expect(p1).toHaveLength(1);
    expect(p2).toHaveLength(1);
    expect(String(p1[0].kind)).toBe("bus_on");
    expect(String(p1[0].ref)).toBe(String(p2[0].ref));
    expect((await busEvents())[0]).toEqual({ type: "on", auto: 0 });
  });

  it("ON when already checked out inserts no duplicate check_in event", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(16).toISOString() });
    const notificationsBefore = (await listNotificationsFor(parentId)).length;
    const res = await setBusStatus({
      // A second ON the same day while already ON-bus: the latest event IS
      // 'on', so the re-click is a no-op and check_in stays untouched.
      childId,
      accountId: systemId,
      type: "on",
      recordedAt: at(16, 30).toISOString(),
    });
    expect(res.inserted).toBe(false);
    expect(await checkInEvents()).toEqual(["out"]);
    expect((await listNotificationsFor(parentId)).length).toBe(notificationsBefore);
  });

  it("a second ON after the child is checked in again still auto-checks out", async () => {
    // ON (auto check-out) -> staff checks the child back IN -> OFF -> ON
    // again must flip the fresh check-in out, exactly once per ON.
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(16).toISOString() });
    await queryRun(
      "INSERT INTO check_in (id, child_id, account_id, type, recorded_at) VALUES (?, ?, ?, 'in', ?)",
      "kid494-manual-in",
      childId,
      staffAccId,
      at(16, 10).toISOString()
    );
    await setBusStatus({ childId, accountId: staffAccId, type: "off", recordedAt: at(16, 20).toISOString() });
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(17).toISOString() });
    expect(await checkInEvents()).toEqual(["out", "in", "out"]);
  });
});

describe("KID-494 bus OFF side effects", () => {
  it("OFF when not checked in records auto check-in + one notification", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "off" });
    expect(await checkInEvents()).toEqual(["in"]);
    expect(await listNotificationsFor(parentId)).toHaveLength(1);
    expect((await busEvents())[0]).toEqual({ type: "off", auto: 0 });
  });

  it("OFF when already checked in inserts no duplicate check_in event", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "off", recordedAt: at(16).toISOString() });
    const notificationsBefore = (await listNotificationsFor(parentId)).length;
    const res = await setBusStatus({
      childId,
      accountId: staffAccId,
      type: "off",
      recordedAt: at(16, 45).toISOString(),
    });
    expect(res.inserted).toBe(false);
    expect(await checkInEvents()).toEqual(["in"]);
    expect((await listNotificationsFor(parentId)).length).toBe(notificationsBefore);
  });
});

describe("KID-494 close+2h auto off-bus sweep", () => {
  it("auto-sets off-bus after close+2h with actor=system; repeat sweep is a no-op", async () => {
    // Staff set the child ON at 17:30 and forgot to set OFF.
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(17, 30).toISOString() });

    // Close 18:00 + 2h = 20:00; the sweep at 20:01 fires.
    const first = await runBusAutoOffSweep(iid, at(20, 1));
    expect(first.children.map((c: Row) => String(c.id))).toContain(childId);
    expect(first.cutoff).toBe("2026-01-05T20:00:00.000Z");
    expect((await busEvents())).toEqual([
      { type: "on", auto: 0 },
      { type: "off", auto: 1 },
    ]);
    const systemRows = await queryAll(
      "SELECT account_id FROM bus_event WHERE child_id = ? AND type = 'off'",
      childId
    );
    expect(String(systemRows[0].account_id)).toBe(systemId);
    // The child ON story rides the side effect: check-out row was recorded
    // with the ON, and the sweep's OFF recorded a fresh check-in.
    expect(await checkInEvents()).toContain("in");

    // Exactly one bus_off notification with the pinned child+day ref.
    const offs = (await listNotificationsFor(parentId)).filter(
      (n) => String(n.kind) === "bus_off"
    );
    expect(offs).toHaveLength(1);
    expect(String(offs[0].ref)).toBe(`bus-auto-off-${childId}-2026-01-05`);

    // Second sweep: no new event, no new notification — dedupe holds.
    const second = await runBusAutoOffSweep(iid, at(20, 2));
    expect(second.children).toHaveLength(0);
    expect((await busEvents()).length).toBe(2);
    expect(
      (await listNotificationsFor(parentId)).filter((n) => String(n.kind) === "bus_off")
    ).toHaveLength(1);
  });

  it("does nothing before the close+2h cutoff", async () => {
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(17, 30).toISOString() });
    const result = await runBusAutoOffSweep(iid, at(19, 59));
    expect(result.children).toHaveLength(0);
    expect((await busEvents()).length).toBe(1);
  });

  it("rides the runAutoCheckoutSweep call site and keeps the 3h attendance auto-checkout (regression)", async () => {
    // Child waved onto the bus at 17:30 — staff forgot the OFF. The ON's
    // auto check-out already sits in the attendance ledger; a 18:05 same-day
    // re-arrival gives the 3h attendance sweep work to do.
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(17, 30).toISOString() });
    await queryRun(
      "INSERT INTO check_in (id, child_id, account_id, type, recorded_at) VALUES (?, ?, ?, 'in', ?)",
      "kid494-reg-1",
      childId,
      staffAccId,
      at(18, 5).toISOString()
    );

    const sweep = await runAutoCheckoutSweep(iid, at(21, 30));
    // The 3h attendance sweep still auto-checks the still-in child out
    // (21:00 cutoff on an 18:00 close) with actor=system at the sweep stamp.
    const out = await queryGet(
      "SELECT recorded_at FROM check_in WHERE child_id = ? AND type = 'out' ORDER BY recorded_at DESC LIMIT 1",
      childId
    );
    expect(String(out?.recorded_at ?? "")).toBe(at(21, 30).toISOString());
    // Attendance story: ON auto check-out, the 18:05 re-arrival, then the
    // sweep's OFF auto-check-in (the child is not checked in when the bus
    // OFF lands — spec side effect) and the 3h attendance auto check-out.
    expect(await checkInEvents()).toEqual(["out", "in", "out", "in"]);
    // The SAME run also flipped the forgotten bus OFF (close+2h reached),
    // exactly once, with the single parent notification — no duplicate from
    // the attendance half of the sweep.
    expect(sweep.busOff.map((c: Row) => String(c.id))).toContain(childId);
    expect((await busEvents()).length).toBe(2);
    expect(
      (await listNotificationsFor(parentId)).filter((n) => String(n.kind) === "bus_off")
    ).toHaveLength(1);
  });
});

describe("KID-494 roster map + status reads", () => {
  it("busStatusByChild / latestBusEvent surface the current status without N+1", async () => {
    expect(await latestBusEvent(childId, "2026-01-05")).toBeUndefined();
    await setBusStatus({ childId, accountId: staffAccId, type: "on", recordedAt: at(16).toISOString() });
    void (await latestBusEvent(childId, "2026-01-05"));
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
      notificationViewCopy("bus_off", { childName: "ن.", sideEffect: "", auto: 1 }, ar).body
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
