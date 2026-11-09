// KID-1328 (KID-1312 finding, Critical BOLA/IDOR): `isChildInScope` returned
// true for any admin/owner BEFORE checking `child.institute_id`, so the
// admin/owner early return let the owner/admin of tenant B authorize the
// raw child id of tenant A. Every portal child page
// (/portal/children/[id]{,/billing,/development}) and every assertChildInScope
// write action trusted that helper.
//
// Pinned here, each test failing on the pre-fix code:
//   1. isChildInScope unit rule: a foreign-tenant child (or a missing one, or
//      an empty request tenant) is refused even for owner/admin; same-tenant
//      owner/admin pass and staff stay classroom-scoped.
//   2. Portal child profile/billing/development pages 404 a foreign child for
//      owner AND admin of the other tenant, on each tenant's OWN host (the
//      real attack path: the request tenant resolves, so this is pure BOLA,
//      not the cross-tenant-session empty case).
//   3. Same-tenant owner/admin still render their own child (no over-tighten),
//      parent list -> profile for both tenants stays green.
//   4. Teacher/carer remain classroom-scoped on their own tenant.
//   5. Anonymous gets redirected to /login.
//   6. A write action through assertChildInScope (updateChildDetailsAction)
//      refuses a foreign child with the scope redirect instead of writing.
//
// Harness: kid472/kid254 mocked-request-scope pattern — SQLite fixture, no
// server; pages rendered with renderToStaticMarkup; next/navigation
// notFound()/redirect() throw the Next sentinels so a refusal fails loudly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  host: "" as string,
  cookies: {} as Record<string, string>,
}));
vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.cookie) entries.cookie = mockState.cookie;
    if (mockState.host) entries.host = mockState.host;
    return new Headers(entries);
  },
  cookies: () => ({
    get: (name: string) => (mockState.cookies[name] ? { name, value: mockState.cookies[name] } : undefined),
    set: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
    err.digest = `NEXT_REDIRECT;replace;${url};`;
    throw err;
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import * as store from "@/lib/store";
import { createSessionToken, createAccount } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

const APEX = "daycare.test";
const SUNSHINE_HOST = `sunshine-daycare.${APEX}`;
const MAPLE_HOST = `mapletree.${APEX}`;

let sunshineIid: string;
let sunshineOwnerAcc: string;
let sunshineOwnerEmail: string;
let sunshineAdminAcc: string;
let roomA: string;
let roomB: string;
let childA: string;
let childB: string;
let mapleIid: string;
let mapleOwnerAcc: string;
let mapleAdminAcc: string;
let mapleChildId: string;

function sessionCookieFor(accountId: string, role: string, email: string): void {
  const token = createSessionToken({ accountId, role, email, emailConfirmed: true });
  mockState.cookies = { kiddy_sess: token };
  mockState.cookie = `kiddy_sess=${token}`;
}

function sessionOnHost(accountId: string, role: string, email: string, host: string): void {
  mockState.host = host;
  sessionCookieFor(accountId, role, email);
}

async function expectNotFound(run: () => Promise<unknown>): Promise<void> {
  await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
}

async function redirectTargetFor(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (err) {
    const m = /NEXT_REDIRECT;replace;([^;]+);/.exec(String((err as Error & { digest?: string })?.digest ?? ""));
    if (m) return m[1];
    throw err;
  }
}

/** Creates a Sunshine staff/carer account assigned to exactly the given rooms. */
async function carerAccount(email: string, name: string, roomIds: string[]): Promise<string> {
  const staff = await store.createStaff({ instituteId: sunshineIid, fullName: name, role: "carer", roomIds });
  const acct = await createAccount({ email, password: "kiddy-staff", fullName: name, role: "staff" });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), String(acct.id));
  return String(acct.id);
}

/** Creates an admin ROLE account with a linked admin staff row (the tenancy
 *  evidence the request-tenant host resolver needs — tenancyInstitutesForAccount
 *  reads account → staff → staff.institute_id). */
async function adminAccount(iid: string, email: string, password: string, name: string): Promise<string> {
  const staff = await store.createStaff({ instituteId: iid, fullName: name, role: "admin", roomIds: [] });
  const acct = await createAccount({ email, password, fullName: name, role: "admin" });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), String(acct.id));
  return String(acct.id);
}

beforeEach(async () => {
  process.env.PUBLIC_APEX_DOMAIN = APEX;
  mockState.cookie = "";
  mockState.host = "";
  mockState.cookies = {};
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute WHERE name = 'Sunshine Daycare'"))!.id);
  // The seed's only owner login carries the "admin" email hint; fetch its own
  // email so session tokens match the account row.
  const ownAcc = (await queryGet("SELECT id, email FROM account WHERE role = 'owner'"))!;
  sunshineOwnerAcc = String(ownAcc.id);
  sunshineOwnerEmail = String(ownAcc.email);
  const sunAdmin = await adminAccount(sunshineIid, "admin@sunshinedaycare.test", "kiddy-admin", "Sunshine Admin");
  sunshineAdminAcc = sunAdmin;
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  roomB = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool'"))!.id);
  childA = String((await queryGet("SELECT id FROM child WHERE room_id = ?", roomA))!.id);
  childB = String((await queryGet("SELECT id FROM child WHERE room_id = ?", roomB))!.id);
  // The second tenant through the real platform path (kid372 harness), plus
  // its own room + child and an admin account beside the owner.
  const maple = await store.createDaycare({
    name: "Maple Tree Daycare",
    subdomain: "mapletree",
    ownerEmail: "owner@mapletree.test",
    ownerPassword: "maple-owner-1",
    ownerFullName: "Maple Owner",
  });
  mapleIid = maple.instituteId;
  mapleOwnerAcc = maple.ownerAccountId;
  const mapleRoom = await store.createRoom(mapleIid, "Maple Room", 5);
  mapleChildId = String((await store.createChild({
    instituteId: mapleIid,
    firstName: "Maple",
    lastName: "Kid",
    roomId: String(mapleRoom.id),
  })).id);
  mapleAdminAcc = await adminAccount(mapleIid, "admin@mapletree.test", "maple-admin-1", "Maple Admin");
});

afterEach(() => {
  delete process.env.PUBLIC_APEX_DOMAIN;
});

// ---------------------------------------------------------------------------
// Unit: isChildInScope — the tenant gate must precede the admin bypass.
// ---------------------------------------------------------------------------
describe("KID-1328: isChildInScope — institute check before the admin/owner bypass", () => {
  it("an owner/admin of tenant A CANNOT authorize tenant B's child id (the leak)", async () => {
    // Pre-fix this returned TRUE: roomIds === null fired before any institute
    // check, which is exactly the KID-1312 Critical.
    expect(await store.isChildInScope(sunshineIid, sunshineOwnerAcc, mapleChildId)).toBe(false);
    expect(await store.isChildInScope(sunshineIid, sunshineAdminAcc, mapleChildId)).toBe(false);
    // And the reverse direction.
    expect(await store.isChildInScope(mapleIid, mapleOwnerAcc, childA)).toBe(false);
    expect(await store.isChildInScope(mapleIid, mapleOwnerAcc, childB)).toBe(false);
  });

  it("an owner/admin still authorizes same-tenant children (no over-tighten)", async () => {
    expect(await store.isChildInScope(sunshineIid, sunshineOwnerAcc, childA)).toBe(true);
    expect(await store.isChildInScope(sunshineIid, sunshineOwnerAcc, childB)).toBe(true);
    expect(await store.isChildInScope(sunshineIid, sunshineAdminAcc, childB)).toBe(true);
    expect(await store.isChildInScope(mapleIid, mapleOwnerAcc, mapleChildId)).toBe(true);
    expect(await store.isChildInScope(mapleIid, mapleAdminAcc, mapleChildId)).toBe(true);
  });

  it("staff/carers stay classroom-scoped within their own tenant", async () => {
    const roomACarer = await carerAccount("kid1328-carer-a@sunshinedaycare.test", "Room A Carer", [roomA]);
    const unassigned = await carerAccount("kid1328-carer-empty@sunshinedaycare.test", "Floor Carer", []);
    expect(await store.isChildInScope(sunshineIid, roomACarer, childA)).toBe(true);
    expect(await store.isChildInScope(sunshineIid, roomACarer, childB)).toBe(false);
    expect(await store.isChildInScope(sunshineIid, unassigned, childA)).toBe(false);
    // Classroom scoping never reroutes through the admin bypass for a foreign
    // child either — the institute check fails closed first.
    expect(await store.isChildInScope(sunshineIid, roomACarer, mapleChildId)).toBe(false);
  });

  it("a missing child id and an empty request tenant fail closed", async () => {
    expect(await store.isChildInScope(sunshineIid, sunshineOwnerAcc, "no-such-child")).toBe(false);
    expect(await store.isChildInScope("", sunshineOwnerAcc, childA)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pages: the exact KID-1312 reproduction — tenant B owner/admin reading
// tenant A's child PII / billing / development by direct id.
// ---------------------------------------------------------------------------
describe("KID-1328: portal child pages — cross-tenant reads are 404s", () => {
  it("profile: Maple owner on its own host 404s Sunshine's child", async () => {
    sessionOnHost(mapleOwnerAcc, "owner", "owner@mapletree.test", MAPLE_HOST);
    const { default: Page } = await import("@/app/portal/children/[id]/page");
    await expectNotFound(() =>
      Page({ params: Promise.resolve({ id: childA }), searchParams: Promise.resolve({}) })
    );
  });

  it("profile: Maple admin on its own host 404s Sunshine's child", async () => {
    sessionOnHost(mapleAdminAcc, "admin", "admin@mapletree.test", MAPLE_HOST);
    const { default: Page } = await import("@/app/portal/children/[id]/page");
    await expectNotFound(() =>
      Page({ params: Promise.resolve({ id: childB }), searchParams: Promise.resolve({}) })
    );
  });

  it("billing: Maple owner on its own host 404s Sunshine's child billing", async () => {
    sessionOnHost(mapleOwnerAcc, "owner", "owner@mapletree.test", MAPLE_HOST);
    const { default: Page } = await import("@/app/portal/children/[id]/billing/page");
    await expectNotFound(() =>
      Page({ params: Promise.resolve({ id: childA }), searchParams: Promise.resolve({}) })
    );
  });

  it("development: Maple admin on its own host 404s Sunshine's child", async () => {
    sessionOnHost(mapleAdminAcc, "admin", "admin@mapletree.test", MAPLE_HOST);
    const { default: Page } = await import("@/app/portal/children/[id]/development/page");
    await expectNotFound(() => Page({ params: Promise.resolve({ id: childA }) }));
  });

  it("the reverse direction 404s too: Sunshine owner tries Maple's child", async () => {
    sessionOnHost(sunshineOwnerAcc, "owner", sunshineOwnerEmail, SUNSHINE_HOST);
    const { default: Profile } = await import("@/app/portal/children/[id]/page");
    const { default: Billing } = await import("@/app/portal/children/[id]/billing/page");
    const { default: Development } = await import("@/app/portal/children/[id]/development/page");
    await expectNotFound(() =>
      Profile({ params: Promise.resolve({ id: mapleChildId }), searchParams: Promise.resolve({}) })
    );
    await expectNotFound(() =>
      Billing({ params: Promise.resolve({ id: mapleChildId }), searchParams: Promise.resolve({}) })
    );
    await expectNotFound(() => Development({ params: Promise.resolve({ id: mapleChildId }) }));
  });

  it("same-tenant owner still renders all three pages (profile/billing/development)", async () => {
    sessionOnHost(sunshineOwnerAcc, "owner", sunshineOwnerEmail, SUNSHINE_HOST);
    const { default: Profile } = await import("@/app/portal/children/[id]/page");
    const { default: Billing } = await import("@/app/portal/children/[id]/billing/page");
    const { default: Development } = await import("@/app/portal/children/[id]/development/page");
    const profileHtml = renderToStaticMarkup(
      await Profile({ params: Promise.resolve({ id: childA }), searchParams: Promise.resolve({}) })
    );
    expect(profileHtml).toContain("Ella");
    const billingHtml = renderToStaticMarkup(
      await Billing({ params: Promise.resolve({ id: childA }), searchParams: Promise.resolve({}) })
    );
    expect(billingHtml).toContain("Ella");
    const developmentHtml = renderToStaticMarkup(
      await Development({ params: Promise.resolve({ id: childA }) })
    );
    expect(developmentHtml).toContain("Ella");
  });
});

describe("KID-1328: portal child pages — role and session matrix stays intact", () => {
  it("same-tenant teacher/carer remain classroom-scoped (in-room renders, out-of-room 404s)", async () => {
    const carer = await carerAccount("kid1328-carer-page@sunshinedaycare.test", "Page Carer", [roomA]);
    sessionOnHost(carer, "staff", "kid1328-carer-page@sunshinedaycare.test", SUNSHINE_HOST);
    const { default: Page } = await import("@/app/portal/children/[id]/page");
    const inRoomHtml = renderToStaticMarkup(
      await Page({ params: Promise.resolve({ id: childA }), searchParams: Promise.resolve({}) })
    );
    expect(inRoomHtml).toContain("Ella");
    await expectNotFound(() =>
      Page({ params: Promise.resolve({ id: childB }), searchParams: Promise.resolve({}) })
    );
  });

  it("anonymous gets redirected to /login on every portal child route", async () => {
    mockState.cookies = {};
    mockState.cookie = "";
    mockState.host = SUNSHINE_HOST;
    const { default: Profile } = await import("@/app/portal/children/[id]/page");
    const { default: Billing } = await import("@/app/portal/children/[id]/billing/page");
    const { default: Development } = await import("@/app/portal/children/[id]/development/page");
    expect(await redirectTargetFor(() =>
      Profile({ params: Promise.resolve({ id: childA }), searchParams: Promise.resolve({}) })
    )).toBe("/login");
    expect(await redirectTargetFor(() =>
      Billing({ params: Promise.resolve({ id: childA }), searchParams: Promise.resolve({}) })
    )).toBe("/login");
    expect(await redirectTargetFor(() => Development({ params: Promise.resolve({ id: childA }) }))).toBe("/login");
  });
});

// ---------------------------------------------------------------------------
// Writes: assertChildInScope callers inherit the fixed rule.
// ---------------------------------------------------------------------------
describe("KID-1328: child write actions refuse foreign-tenant ids", () => {
  it("updateChildDetailsAction redirects to the scope error instead of writing", async () => {
    sessionOnHost(mapleOwnerAcc, "owner", "owner@mapletree.test", MAPLE_HOST);
    const { updateChildDetailsAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("childId", childA);
    form.set("firstName", "Hijacked");
    form.set("lastName", "Kid");
    expect(await redirectTargetFor(() => updateChildDetailsAction(form))).toBe("/portal/children?error=scope");
    const name = await queryGet("SELECT first_name FROM child WHERE id = ?", childA);
    expect(String(name!.first_name)).toBe("Ella");
  });

  it("updateChildDetailsAction still saves the centre's own child (positive path)", async () => {
    sessionOnHost(sunshineOwnerAcc, "owner", sunshineOwnerEmail, SUNSHINE_HOST);
    const { updateChildDetailsAction } = await import("@/lib/actions");
    const subject = await queryGet("SELECT room_id FROM child WHERE id = ?", childA);
    const form = new FormData();
    form.set("childId", childA);
    form.set("firstName", "Ella-Revised");
    form.set("lastName", "Daycare");
    form.set("roomId", String(subject!.room_id));
    form.set("status", "active");
    expect(await redirectTargetFor(() => updateChildDetailsAction(form))).toBe(`/portal/children/${childA}`);
    const row = await queryGet("SELECT first_name, last_name FROM child WHERE id = ?", childA);
    expect(String(row!.first_name)).toBe("Ella-Revised");
    expect(String(row!.last_name)).toBe("Daycare");
  });
});
