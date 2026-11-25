process.env.TZ = "UTC";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({ token: "" }));

vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.token) entries.cookie = `kiddy_sess=${mockState.token}`;
    return new Headers(entries);
  },
  cookies: () => ({
    get: (name: string) =>
      name === "kiddy_sess" && mockState.token ? { name, value: mockState.token } : undefined,
    set: () => undefined,
  }),
}));

import { GET } from "@/app/api/export/route";
import { createSessionToken } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let ownerId: string;
let staffId: string;
let staffName: string;

function ownerCookie(): string {
  return createSessionToken({
    accountId: ownerId,
    role: "owner",
    email: "trois4ever+admin@gmail.com",
    emailConfirmed: true,
  } as never);
}

beforeEach(async () => {
  mockState.token = "";
  await seedFixture();
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
  const staff = (await queryGet("SELECT id, full_name FROM staff ORDER BY created_at LIMIT 1"))!;
  staffId = String(staff.id);
  staffName = String(staff.full_name);
  await queryRun("DELETE FROM staff_schedule WHERE staff_id = ?", staffId);
  await queryRun("DELETE FROM staff_status WHERE staff_id = ?", staffId);
});

afterEach(() => {
  mockState.token = "";
});

async function addShift() {
  await queryRun(
    "INSERT INTO staff_schedule (id, staff_id, day_of_week, start_time, end_time, notes) VALUES (?, ?, 1, '08:00', '16:00', '')",
    `sched-${Math.random().toString(36).slice(2)}`,
    staffId
  );
}

async function addStatus(kind: string, at: string) {
  await queryRun(
    "INSERT INTO staff_status (id, staff_id, kind, note, created_by_account_id, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
    `st-${Math.random().toString(36).slice(2)}`,
    staffId,
    kind,
    at
  );
}

async function exportCsv(query: string): Promise<string> {
  const res = await GET(new Request(`http://localhost/api/export?${query}`));
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("text/csv");
  return res.text();
}

describe("KID-2484 staff-hours export", () => {
  it("exports expected, actual and difference for the chosen range", async () => {
    await addShift();
    await addStatus("checkin", "2026-01-05T08:00:00.000Z");
    await addStatus("out", "2026-01-05T14:00:00.000Z");
    mockState.token = ownerCookie();

    const body = await exportCsv(
      "type=staff-hours&from=2026-01-05&to=2026-01-05"
    );
    const [header, ...rows] = body.trim().split("\n");
    expect(header).toContain("expected_hours");
    expect(header).toContain("actual_hours");
    expect(header).toContain("difference_hours");
    const row = rows.find((r) => r.includes(staffName));
    expect(row).toBeTruthy();
    expect(row).toContain('"8.00"');
    expect(row).toContain('"6.00"');
    expect(row).toContain('"-2.00"');
    expect(row).toContain('"short"');
    expect(row).toContain('"2026-01-05"');
  });

  it("marks a scheduled staff member with no check-in as absent with zero actual", async () => {
    await addShift();
    mockState.token = ownerCookie();

    const body = await exportCsv(
      "type=staff-hours&from=2026-01-05&to=2026-01-05"
    );
    const row = body.split("\n").find((r) => r.includes(staffName));
    expect(row).toContain('"8.00"');
    expect(row).toContain('"0.00"');
    expect(row).toContain('"absent"');
  });

  it("uses the filename range and defaults to the center-local day", async () => {
    mockState.token = ownerCookie();
    const res = await GET(
      new Request("http://localhost/api/export?type=staff-hours&from=2026-01-04&to=2026-01-06")
    );
    expect(res.headers.get("Content-Disposition")).toContain(
      "staff-hours-2026-01-04-to-2026-01-06.csv"
    );
  });

  it("requires a session", async () => {
    await expect(
      GET(new Request("http://localhost/api/export?type=staff-hours"))
    ).rejects.toThrow();
  });
});
