// Working hours + auto check-out (KID-55 item 3 / KID-58): the per-day
// open/close editor persistence, the early check-in gate (both child and
// staff), and the "3h after closing" auto check-out sweep with actor=system.

// Force UTC so every date manipulation in this suite is deterministic
// regardless of the host timezone.
process.env.TZ = "UTC";

import { beforeEach, describe, expect, it } from "vitest";
import { queryGet, queryAll, queryRun } from "@/lib/db";
import { seedFixture, mustGet } from "../helpers";
import {
  normalizeWorkingHours,
  encodeWorkingHours,
  checkInOpen,
  closeCutoff,
  parseHM,
  AUTO_CHECKOUT_GRACE_HOURS,
  type WorkingWeek,
} from "@/lib/working-hours";
import {
  saveWorkingHours,
  getWorkingHours,
  checkInAllowed,
  systemAccountId,
  runAutoCheckoutSweep,
} from "@/lib/store";

let iid: string;
let childId: string;
let staffId: string;

// Fixed weekday in fixtures. Jan 5 2026 == Monday (getDay() === 1).
const MONDAY = new Date(2026, 0, 5, 12, 0, 0, 0);

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  childId = String((await queryGet("SELECT id FROM child LIMIT 1"))!.id);
  staffId = String((await queryGet("SELECT id FROM staff LIMIT 1"))!.id);
});

describe("working-hours config parse/serialize", () => {
  it("normalizes the legacy seed format into day-of-week keys", () => {
    const raw = { mon: "07:00-18:00", tue: "07:00-18:00" };
    const week = normalizeWorkingHours(JSON.stringify(raw));
    expect(week["1"]).toEqual({ open: "07:00", close: "18:00" });
    expect(week["2"]).toEqual({ open: "07:00", close: "18:00" });
    expect(Object.keys(week)).toHaveLength(2);
  });

  it("reads the current { \"0\": { open, close } } format", () => {
    const week = normalizeWorkingHours(JSON.stringify({ "0": { open: "08:00", close: "16:30" } }));
    expect(week["0"]).toEqual({ open: "08:00", close: "16:30" });
  });

  it("ignores junk, missing values and rejects empty config", () => {
    expect(normalizeWorkingHours(null)).toEqual({});
    expect(normalizeWorkingHours("not json")).toEqual({});
    expect(normalizeWorkingHours('{"bogus": "nope", "3": {}}')).toEqual({});
  });

  it("round-trips through encode", () => {
    const week: WorkingWeek = { "1": { open: "07:00", close: "18:00" }, "5": { open: "09:00", close: "13:00" } };
    expect(encodeWorkingHours(week)).toBe('{"1":{"open":"07:00","close":"18:00"},"5":{"open":"09:00","close":"13:00"}}');
    expect(normalizeWorkingHours(encodeWorkingHours(week))).toEqual(week);
  });

  it("persists to the institute via save/get", async () => {
    const week: WorkingWeek = { "0": { open: "08:30", close: "17:00" } };
    await saveWorkingHours(iid, week);
    expect(await getWorkingHours(iid)).toEqual(week);
  });

  it("saving an empty week clears the config", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    await saveWorkingHours(iid, {});
    expect(await getWorkingHours(iid)).toEqual({});
  });
});

describe("checkInOpen gate", () => {
  it("allows check-in when the center has no working-hours config", () => {
    expect(checkInOpen({}, MONDAY)).toEqual({ allowed: true });
  });

  it("rejects a closed (unconfigured) day", () => {
    const out = checkInOpen({ "6": { open: "07:00", close: "18:00" } }, new Date(2026, 0, 5, 10, 0));
    expect(out.allowed).toBe(false);
    expect(out.error).toMatch(/closed day/i);
  });

  it("rejects check-in before the opening time with the opening time in the error", () => {
    const out = checkInOpen({ "1": { open: "07:00", close: "18:00" } }, new Date(2026, 0, 5, 6, 30));
    expect(out.allowed).toBe(false);
    expect(out.open).toBe("07:00");
    expect(out.error).toMatch(/07:00/);
  });

  it("allows check-in at/after opening and permissively on half days", () => {
    expect(checkInOpen({ "1": { open: "07:00", close: "18:00" } }, new Date(2026, 0, 5, 7, 0)).allowed).toBe(true);
    expect(checkInOpen({ "1": { open: "07:00", close: "18:00" } }, new Date(2026, 0, 5, 12, 0)).allowed).toBe(true);
    expect(checkInOpen({ "1": { open: "07:00", close: "18:00" } }, new Date(2026, 0, 5, 19, 0)).allowed).toBe(true);
  });

  it("checkInAllowed resolves the stored config from the institute", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    expect((await checkInAllowed(iid, new Date(2026, 0, 5, 6, 0))).allowed).toBe(false);
    expect((await checkInAllowed(iid, new Date(2026, 0, 5, 12, 0))).allowed).toBe(true);
  });
});

describe("closeCutoff", () => {
  it("returns undefined without config or on a closed day", () => {
    expect(closeCutoff({}, MONDAY)).toBeUndefined();
    expect(closeCutoff({ "0": { open: "07:00", close: "18:00" } }, MONDAY)).toBeUndefined();
  });

  it("is exactly close + grace hours", () => {
    const cutoff = closeCutoff({ "1": { open: "07:00", close: "18:00" } }, MONDAY)!;
    expect(cutoff.getUTCHours()).toBe(21); // 18:00 + 3h
    expect(AUTO_CHECKOUT_GRACE_HOURS).toBe(3);
  });
});

describe("system account", () => {
  it("creates/hides one system actor and reuses it", async () => {
    const first = await systemAccountId();
    const second = await systemAccountId();
    expect(first).toBe(second);
    const acc = await mustGet("SELECT * FROM account WHERE id = ?", first);
    expect(acc.email).toBe("system@kiddy.local");
    expect(acc.role).toBe("system");
  });
});

describe("auto check-out sweep", () => {
  it("does nothing before the cutoff", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    // Nobody checked in yet today anyway.
    const res = await runAutoCheckoutSweep(iid, new Date(2026, 0, 5, 12, 0));
    expect(res.children).toHaveLength(0);
    expect(res.staff).toHaveLength(0);
    expect(res.reason).toMatch(/before cutoff/);
  });

  it("auto checks out a child still in 3h after closing, actor=system + timestamp", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    // Child checked in at 08:00 (before the 21:00 cutoff).
    const inAt = new Date(2026, 0, 5, 8, 0, 0).toISOString();
    await queryRun(
      "INSERT INTO check_in (id, child_id, account_id, type, is_edit, recorded_at) VALUES (?, ?, ?, 'in', 0, ?)",
      "ci-in-1",
      childId,
      await systemAccountId(),
      inAt
    );

    const now = new Date(2026, 0, 5, 22, 0, 0); // >= 21:00 cutoff
    const res = await runAutoCheckoutSweep(iid, now);
    expect(res.children.map((c) => String(c.id))).toContain(childId);

    const out = await mustGet(
      "SELECT * FROM check_in WHERE child_id = ? AND type = 'out' ORDER BY recorded_at DESC LIMIT 1",
      childId
    );
    expect(String(out.account_id)).toBe(await systemAccountId());
    expect(out.recorded_at).toBe(now.toISOString());
    expect(out.is_edit).toBe(0);
  });

  it("auto checks out staff still checked in 3h after closing", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    const actor = await systemAccountId();
    const inAt = new Date(2026, 0, 5, 8, 0, 0).toISOString();
    await queryRun(
      "INSERT INTO staff_status (id, staff_id, kind, note, created_by_account_id, created_at) VALUES (?, ?, 'checkin', NULL, ?, ?)",
      "ss-in-1",
      staffId,
      actor,
      inAt
    );
    await queryRun(
      "UPDATE staff SET status = 'checkin', status_at = ? WHERE id = ?",
      inAt,
      staffId
    );

    const now = new Date(2026, 0, 5, 22, 0, 0);
    const res = await runAutoCheckoutSweep(iid, now);
    expect(res.staff.map((s) => String(s.id))).toContain(staffId);

    const row = await mustGet("SELECT * FROM staff WHERE id = ?", staffId);
    expect(row.status).toBe("out");
    expect(String(row.status_at)).toBe(now.toISOString());
    const log = await mustGet(
      "SELECT * FROM staff_status WHERE staff_id = ? AND kind = 'out' ORDER BY created_at DESC LIMIT 1",
      staffId
    );
    expect(String(log.created_by_account_id)).toBe(actor);
  });

  it("does not double-run: a second sweep after the fix leaves the rows untouched", async () => {
    await saveWorkingHours(iid, { "1": { open: "07:00", close: "18:00" } });
    const inAt = new Date(2026, 0, 5, 8, 0, 0).toISOString();
    await queryRun(
      "INSERT INTO check_in (id, child_id, account_id, type, is_edit, recorded_at) VALUES (?, ?, ?, 'in', 0, ?)",
      "ci-in-2",
      childId,
      await systemAccountId(),
      inAt
    );
    await queryRun(
      "INSERT INTO staff_status (id, staff_id, kind, note, created_by_account_id, created_at) VALUES (?, ?, 'checkin', NULL, ?, ?)",
      "ss-in-2",
      staffId,
      await systemAccountId(),
      inAt
    );
    await queryRun("UPDATE staff SET status = 'checkin', status_at = ? WHERE id = ?", inAt, staffId);

    const now = new Date(2026, 0, 5, 22, 0, 0);
    await runAutoCheckoutSweep(iid, now);
    const second = await runAutoCheckoutSweep(iid, now);
    expect(second.children).toHaveLength(0);
    expect(second.staff).toHaveLength(0);
    const outs = await queryAll("SELECT * FROM check_in WHERE child_id = ? AND type = 'out'", childId);
    expect(outs).toHaveLength(1);
  });
});

describe("parseHM sanity", () => {
  it("parses HH:MM and rejects out-of-range values", () => {
    expect(parseHM("07:30")).toEqual({ h: 7, m: 30 });
    expect(parseHM(" 09:00 ")).toEqual({ h: 9, m: 0 });
    expect(parseHM("24:00")).toBeUndefined();
    expect(parseHM("07:60")).toBeUndefined();
    expect(parseHM("banana")).toBeUndefined();
  });
});