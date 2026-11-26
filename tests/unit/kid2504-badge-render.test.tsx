// KID-2504 acceptance at the surface level (real server-page renders against
// the seeded SQLite fixture):
//   - the roster and the parent /child page reflect repeated same-day pairs,
//     including an admin check-in after an earlier check-out, and
//   - a manual check-out after the bus ledger's latest "on" event suppresses
//     the stale "On bus" current-state badge on both surfaces, while a genuine
//     bus phase still shows before the manual write.
//
// The fake clock only fakes `Date` (toFake: ["Date"]) so awaited DB calls keep
// running on real timers.

process.env.TZ = "UTC";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  host: "" as string,
}));
vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.cookie) entries.cookie = mockState.cookie;
    if (mockState.host) entries.host = mockState.host;
    return new Headers(entries);
  },
  cookies: () => ({ get: () => undefined, set: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT: ${url}`), { digest: `NEXT_REDIRECT;replace;${url};` });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
// Client-only controls need no app-router context in a server render.
vi.mock("@/components/AttendanceCheckIn", () => ({
  AttendanceCheckIn: () => <span>check-in-control</span>,
}));
vi.mock("@/components/BusStatusButtons", () => ({
  BusStatusButtons: () => <span>bus-control</span>,
}));

import { createSessionToken } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";
import { registerCheckInOut, setBusStatus } from "@/lib/store";

const DAY = "2026-11-11";
// 16:00 UTC on the attendance day: after the afternoon bus departure, before
// the 18:00 close (so the end-of-day sweeps do not fire during the render).
const NOW = "2026-11-11T16:00:00.000Z";

let ownerId = "";
let childId = "";
let childFirst = "";
let childLast = "";

function at(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 10, 11, hour, minute, 0));
}

function ownerCookie(): string {
  const token = createSessionToken({
    accountId: ownerId,
    role: "owner",
    email: "owner@example.test",
    emailConfirmed: true,
  });
  return `kiddy_sess=${encodeURIComponent(token)}`;
}

async function renderAttendance(): Promise<string> {
  mockState.cookie = ownerCookie();
  mockState.host = "daycare.test";
  const page = await import("@/app/portal/attendance/page");
  return renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ day: DAY }) }));
}

async function renderParentChild(): Promise<string> {
  mockState.cookie = ownerCookie();
  mockState.host = "daycare.test";
  const page = await import("@/app/child/[id]/page");
  return renderToStaticMarkup(
    await page.default({ params: Promise.resolve({ id: childId }), searchParams: Promise.resolve({}) })
  );
}

function rowFor(html: string): string {
  const start = html.indexOf(`${childFirst} ${childLast}`);
  if (start < 0) return "";
  const end = html.indexOf("</tr>", start);
  return html.slice(start, end < 0 ? undefined : end);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  await seedFixture();
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
  const child = await queryGet("SELECT id, first_name, last_name FROM child ORDER BY id LIMIT 1");
  childId = String(child!.id);
  childFirst = String(child!.first_name);
  childLast = String(child!.last_name);
});

afterEach(() => {
  vi.useRealTimers();
  mockState.cookie = "";
  mockState.host = "";
});

describe("KID-2504 roster surfaces", () => {
  it("shows checked in after an admin check-in that follows an earlier check-out", async () => {
    await registerCheckInOut({ childId, accountId: ownerId, type: "in", at: at(8) });
    await registerCheckInOut({ childId, accountId: ownerId, type: "out", at: at(12) });
    await registerCheckInOut({ childId, accountId: ownerId, type: "in", at: at(13) });

    const html = await renderAttendance();
    const row = rowFor(html);
    expect(row).toContain("Checked in");
    expect(row).not.toContain("Checked out");
  });

  it("hides the stale afternoon On-bus badge after a manual check-out", async () => {
    await setBusStatus({ childId, accountId: ownerId, type: "on", recordedAt: at(7).toISOString() });
    await setBusStatus({ childId, accountId: ownerId, type: "off", recordedAt: at(7, 30).toISOString() });
    await setBusStatus({ childId, accountId: ownerId, type: "on", recordedAt: at(15).toISOString() });

    const before = rowFor(await renderAttendance());
    expect(before).toContain("On bus (home)");

    // Staff check the child out by hand before the bus drop-off.
    await registerCheckInOut({ childId, accountId: ownerId, type: "out", at: at(15, 30) });

    const after = rowFor(await renderAttendance());
    expect(after).not.toContain("On bus (home)");
    expect(after).not.toContain("On bus (to daycare)");
    expect(after).toContain("Checked out");
  });
});

describe("KID-2504 parent /child surface", () => {
  it("reflects the admin check-in even when an earlier check-out exists today", async () => {
    await registerCheckInOut({ childId, accountId: ownerId, type: "in", at: at(8) });
    await registerCheckInOut({ childId, accountId: ownerId, type: "out", at: at(12) });
    await registerCheckInOut({ childId, accountId: ownerId, type: "in", at: at(13) });

    const html = await renderParentChild();
    expect(html).toContain("Checked in");
    expect(html).not.toContain("Not checked in yet");
    expect(html).toContain("Check out");
  });

  it("hides the stale afternoon On-bus badge after a manual check-out", async () => {
    await setBusStatus({ childId, accountId: ownerId, type: "on", recordedAt: at(7).toISOString() });
    await setBusStatus({ childId, accountId: ownerId, type: "off", recordedAt: at(7, 30).toISOString() });
    await setBusStatus({ childId, accountId: ownerId, type: "on", recordedAt: at(15).toISOString() });

    const before = await renderParentChild();
    expect(before).toContain("On the bus — on the way home");

    await registerCheckInOut({ childId, accountId: ownerId, type: "out", at: at(15, 30) });

    const after = await renderParentChild();
    expect(after).not.toContain("On the bus — on the way home");
    expect(after).not.toContain("On the bus — on the way to the daycare");
  });
});
