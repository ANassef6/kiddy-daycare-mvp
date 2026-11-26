// KID-2503: geofenced check-in/out.
//
// Pinned here:
//   1. haversine distance + accept/reject/missing/malformed/override decisions,
//   2. center settings validate the lat/lng pair and the 150/300/600 radius,
//   3. staff self check-in/out is fenced server-side; an admin acting on
//      ANOTHER staff member bypasses the fence and the row is marked,
//   4. parent child check-in/out is fenced server-side and stores coordinates,
//   5. admin child check-in/out overrides without coordinates,
//   6. the unset fence keeps the historical behavior (no location required).

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  cookies: {} as Record<string, string>,
}));
vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.cookie) entries.cookie = mockState.cookie;
    return new Headers(entries);
  },
  cookies: () => ({
    get: (name: string) =>
      mockState.cookies[name] ? { name, value: mockState.cookies[name] } : undefined,
    set: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
    err.digest = `NEXT_REDIRECT;replace;${url};`;
    throw err;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { createAccount, createSessionToken, staffIdForAccount } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { createStaff, saveWorkingHours } from "@/lib/store";
import {
  DEFAULT_GEOFENCE_RADIUS_M,
  evaluateGeofence,
  geofenceFromInstitute,
  haversineMeters,
  normalizeGeofenceRadius,
  parseLatitude,
} from "@/lib/geofence";
import { seedFixture } from "../helpers";

let iid: string;
let ownerId: string;
let ownerEmail: string;
let ownerStaffId: string;
let childId: string;
let parentId: string;
let parentEmail: string;

const CENTER = { lat: 30.0444, lng: 31.2357, radiusM: 150 as const };
const INSIDE = { lat: 30.0449, lng: 31.2359 };
const OUTSIDE = { lat: 30.06, lng: 31.25 };

function formData(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.set(k, v);
  return form;
}

function sessionFor(accountId: string, role: string, email: string): void {
  const token = createSessionToken({ accountId, role, email, emailConfirmed: true });
  mockState.cookies = { kiddy_sess: token };
  mockState.cookie = `kiddy_sess=${token}`;
}

async function redirectTargetFor(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    throw new Error("expected a redirect");
  } catch (err) {
    const digest = String((err as Error & { digest?: string })?.digest ?? "");
    const match = /NEXT_REDIRECT;replace;([^;]+);/.exec(digest);
    if (match) return match[1];
    throw err;
  }
}

async function setFence(lat: number | null, lng: number | null, radius = 150): Promise<void> {
  await queryRun(
    "UPDATE institute SET premises_lat = ?, premises_lng = ?, geofence_radius_m = ? WHERE id = ?",
    lat,
    lng,
    radius,
    iid
  );
}

async function seed(): Promise<void> {
  mockState.cookie = "";
  mockState.cookies = {};
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  await saveWorkingHours(iid, {});
  const owner = (await queryGet("SELECT id, email FROM account WHERE role = 'owner'"))!;
  ownerId = String(owner.id);
  ownerEmail = String(owner.email);
  ownerStaffId = String(await staffIdForAccount(ownerId));
  const child = (await queryGet("SELECT id FROM child WHERE first_name = 'Ella'"))!;
  childId = String(child.id);
  const parent = (await queryGet("SELECT id, email FROM account WHERE role = 'parent'"))!;
  parentId = String(parent.id);
  parentEmail = String(parent.email);
}

describe("KID-2503 distance + decision math", () => {
  it("haversine returns metres and is symmetric", () => {
    const d1 = haversineMeters(CENTER.lat, CENTER.lng, INSIDE.lat, INSIDE.lng);
    const d2 = haversineMeters(INSIDE.lat, INSIDE.lng, CENTER.lat, CENTER.lng);
    expect(d1).toBeGreaterThan(0);
    expect(d1).toBeLessThan(150);
    expect(d1).toBeCloseTo(d2, 6);
  });

  it("accepts inside the radius and stores the coordinates", () => {
    const decision = evaluateGeofence(CENTER, { ...INSIDE, accuracy: 12 });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.lat).toBe(INSIDE.lat);
      expect(decision.lng).toBe(INSIDE.lng);
      expect(decision.accuracyM).toBe(12);
    }
  });

  it("rejects outside the radius with the distance", () => {
    const decision = evaluateGeofence(CENTER, OUTSIDE);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("outside");
      expect(decision.radiusM).toBe(150);
      expect(decision.distanceM).toBeGreaterThan(150);
    }
  });

  it("distinguishes missing from malformed coordinates", () => {
    expect(evaluateGeofence(CENTER, {})).toMatchObject({ ok: false, code: "missing" });
    expect(evaluateGeofence(CENTER, { lat: "abc", lng: "31" })).toMatchObject({
      ok: false,
      code: "malformed",
    });
    expect(evaluateGeofence(CENTER, { lat: "120", lng: "31" })).toMatchObject({
      ok: false,
      code: "malformed",
    });
  });

  it("lets an override pass without coordinates and keeps valid ones", () => {
    expect(evaluateGeofence(CENTER, {}, { override: true })).toMatchObject({
      ok: true,
      override: true,
    });
    expect(evaluateGeofence(CENTER, INSIDE, { override: true })).toMatchObject({
      ok: true,
      override: true,
      lat: INSIDE.lat,
    });
  });

  it("turns the fence off when either coordinate is unset", () => {
    expect(geofenceFromInstitute({ premises_lat: null, premises_lng: null })).toBeNull();
    expect(geofenceFromInstitute({ premises_lat: 30, premises_lng: null })).toBeNull();
    expect(geofenceFromInstitute({ premises_lat: "bad", premises_lng: 31 })).toBeNull();
  });

  it("normalizes exactly the three radius presets with a 150 m default", () => {
    expect(normalizeGeofenceRadius("150")).toBe(150);
    expect(normalizeGeofenceRadius(300)).toBe(300);
    expect(normalizeGeofenceRadius("600")).toBe(600);
    expect(normalizeGeofenceRadius("200")).toBe(DEFAULT_GEOFENCE_RADIUS_M);
    expect(normalizeGeofenceRadius(undefined)).toBe(DEFAULT_GEOFENCE_RADIUS_M);
    expect(parseLatitude("")).toBeNull();
    expect(parseLatitude("-91")).toBeUndefined();
  });
});

describe("KID-2503 center settings", () => {
  beforeEach(seed);

  it("saves premises coordinates and the radius", async () => {
    sessionFor(ownerId, "owner", ownerEmail);
    const { saveCenterDetailsAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      saveCenterDetailsAction(
        formData({
          premisesLat: "30.0444",
          premisesLng: "31.2357",
          geofenceRadius: "300",
        })
      )
    );
    expect(target).toBe("/portal/settings");
    const inst = await queryGet("SELECT premises_lat, premises_lng, geofence_radius_m FROM institute WHERE id = ?", iid);
    expect(Number(inst!.premises_lat)).toBeCloseTo(30.0444);
    expect(Number(inst!.premises_lng)).toBeCloseTo(31.2357);
    expect(Number(inst!.geofence_radius_m)).toBe(300);
  });

  it("rejects an unsupported radius and writes nothing", async () => {
    sessionFor(ownerId, "owner", ownerEmail);
    const { saveCenterDetailsAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      saveCenterDetailsAction(
        formData({ premisesLat: "30.0444", premisesLng: "31.2357", geofenceRadius: "200" })
      )
    );
    expect(target).toBe("/portal/settings?error=geofence");
    const inst = await queryGet("SELECT premises_lat FROM institute WHERE id = ?", iid);
    expect(inst!.premises_lat).toBeNull();
  });

  it("rejects a partial or invalid coordinate pair", async () => {
    sessionFor(ownerId, "owner", ownerEmail);
    const { saveCenterDetailsAction } = await import("@/lib/actions");
    for (const entries of [
      { premisesLat: "30.0444", premisesLng: "" },
      { premisesLat: "north", premisesLng: "31.2357" },
      { premisesLat: "95", premisesLng: "31.2357" },
    ]) {
      const target = await redirectTargetFor(() => saveCenterDetailsAction(formData(entries)));
      expect(target).toBe("/portal/settings?error=geofence");
    }
  });

  it("clears the fence when both coordinates are left blank", async () => {
    await setFence(CENTER.lat, CENTER.lng);
    sessionFor(ownerId, "owner", ownerEmail);
    const { saveCenterDetailsAction } = await import("@/lib/actions");
    await redirectTargetFor(() =>
      saveCenterDetailsAction(formData({ premisesLat: "", premisesLng: "" }))
    );
    const inst = await queryGet("SELECT premises_lat, premises_lng FROM institute WHERE id = ?", iid);
    expect(inst!.premises_lat).toBeNull();
    expect(inst!.premises_lng).toBeNull();
  });
});

describe("KID-2503 staff check-in/out", () => {
  beforeEach(seed);

  it("rejects a self check-in outside the premises", async () => {
    await setFence(CENTER.lat, CENTER.lng);
    sessionFor(ownerId, "owner", ownerEmail);
    const { logStaffStatusAction } = await import("@/lib/actions");
    const res = (await logStaffStatusAction(
      formData({
        staffId: ownerStaffId,
        kind: "checkin",
        lat: String(OUTSIDE.lat),
        lng: String(OUTSIDE.lng),
      })
    )) as { error?: string };
    expect(res.error).toMatch(/Move within 150 m/);
    expect(await queryGet("SELECT id FROM staff_status WHERE staff_id = ?", ownerStaffId)).toBeUndefined();
  });

  it("accepts a self check-in inside the premises and stores coordinates", async () => {
    await setFence(CENTER.lat, CENTER.lng);
    sessionFor(ownerId, "owner", ownerEmail);
    const { logStaffStatusAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      logStaffStatusAction(
        formData({
          staffId: ownerStaffId,
          kind: "checkin",
          lat: String(INSIDE.lat),
          lng: String(INSIDE.lng),
          accuracy: "8",
        })
      )
    );
    expect(target).toBe(`/portal/staff/${ownerStaffId}`);
    const row = await queryGet("SELECT * FROM staff_status WHERE staff_id = ?", ownerStaffId);
    expect(Number(row!.lat)).toBeCloseTo(INSIDE.lat);
    expect(Number(row!.lng)).toBeCloseTo(INSIDE.lng);
    expect(Number(row!.accuracy_m)).toBe(8);
    expect(Number(row!.geofence_override)).toBe(0);
  });

  it("rejects a self check-in with no coordinates while fenced", async () => {
    await setFence(CENTER.lat, CENTER.lng);
    sessionFor(ownerId, "owner", ownerEmail);
    const { logStaffStatusAction } = await import("@/lib/actions");
    const res = (await logStaffStatusAction(
      formData({ staffId: ownerStaffId, kind: "checkin" })
    )) as { error?: string };
    expect(res.error).toMatch(/Enable location access/);
  });

  it("lets an admin override another staff member and records who did it", async () => {
    await setFence(CENTER.lat, CENTER.lng);
    const targetStaff = await createStaff({ instituteId: iid, fullName: "Target Staff", role: "carer" });
    sessionFor(ownerId, "owner", ownerEmail);
    const { logStaffStatusAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      logStaffStatusAction(
        formData({ staffId: String(targetStaff.id), kind: "checkin", note: "stuck at gate" })
      )
    );
    expect(target).toBe(`/portal/staff/${String(targetStaff.id)}`);
    const row = await queryGet(
      `SELECT ss.*, a.full_name AS recorded_by_name FROM staff_status ss
       LEFT JOIN account a ON a.id = ss.created_by_account_id
       WHERE ss.staff_id = ?`,
      String(targetStaff.id)
    );
    expect(Number(row!.geofence_override)).toBe(1);
    expect(row!.recorded_by_name).toBe("Nassef");
  });

  it("does not require location when the fence is unset", async () => {
    sessionFor(ownerId, "owner", ownerEmail);
    const { logStaffStatusAction } = await import("@/lib/actions");
    await redirectTargetFor(() =>
      logStaffStatusAction(formData({ staffId: ownerStaffId, kind: "checkin" }))
    );
    const row = await queryGet("SELECT * FROM staff_status WHERE staff_id = ?", ownerStaffId);
    expect(row).toBeTruthy();
    expect(row!.lat).toBeNull();
  });

  it("leaves non-check-in statuses unfenced", async () => {
    await setFence(CENTER.lat, CENTER.lng);
    sessionFor(ownerId, "owner", ownerEmail);
    const { logStaffStatusAction } = await import("@/lib/actions");
    await redirectTargetFor(() =>
      logStaffStatusAction(formData({ staffId: ownerStaffId, kind: "sick" }))
    );
    const row = await queryGet("SELECT * FROM staff_status WHERE staff_id = ?", ownerStaffId);
    expect(row!.kind).toBe("sick");
    expect(Number(row!.geofence_override)).toBe(0);
  });

  it("fences a non-admin staff member checking themselves in", async () => {
    await setFence(CENTER.lat, CENTER.lng);
    const staff = await createStaff({ instituteId: iid, fullName: "Carer One", role: "carer" });
    const account = await createAccount({
      email: "carer-one@test.local",
      password: "secret1",
      fullName: "Carer One",
      role: "staff",
    });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), account.id);
    sessionFor(String(account.id), "staff", "carer-one@test.local");
    const { logStaffStatusAction } = await import("@/lib/actions");
    const res = (await logStaffStatusAction(
      formData({
        staffId: String(staff.id),
        kind: "checkin",
        lat: String(OUTSIDE.lat),
        lng: String(OUTSIDE.lng),
      })
    )) as { error?: string };
    expect(res.error).toMatch(/Move within 150 m/);
  });
});

describe("KID-2503 parent child check-in/out", () => {
  beforeEach(seed);

  it("rejects a parent check-in outside the radius", async () => {
    await setFence(CENTER.lat, CENTER.lng);
    sessionFor(parentId, "parent", parentEmail);
    const { checkInOutAction } = await import("@/lib/actions");
    const res = (await checkInOutAction(
      formData({
        childId,
        type: "in",
        lat: String(OUTSIDE.lat),
        lng: String(OUTSIDE.lng),
      })
    )) as { error?: string };
    expect(res.error).toMatch(/Move within 150 m/);
    expect(await queryGet("SELECT id FROM check_in WHERE child_id = ?", childId)).toBeUndefined();
  });

  it("accepts an inside parent check-in and stores coordinates", async () => {
    await setFence(CENTER.lat, CENTER.lng);
    sessionFor(parentId, "parent", parentEmail);
    const { checkInOutAction } = await import("@/lib/actions");
    await redirectTargetFor(() =>
      checkInOutAction(
        formData({
          childId,
          type: "in",
          lat: String(INSIDE.lat),
          lng: String(INSIDE.lng),
          accuracy: "15",
        })
      )
    );
    const row = await queryGet(
      "SELECT * FROM check_in WHERE child_id = ? ORDER BY recorded_at DESC LIMIT 1",
      childId
    );
    expect(Number(row!.lat)).toBeCloseTo(INSIDE.lat);
    expect(Number(row!.lng)).toBeCloseTo(INSIDE.lng);
    expect(Number(row!.accuracy_m)).toBe(15);
    expect(Number(row!.geofence_override)).toBe(0);
  });

  it("rejects a parent check-in with no coordinates", async () => {
    await setFence(CENTER.lat, CENTER.lng);
    sessionFor(parentId, "parent", parentEmail);
    const { checkInOutAction } = await import("@/lib/actions");
    const res = (await checkInOutAction(formData({ childId, type: "in" }))) as {
      error?: string;
    };
    expect(res.error).toMatch(/Enable location access/);
  });

  it("lets an admin override without coordinates and marks the row", async () => {
    await setFence(CENTER.lat, CENTER.lng);
    sessionFor(ownerId, "owner", ownerEmail);
    const { checkInOutAction } = await import("@/lib/actions");
    await redirectTargetFor(() => checkInOutAction(formData({ childId, type: "in" })));
    const row = await queryGet(
      "SELECT * FROM check_in WHERE child_id = ? ORDER BY recorded_at DESC LIMIT 1",
      childId
    );
    expect(Number(row!.geofence_override)).toBe(1);
    expect(row!.lat).toBeNull();
  });

  it("keeps the historical behavior when the fence is unset", async () => {
    sessionFor(parentId, "parent", parentEmail);
    const { checkInOutAction } = await import("@/lib/actions");
    await redirectTargetFor(() => checkInOutAction(formData({ childId, type: "in" })));
    const row = await queryGet(
      "SELECT * FROM check_in WHERE child_id = ? ORDER BY recorded_at DESC LIMIT 1",
      childId
    );
    expect(row).toBeTruthy();
    expect(Number(row!.geofence_override)).toBe(0);
  });
});
