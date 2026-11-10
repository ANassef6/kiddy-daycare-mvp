// KID-1371: pickup-time boundary rules (P2 gap from KID-1330).
//
// KID-1330 could not prove that the pickup loop rejects past times and
// cross-day values. The boundaries now live server-side (lib/pickup-policy.ts,
// wired into lib/actions.ts checkInOutAction and the mobile check-in route):
//
//   - same-day only (cross-day values rejected),
//   - past times rejected,
//   - within the center's working hours, on an open day,
//   - one entry per child per day (same-type re-registration updates today's
//     entry; the alternating cancel/update transition stays intact),
//   - valid registrations land with the exact validated timestamp.
//
// Every DB/route test runs on a FAKE clock pinned inside the seeded center's
// working week (a Wednesday, 07:00–18:00 Mon–Fri) so results can never drift
// with the time-of-day the suite happens to run at (the KID-1330 env-flake).

process.env.TZ = "UTC";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryAll, queryGet } from "@/lib/db";
import { linkFamily } from "@/lib/store";
import { evaluatePickupTime, parsePickupAtCandidate } from "@/lib/pickup-policy";
import { seedFixture } from "../helpers";

const SESSION_COOKIE = "kiddy_sess";
const sessionCookie = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (name === SESSION_COOKIE ? { value: sessionCookie.value } : undefined),
    set: () => undefined,
  }),
  headers: () =>
    new Headers(sessionCookie.value ? { cookie: `${SESSION_COOKIE}=${sessionCookie.value}` } : undefined),
}));

// The seeded demo center works Mon-Fri 07:00-18:00 (local = UTC under TZ=UTC).
const WEDNESDAY_MORNING = new Date("2026-11-11T10:00:00.000Z"); // Wednesday 10:00
const WEEK_FIVE_DAYS = {
  mon: "07:00-18:00",
  tue: "07:00-18:00",
  wed: "07:00-18:00",
  thu: "07:00-18:00",
  fri: "07:00-18:00",
};

// ---------- Pure policy matrix ----------

describe("KID-1371 evaluatePickupTime — the full boundary matrix (pure)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(WEDNESDAY_MORNING);
  });
  afterEach(() => vi.useRealTimers());

  function week(): Record<string, { open: string; close: string }> {
    return { "1": { open: "07:00", close: "18:00" }, "3": { open: "07:00", close: "18:00" } };
  }

  it("accepts the server clock (no at) when inside working hours on an open day", () => {
    const d = evaluatePickupTime({ type: "out", now: new Date(), week: week() });
    expect(d).toEqual({ ok: true, at: new Date(WEDNESDAY_MORNING) });
  });

  it("accepts a supplied same-day time inside working hours", () => {
    const d = evaluatePickupTime({
      type: "out",
      now: new Date(),
      week: week(),
      at: "2026-11-11T15:30",
    });
    expect(d).toEqual({ ok: true, at: new Date("2026-11-11T15:30:00.000") });
  });

  it("accepts an ISO instant with an offset and normalizes it", () => {
    const d = evaluatePickupTime({
      type: "in",
      now: new Date(),
      week: week(),
      at: "2026-11-11T12:30:00.000Z",
    });
    expect(d).toEqual({ ok: true, at: new Date("2026-11-11T12:30:00.000Z") });
  });

  it("rejects a past time (supplied)", () => {
    const d = evaluatePickupTime({
      type: "out",
      now: new Date(),
      week: week(),
      at: "2026-11-11T09:00:00",
    });
    expect(d.ok).toBe(false);
    expect((d as { code: string }).code).toBe("past");
  });

  it("rejects a cross-day value from yesterday", () => {
    const d = evaluatePickupTime({
      type: "out",
      now: new Date(),
      week: week(),
      at: "2026-11-10T15:30:00",
    });
    expect(d.ok).toBe(false);
    expect((d as { code: string }).code).toBe("cross_day");
  });

  it("rejects a cross-day value from tomorrow (a real next-UTC-day moment)", () => {
    const d = evaluatePickupTime({
      type: "out",
      now: new Date(),
      week: week(),
      at: "2026-11-12T08:00:00Z",
    });
    expect(d.ok).toBe(false);
    expect((d as { code: string }).code).toBe("cross_day");
  });

  it("rejects a time before opening (clock at 06:00 so the 'past' rule cannot shadow it)", () => {
    vi.setSystemTime(new Date("2026-11-11T06:00:00.000Z"));
    const d = evaluatePickupTime({
      type: "out",
      now: new Date(),
      week: week(),
      at: "2026-11-11T06:30:00",
    });
    expect(d.ok).toBe(false);
    expect((d as { code: string }).code).toBe("outside_hours");
  });

  it("rule precedence: a past value outranks the hours rule (refused either way)", () => {
    const d = evaluatePickupTime({
      type: "out",
      now: new Date(),
      week: week(),
      at: "2026-11-11T06:30:00",
    });
    expect(d.ok).toBe(false);
    expect((d as { code: string }).code).toBe("past");
  });

  it("rejects a time after closing (>= 18:00)", () => {
    const d = evaluatePickupTime({
      type: "out",
      now: new Date(),
      week: week(),
      at: "2026-11-11T18:00:00",
    });
    expect(d.ok).toBe(false);
    expect((d as { code: string }).code).toBe("outside_hours");
  });

  it("rejects a SUPPLIED same-day Sunday time on the closed-day clock", () => {
    vi.setSystemTime(new Date("2026-11-08T10:00:00.000Z")); // Sunday
    const d = evaluatePickupTime({
      type: "out",
      now: new Date(),
      week: week(),
      at: "2026-11-08T15:00:00",
    });
    expect(d.ok).toBe(false);
    expect((d as { code: string }).code).toBe("closed_day");
  });

  it("no candidate on a closed day records the live event — a real out-of-hours/else-week moment is the server clock, not a chosen time", () => {
    vi.setSystemTime(new Date("2026-11-08T10:00:00.000Z")); // Sunday
    const d = evaluatePickupTime({ type: "out", now: new Date(), week: week() });
    expect(d).toEqual({ ok: true, at: new Date("2026-11-08T10:00:00.000Z") });
    // And on the web surface type "in" keeps its pre-existing KID-58 gate;
    // the mobile route keeps equal semantics by recording the live clock.
  });

  it("rejects a supplied malformed blob (fail closed, no silent ignore)", () => {
    const d = evaluatePickupTime({
      type: "out",
      now: new Date(),
      week: week(),
      at: "yesterday-ish",
    });
    expect(d.ok).toBe(false);
    expect((d as { code: string }).code).toBe("invalid_time");
  });

  it("an empty/missing at field is 'none' — the server clock is used", () => {
    expect(parsePickupAtCandidate(undefined).state).toBe("none");
    expect(parsePickupAtCandidate("").state).toBe("none");
    expect(parsePickupAtCandidate("   ").state).toBe("none");
    expect(parsePickupAtCandidate("garbage").state).toBe("invalid");
  });

  it("with no working-hours configured the historical no-restriction behavior holds", () => {
    vi.setSystemTime(new Date("2026-11-08T02:00:00.000Z"));
    const d = evaluatePickupTime({ type: "out", now: new Date(), week: {} });
    expect(d).toEqual({ ok: true, at: new Date("2026-11-08T02:00:00.000Z") });
  });
});

// ---------- Web action checks them server-side ----------

type NextError = { digest?: unknown; message: string };

async function digest(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const digest = String((err as NextError)?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw err;
  }
  throw new Error("expected the action to redirect");
}

describe("KID-1371 web checkInOutAction enforces the boundaries", () => {
  let childId: string;
  let instituteId: string;

  beforeEach(async () => {
    await seedFixture();
    childId = String((await queryGet("SELECT id FROM child WHERE first_name = 'Ella'"))!.id);
    instituteId = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(WEDNESDAY_MORNING);
  });

  afterEach(() => {
    sessionCookie.value = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function pickupSession(): Promise<string> {
    const acc = await createAccount({
      email: `kid1371-pickup-${Math.random().toString(36).slice(2, 8)}@example.test`,
      password: "x",
      fullName: "Pia Pickup",
      role: "parent",
    });
    await linkFamily(String(acc.id), childId, "pickup");
    sessionCookie.value = createSessionToken({
      accountId: String(acc.id),
      role: "parent",
      email: String(acc.email),
      emailConfirmed: true,
    } as never);
    return String(acc.id);
  }

  it("a valid 'now' registration lands (redirect + exactly one row at the clock time)", async () => {
    const accountId = await pickupSession();
    const { checkInOutAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "out");
    expect(await digest(() => checkInOutAction(fd))).toBe(`/child/${childId}`);
    const rows = await queryAll(
      "SELECT id, account_id, recorded_at, type FROM check_in WHERE child_id = ? AND type = 'out'",
      childId
    );
    expect(rows.length).toBe(1);
    expect(String(rows[0].account_id)).toBe(accountId);
    expect(String(rows[0].recorded_at)).toBe("2026-11-11T10:00:00.000Z");
  });

  it("a supplied valid pickup time records exactly that moment", async () => {
    await pickupSession();
    const { checkInOutAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "out");
    fd.set("pickupAt", "2026-11-11T15:45");
    expect(await digest(() => checkInOutAction(fd))).toBe(`/child/${childId}`);
    const row = await queryGet(
      "SELECT recorded_at FROM check_in WHERE child_id = ? AND type = 'out'",
      childId
    );
    expect(String(row!.recorded_at)).toBe("2026-11-11T15:45:00.000Z");
  });

  it("rejects a PAST pickup time — nothing is written", async () => {
    await pickupSession();
    const { checkInOutAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "out");
    fd.set("pickupAt", "2026-11-11T08:30"); // before the pinned clock 10:00
    const res = (await checkInOutAction(fd)) as { error?: string } | undefined;
    expect(res?.error).toContain("past");
    expect(await queryAll("SELECT id FROM check_in WHERE child_id = ? AND type = 'out'", childId)).toEqual([]);
  });

  it("rejects a CROSS-DAY (yesterday) pickup time — nothing is written", async () => {
    await pickupSession();
    const { checkInOutAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "out");
    fd.set("pickupAt", "2026-11-10T15:30");
    const res = (await checkInOutAction(fd)) as { error?: string } | undefined;
    expect(res?.error).toContain("today");
    expect(await queryAll("SELECT id FROM check_in WHERE child_id = ? AND type = 'out'", childId)).toEqual([]);
  });

  it("rejects a time OUTSIDE working hours (after close) — nothing is written", async () => {
    await pickupSession();
    const { checkInOutAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "out");
    fd.set("pickupAt", "2026-11-11T19:30");
    const res = (await checkInOutAction(fd)) as { error?: string } | undefined;
    expect(res?.error).toContain("closed after 18:00");
    expect(await queryAll("SELECT id FROM check_in WHERE child_id = ? AND type = 'out'", childId)).toEqual([]);
  });

  it("rejects the registration on a CLOSED day (a same-day Sunday candidate fails closed-day)", async () => {
    await pickupSession();
    const { checkInOutAction } = await import("@/lib/actions");
    // Same-day candidate on a real Sunday clock: the closed-day branch.
    vi.setSystemTime(new Date("2026-11-08T10:00:00.000Z"));
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "out");
    fd.set("pickupAt", "2026-11-08T15:00:00");
    const res = (await checkInOutAction(fd)) as { error?: string } | undefined;
    expect(res?.error).toContain("closed day");
    expect(await queryAll("SELECT id FROM check_in WHERE child_id = ?", childId)).toEqual([]);
  });

  it("a duplicate same-type registration on the SAME day updates today's entry (one entry per child per day)", async () => {
    await pickupSession();
    const { checkInOutAction } = await import("@/lib/actions");
    function fdOut(at?: string) {
      const fd = new FormData();
      fd.set("childId", childId);
      fd.set("type", "out");
      if (at) fd.set("pickupAt", at);
      return fd;
    }
    expect(await digest(() => checkInOutAction(fdOut()))).toBe(`/child/${childId}`);
    // Same clock, double submission → still exactly one row.
    expect(await digest(() => checkInOutAction(fdOut()))).toBe(`/child/${childId}`);
    expect(await queryAll("SELECT id FROM check_in WHERE child_id = ? AND type = 'out'", childId)).toHaveLength(1);

    // A later same-day re-registration updates the SAME row in place.
    expect(await digest(() => checkInOutAction(fdOut("2026-11-11T15:00")))).toBe(`/child/${childId}`);
    const rows = await queryAll(
      "SELECT recorded_at, is_edit FROM check_in WHERE child_id = ? AND type = 'out'",
      childId
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0].recorded_at).startsWith("2026-11-11T15:00")).toBe(true);
    expect(Number(rows[0].is_edit)).toBe(1);
  });

  it("cancel/update keeps working: 'in' after the pickup inserts a fresh arrival event and preserves the pickup history", async () => {
    await pickupSession();
    const { checkInOutAction } = await import("@/lib/actions");
    const out = () => {
      const fd = new FormData();
      fd.set("childId", childId);
      fd.set("type", "out");
      fd.set("pickupAt", "2026-11-11T15:00");
      return fd;
    };
    expect(await digest(() => checkInOutAction(out()))).toBe(`/child/${childId}`);
    // Cancel the pickup registration by moving the child back to checked-in.
    vi.setSystemTime(new Date("2026-11-11T15:20:00.000Z"));
    const backIn = new FormData();
    backIn.set("childId", childId);
    backIn.set("type", "in");
    expect(await digest(() => checkInOutAction(backIn))).toBe(`/child/${childId}`);

    const rows = await queryAll(
      "SELECT type, is_edit, recorded_at FROM check_in WHERE child_id = ? ORDER BY recorded_at",
      childId
    );
    // Exactly the two role-step events: the pickup registration (15:00,
    // unchanged) plus the fresh arrival for the canceled pickup (15:20) —
    // the cancel never overwrote the pickup row and no duplicate stacked.
    expect(rows.length).toBe(2);
    expect(Number(rows[0].is_edit)).toBe(0);
    expect(String(rows[0].recorded_at)).toBe("2026-11-11T15:00:00.000Z");
    expect(String(rows[1].recorded_at)).toBe("2026-11-11T15:20:00.000Z");

    // todayStatus derives the loop from the ledger: the child is back IN,
    // so another pickup registration may follow (update/cancel cycle intact).
    const { todayStatus } = await import("@/lib/store");
    const status = await todayStatus(childId);
    expect(String(status.lastEvent!.type)).toBe("in");
    expect(status.checkedOut).toBeDefined();
  });

  it("no staff approval is needed: the pickup registers without any institute session", async () => {
    const accountId = await pickupSession();
    const { checkInOutAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("childId", childId);
    fd.set("type", "out");
    expect(await digest(() => checkInOutAction(fd))).toBe(`/child/${childId}`);
    const row = await queryGet("SELECT account_id FROM check_in WHERE child_id = ? AND type = 'out'", childId);
    expect(String(row!.account_id)).toBe(accountId);
  });
});

// ---------- Mobile route checks them server-side ----------

import { NextRequest } from "next/server";

describe("KID-1371 mobile check-in route enforces the boundaries", () => {
  let childId: string;

  beforeEach(async () => {
    await seedFixture();
    childId = String((await queryGet("SELECT id FROM child WHERE first_name = 'Ella'"))!.id);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(WEDNESDAY_MORNING);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function pickupToken(): Promise<string> {
    const acc = await createAccount({
      email: `kid1371-mob-${Math.random().toString(36).slice(2, 8)}@example.test`,
      password: "x",
      fullName: "Mia Mobile Pickup",
      role: "parent",
    });
    await linkFamily(String(acc.id), childId, "pickup");
    return createSessionToken({
      accountId: String(acc.id),
      role: "parent",
      email: String(acc.email),
      emailConfirmed: true,
    } as never);
  }

  function request(token: string, body: unknown): NextRequest {
    return new NextRequest(`http://localhost/api/mobile/children/${childId}/check-in`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("422 with a clear error for a past time; nothing is written", async () => {
    const token = await pickupToken();
    const { POST } = await import("@/app/api/mobile/children/[id]/check-in/route");
    const res = await POST(request(token, { type: "out", at: "2026-11-11T08:00:00Z" }), {
      params: Promise.resolve({ id: childId }),
    });
    expect(res.status).toBe(422);
    expect(String((await res.json() as { error: string }).error)).toContain("past");
    expect(await queryAll("SELECT id FROM check_in WHERE child_id = ? AND type = 'out'", childId)).toEqual([]);
  });

  it("422 for a cross-day (yesterday) time — even though that moment would be inside hours", async () => {
    const token = await pickupToken();
    const { POST } = await import("@/app/api/mobile/children/[id]/check-in/route");
    const res = await POST(request(token, { type: "out", at: "2026-11-10T15:00:00Z" }), {
      params: Promise.resolve({ id: childId }),
    });
    expect(res.status).toBe(422);
    expect(String((await res.json() as { error: string }).error)).toContain("today");
    expect(await queryAll("SELECT id FROM check_in WHERE child_id = ? AND type = 'out'", childId)).toEqual([]);
  });

  it("422 for a time outside working hours and 422 on the closed-day clock", async () => {
    const token = await pickupToken();
    const { POST } = await import("@/app/api/mobile/children/[id]/check-in/route");
    const afterHours = await POST(request(token, { type: "out", at: "2026-11-11T20:00:00Z" }), {
      params: Promise.resolve({ id: childId }),
    });
    expect(afterHours.status).toBe(422);
    expect(String((await afterHours.json() as { error: string }).error)).toContain("closed after 18:00");

    // Closed day (Sunday clock): a same-day candidate registration is
    // refused outright.
    vi.setSystemTime(new Date("2026-11-08T10:00:00.000Z"));
    const closedDay = await POST(request(token, { type: "out", at: "2026-11-08T15:00:00Z" }), {
      params: Promise.resolve({ id: childId }),
    });
    expect(closedDay.status).toBe(422);
    expect(String((await closedDay.json() as { error: string }).error)).toContain("closed day");
    await expect(queryAll("SELECT id FROM check_in WHERE child_id = ?", childId)).resolves.toEqual([]);
  });

  it("a malformed at blob is a 422 (fail closed), not a silent ignore", async () => {
    const token = await pickupToken();
    const { POST } = await import("@/app/api/mobile/children/[id]/check-in/route");
    const res = await POST(request(token, { type: "out", at: "right after school" }), {
      params: Promise.resolve({ id: childId }),
    });
    expect(res.status).toBe(422);
    expect(await queryAll("SELECT id FROM check_in WHERE child_id = ?", childId)).toEqual([]);
  });

  it("a valid registration lands 200 with the supplied moment, and a retry updates the same row", async () => {
    const token = await pickupToken();
    const { POST } = await import("@/app/api/mobile/children/[id]/check-in/route");
    const res = await POST(request(token, { type: "out", at: "2026-11-11T15:00:00Z" }), {
      params: Promise.resolve({ id: childId }),
    });
    expect(res.status).toBe(200);
    expect(await queryAll("SELECT id FROM check_in WHERE child_id = ? AND type = 'out'", childId)).toHaveLength(1);

    // Mobile retry at a later clock: same day, same entry updated in place.
    vi.setSystemTime(new Date("2026-11-11T14:30:00.000Z"));
    const retry = await POST(request(token, { type: "out", at: "2026-11-11T15:30:00Z" }), {
      params: Promise.resolve({ id: childId }),
    });
    expect(retry.status).toBe(200);
    const rows = await queryAll(
      "SELECT recorded_at, is_edit FROM check_in WHERE child_id = ? AND type = 'out'",
      childId
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0].recorded_at)).toBe("2026-11-11T15:30:00.000Z");
  });
});
