// KID-2504: check-in/out defects pinned at the store layer.
//
//   1. todayStatus must report the CURRENT state from the day's LAST event, so
//      repeated same-day pairs (in -> out -> in) do not read as checked out
//      just because an earlier 'out' row exists.
//   2. registerCheckInOut keeps exactly one entry per child per CENTER-LOCAL
//      day (KID-2437 alignment), so a pair written across UTC midnight cannot
//      stack a duplicate.
//   3. The bus badge is display-only: a real attendance write after the latest
//      bus event marks the ledger phase stale, without mutating the append-only
//      bus ledger (KID-2448 semantics stay intact).

process.env.TZ = "UTC";

import { beforeEach, describe, expect, it } from "vitest";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";
import {
  attendanceOn,
  busBadgeIsStale,
  busStatusByChild,
  registerCheckInOut,
  setBusStatus,
  todayStatus,
} from "@/lib/store";
import type { Row } from "@/lib/db";

let iid = "";
let childId = "";
let ownerId = "";

const DAY = "2026-11-11";

function atUtc(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 10, 11, hour, minute, 0));
}

async function checkInRows(): Promise<Row[]> {
  return queryAll(
    "SELECT type, recorded_at, is_edit, source FROM check_in WHERE child_id = ? ORDER BY recorded_at, id",
    childId
  );
}

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  childId = String((await queryGet("SELECT id FROM child ORDER BY id LIMIT 1"))!.id);
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
});

describe("KID-2504 todayStatus current state", () => {
  it("reads a repeated same-day pair from the latest event", async () => {
    await registerCheckInOut({ childId, accountId: ownerId, type: "in", at: atUtc(8) });
    await registerCheckInOut({ childId, accountId: ownerId, type: "out", at: atUtc(12) });
    await registerCheckInOut({ childId, accountId: ownerId, type: "in", at: atUtc(13) });

    const status = await todayStatus(childId, atUtc(14));
    expect(status.isCheckedIn).toBe(true);
    expect(String(status.lastEvent!.type)).toBe("in");
    // Timestamp history still exposes the earlier pickup (KID-1371 display).
    expect(String(status.checkedOut!.recorded_at)).toBe(atUtc(12).toISOString());
    expect(String(status.checkedIn!.recorded_at)).toBe(atUtc(13).toISOString());
  });

  it("flips back to checked out on a later manual check-out", async () => {
    await registerCheckInOut({ childId, accountId: ownerId, type: "in", at: atUtc(8) });
    await registerCheckInOut({ childId, accountId: ownerId, type: "out", at: atUtc(12) });
    await registerCheckInOut({ childId, accountId: ownerId, type: "in", at: atUtc(13) });
    await registerCheckInOut({ childId, accountId: ownerId, type: "out", at: atUtc(15) });

    const status = await todayStatus(childId, atUtc(16));
    expect(status.isCheckedIn).toBe(false);
    expect(String(status.lastEvent!.type)).toBe("out");
    expect(String(status.checkedIn!.recorded_at)).toBe(atUtc(13).toISOString());
    expect(String(status.checkedOut!.recorded_at)).toBe(atUtc(15).toISOString());
    expect(await checkInRows()).toHaveLength(4);
  });

  it("keeps the one-entry-per-day dedupe on the CENTER-LOCAL day across UTC midnight", async () => {
    // Cairo is UTC+2: both instants are the same Cairo calendar day (Nov 6)
    // but different UTC dates (Nov 5 and Nov 6).
    await queryRun("UPDATE institute SET timezone = 'Africa/Cairo' WHERE id = ?", iid);
    await registerCheckInOut({
      childId,
      accountId: ownerId,
      type: "in",
      at: new Date("2026-11-05T23:30:00.000Z"), // Nov 6 01:30 Cairo
    });
    const second = await registerCheckInOut({
      childId,
      accountId: ownerId,
      type: "in",
      at: new Date("2026-11-06T10:00:00.000Z"), // Nov 6 12:00 Cairo
    });

    expect(second.wasUpdate).toBe(true);
    const rows = await checkInRows();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].is_edit)).toBe(1);
    expect(String(rows[0].recorded_at)).toBe("2026-11-06T10:00:00.000Z");
  });
});

describe("KID-2504 bus badge staleness rule", () => {
  it("is stale only when a real attendance write is later than the bus event", () => {
    expect(busBadgeIsStale("2026-11-11T15:00:00.000Z", "2026-11-11T15:30:00.000Z")).toBe(true);
    // A genuine bus side-effect row shares the transition timestamp.
    expect(busBadgeIsStale("2026-11-11T15:00:00.000Z", "2026-11-11T15:00:00.000Z")).toBe(false);
    // No attendance today: the bus phase is still the current state.
    expect(busBadgeIsStale("2026-11-11T15:00:00.000Z", null)).toBe(false);
    expect(busBadgeIsStale(undefined, "2026-11-11T15:30:00.000Z")).toBe(false);
    // Seeded/SQLite-default space-separated timestamps compare correctly.
    expect(busBadgeIsStale("2026-11-11 15:00:00", "2026-11-11T15:30:00.000Z")).toBe(true);
  });

  it("suppresses the phase after a manual check-out but leaves the ledger untouched", async () => {
    await setBusStatus({ childId, accountId: ownerId, type: "on", recordedAt: atUtc(7).toISOString() });
    await setBusStatus({ childId, accountId: ownerId, type: "off", recordedAt: atUtc(7, 30).toISOString() });
    await setBusStatus({ childId, accountId: ownerId, type: "on", recordedAt: atUtc(15).toISOString() });
    // Staff checks the child out by hand instead of waiting for the bus drop-off.
    await registerCheckInOut({ childId, accountId: ownerId, type: "out", at: atUtc(15, 30) });

    const bus = (await busStatusByChild(iid, DAY))[childId];
    expect(String(bus.type)).toBe("on");
    expect(Number(bus.day_count)).toBe(3);

    const row = (await attendanceOn(iid, DAY)).find((r: Row) => String(r.id) === childId)!;
    expect(String(row.last_event)).toBe("out");
    expect(String(row.last_event_at)).toBe(atUtc(15, 30).toISOString());
    expect(busBadgeIsStale(bus.recorded_at, row.last_event_at)).toBe(true);
  });
});
