// KID-199.3: platform foundation — institute active flag, per-session tenant
// scoping, superadmin role.
//
// Two-tenant fixture (same pattern as kid152-tenant-gate.test.ts): the seeded
// Sunshine Daycare plus "Other Center". Before this ticket every read site
// picked the FIRST institute, so the second daycare's staff and parents saw
// Sunshine's data. These tests pin the session-aware rule in lib/store.ts /
// lib/tenant.ts:
//
//   staff  -> their staff row's institute
//   parent -> their KID-152 tenancy set (earliest institute first)
//   superadmin -> excluded from tenant scoping (no forced institute)
//   disabled tenant -> staff AND parents blocked at gate level
//
// The DB-level functions are tested directly (no request scope needed); the
// cookie-header resolver is covered via tenantInstituteIdForCookie, which is
// exactly what resolveTenantInstituteId feeds from next/headers.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { tenantInstituteIdForCookie } from "@/lib/tenant";
import { isSuperadminRole, isAdminRole } from "@/lib/role";
import { seedFixture } from "../helpers";

let sunshineIid: string;

/** The second tenant, with a room and an owner login wired to a staff row. */
async function seedOtherCenter(): Promise<{
  instituteId: string;
  roomId: string;
  ownerAccountId: string;
}> {
  const other = await store.seedInstitute({
    name: "Other Center",
    primaryColor: "#EF4444",
  });
  const otherIid = String(other.id);
  const room = await store.createRoom(otherIid, "Other Room", 10);
  const staff = await store.createStaff({
    instituteId: otherIid,
    fullName: "Other Owner",
    role: "admin",
    roomIds: [room.id as string],
  });
  const account = await createAccount({
    email: "owner@othercenter.test",
    password: "other-center",
    fullName: "Other Owner",
    role: "owner",
  });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", staff.id, account.id);
  return {
    instituteId: otherIid,
    roomId: String(room.id),
    ownerAccountId: String(account.id),
  };
}

async function sunshineOwnerAccount(): Promise<{ accountId: string; staffId: string }> {
  const row = await queryGet(
    "SELECT a.id, a.staff_id FROM account a WHERE a.email = 'admin@sunshinedaycare.test'"
  );
  return { accountId: String(row!.id), staffId: String(row!.staff_id) };
}

/** A parent on file at one centre: invite + family link, the KID-152 shape. */
async function seededParent(
  email: string,
  instituteId: string,
  childId: string
): Promise<string> {
  await store.createInvite(instituteId, childId, email, `CODE-${email.slice(0, 6).toUpperCase()}`, "parent");
  const account = await createAccount({
    email,
    password: "kiddy-parent",
    fullName: "Fixture Parent",
    role: "parent",
  });
  await store.linkFamily(String(account.id), childId, "parent");
  return String(account.id);
}

beforeEach(async () => {
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute ORDER BY created_at LIMIT 1"))!.id);
});

describe("KID-199.3 session-aware tenant scoping", () => {
  it("resolves each tenant's staff to their own institute, not the first one", async () => {
    // Arrange: Sunshine is created first, and listInstitutes()/getFirstInstitute()
    // would have handed "Other Center" staff Sunshine's id. That is the defect.
    const other = await seedOtherCenter();

    // Act
    const sunshineStaff = await store.staffInstituteIdForAccount(
      (await sunshineOwnerAccount()).accountId
    );
    const otherStaff = await store.staffInstituteIdForAccount(other.ownerAccountId);

    // Assert
    expect(sunshineStaff).toBe(sunshineIid);
    expect(otherStaff).toBe(other.instituteId);
    expect(other.instituteId).not.toBe(sunshineIid);
  });

  it("resolves a parent to their own daycare via the KID-152 tenancy set", async () => {
    // Arrange: a parent whose only evidence is an invite + family link at the
    // SECOND centre — the case where "first institute wins" was outed.
    const other = await seedOtherCenter();
    const child = await store.createChild({
      instituteId: other.instituteId,
      firstName: "Second",
      lastName: "Tenant",
      roomId: other.roomId,
    });
    const accountId = await seededParent("second-tenant@example.test", other.instituteId, String(child.id));

    // Act
    const resolved = await store.primaryInstituteIdForAccount(accountId);

    // Assert: their own daycare, not Sunshine.
    expect(resolved).toBe(other.instituteId);
    expect(await store.instituteIdsForAccount(accountId)).toEqual([other.instituteId]);
  });

  it("keeps the Sunshine demo parent on Sunshine when two daycares exist", async () => {
    // The negative control for the case above: the standard fixture parent
    // must still resolve to Sunshine.
    const other = await seedOtherCenter();
    const row = await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'");
    const accountId = String(row!.id);

    expect(await store.primaryInstituteIdForAccount(accountId)).toBe(sunshineIid);
    expect(await store.instituteIdsForAccount(accountId)).not.toContain(other.instituteId);
  });

  it("resolves tenants from the session cookie the way the pages do", async () => {
    // Arrange: signed session tokens for one staff member of each tenant.
    const other = await seedOtherCenter();
    const sunshine = await sunshineOwnerAccount();
    await createAccount({ email: "dummy@example.test", password: "x", fullName: "Dummy", role: "parent" });

    const sunshineCookie = createSessionToken({
      accountId: sunshine.accountId,
      role: "owner",
      email: "admin@sunshinedaycare.test",
      emailConfirmed: true,
    });
    const otherCookie = createSessionToken({
      accountId: other.ownerAccountId,
      role: "owner",
      email: "owner@othercenter.test",
      emailConfirmed: true,
    });

    // Act + Assert: same deployment, two sessions, two tenants.
    expect(await tenantInstituteIdForCookie(`kiddy_sess=${encodeURIComponent(sunshineCookie)}`)).toBe(sunshineIid);
    expect(await tenantInstituteIdForCookie(`kiddy_sess=${encodeURIComponent(otherCookie)}`)).toBe(other.instituteId);
  });

  it("a multi-daycare parent resolves deterministically to their earliest institute", async () => {
    // Genuinely multi-centre parents exist (KID-152 docstring); the resolver
    // could not bounce between centres per request, so it must pick the
    // earliest one and always return the same id.
    const other = await seedOtherCenter();
    const childA = await store.createChild({
      instituteId: sunshineIid,
      firstName: "Earliest",
      lastName: "Kid",
      roomId: String((await queryGet("SELECT id FROM room WHERE institute_id = ? LIMIT 1", sunshineIid))!.id),
    });
    const childB = await store.createChild({
      instituteId: other.instituteId,
      firstName: "Later",
      lastName: "Kid",
      roomId: other.roomId,
    });
    const accountId = await seededParent("multi@example.test", sunshineIid, String(childA.id));
    await store.linkFamily(accountId, String(childB.id), "parent");

    const first = await store.primaryInstituteIdForAccount(accountId);
    expect(first).toBe(sunshineIid);
    expect(await store.primaryInstituteIdForAccount(accountId)).toBe(first);
  });
});

describe("KID-199.3 active flag enforcement", () => {
  it("blocks staff of a disabled daycare at the tenancy gate, staff of the enabled one passes", async () => {
    // Arrange: two tenants; disable the second.
    const other = await seedOtherCenter();
    await store.setInstituteActive(other.instituteId, false);

    // Act + Assert
    expect(await store.isTenancyDisabled(other.ownerAccountId)).toBe(true);
    expect(
      await store.isTenancyDisabled((await sunshineOwnerAccount()).accountId)
    ).toBe(false);
  });

  it("blocks parents of a disabled daycare too", async () => {
    const other = await seedOtherCenter();
    const child = await store.createChild({
      instituteId: other.instituteId,
      firstName: "Disabled",
      lastName: "Tenant",
      roomId: other.roomId,
    });
    const accountId = await seededParent("blocked-parent@example.test", other.instituteId, String(child.id));

    // Act
    await store.setInstituteActive(other.instituteId, false);

    // Assert
    expect(await store.isTenancyDisabled(accountId)).toBe(true);
  });

  it("re-enabling the daycare restores access (nothing is deleted)", async () => {
    // Arrange
    const other = await seedOtherCenter();
    await store.setInstituteActive(other.instituteId, false);
    expect(await store.isTenancyDisabled(other.ownerAccountId)).toBe(true);

    // Act
    await store.setInstituteActive(other.instituteId, true);

    // Assert
    expect(await store.isTenancyDisabled(other.ownerAccountId)).toBe(false);
    expect(Number((await queryGet("SELECT active FROM institute WHERE id = ?", other.instituteId))!.active)).toBe(1);
  });

  it("new institutes default to active", async () => {
    const other = await store.seedInstitute({ name: "Fresh Center" });
    expect(Number(other.active)).toBe(1);
  });

  it("an account with no tenancy is never disabled by this gate", async () => {
    // The gate must not fabricate a block: an account with no staff row and no
    // family/invite evidence has no daycare to be disabled.
    const outsider = await createAccount({
      email: "no-tenancy@example.test",
      password: "x",
      fullName: "Outsider",
      role: "parent",
    });
    expect(await store.isTenancyDisabled(String(outsider.id))).toBe(false);
  });
});

describe("KID-199.3 superadmin role", () => {
  it("superadmin is excluded from tenant scoping", async () => {
    // Arrange: the seeded superadmin + a session cookie. The resolver hands
    // them no institute — the /platform surface (KID-199.4) selects daycares
    // explicitly, and the scoping rule must not pin them to the first one.
    const superadmin = await queryGet("SELECT id FROM account WHERE email = 'superadmin@kiddy.test'");
    await seedOtherCenter(); // two institutes present

    // Act
    const viaCookie = await tenantInstituteIdForCookie(
      `kiddy_sess=${encodeURIComponent(
        createSessionToken({
          accountId: String(superadmin!.id),
          role: "superadmin",
          email: "superadmin@kiddy.test",
          emailConfirmed: true,
        })
      )}`
    );

    // Assert
    expect(await isSuperadminRole("superadmin")).toBe(true);
    expect(viaCookie).toBe("");
  });

  it("isAdminRole keeps exact owner|admin semantics (center admins unchanged)", async () => {
    expect(isAdminRole("owner")).toBe(true);
    expect(isAdminRole("admin")).toBe(true);
    // The regression this pins: superadmin must not silently pass center-admin
    // gates, and no center role leaks into it.
    expect(isAdminRole("superadmin")).toBe(false);
    expect(isAdminRole("staff")).toBe(false);
    expect(isAdminRole("carer")).toBe(false);
    expect(isAdminRole("parent")).toBe(false);
  });
});
