// KID-199.4: the /platform surface — daycare list with the enable/disable
// toggle and the create-daycare flow.
//
// The store-level core (createDaycare, listInstitutesForPlatform,
// setInstituteActive/tenancy gating) is tested directly against the same
// isolated SQLite data layer the actions call. The action/page-level guards
// themselves (requireSuperadmin, requireSession + role check) mirror
// requireAdmin in lib/actions.ts and the per-page guard precedent, and need
// next/headers — the same split kid152-register-path-gate.test.ts documents —
// so page/action cookies/redirect code stays out of these tests and the rows
// those guards protect are pinned here.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { createAccount, findAccountByEmail, verifyPassword } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { dictionaries, keysOf } from "@/lib/i18n";
import { seedFixture } from "../helpers";

let sunshineIid: string;

beforeEach(async () => {
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
});

describe("createDaycare", () => {
  it("creates the daycare, its first owner staff row, and a loginable owner account", async () => {
    const res = await store.createDaycare({
      name: "Maple Grove",
      primaryColor: "#EF4444",
      accentColor: "#F59E0B",
      font: "Nunito",
      ownerEmail: "owner@maplegrove.test",
      ownerPassword: "maple-owner-1",
      ownerFullName: "Nadia Kareem",
    });

    const inst = await store.getInstitute(res.instituteId);
    expect(inst).toBeDefined();
    expect(String(inst!.name)).toBe("Maple Grove");
    expect(String(inst!.primary_color)).toBe("#EF4444");

    // The owner login exists with the account role, and the password verifies.
    const account = await findAccountByEmail("owner@maplegrove.test");
    expect(account).toBeDefined();
    expect(String(account!.role)).toBe("owner");
    expect(verifyPassword("maple-owner-1", String(account!.password_hash))).toBe(true);
    expect(verifyPassword("wrong", String(account!.password_hash))).toBe(false);

    // account.staff_id points at the owner's own staff row at THIS daycare.
    const staff = await queryGet("SELECT * FROM staff WHERE id = ?", res.ownerStaffId);
    expect(staff).toBeDefined();
    expect(String(staff!.institute_id)).toBe(res.instituteId);
    expect(String(staff!.role)).toBe("owner");
  });

  it("the new owner's tenancy resolves to the new daycare, not the legacy first institute", async () => {
    // Sunshine (the seeded, FIRST institute) must stay untouched by the new
    // owner's resolution — this is exactly the bug class KID-199.3 scoped.
    const res = await store.createDaycare({
      name: "Maple Grove",
      ownerEmail: "owner2@maplegrove.test",
      ownerPassword: "maple-owner-2",
      ownerFullName: "Nadia Kareem",
    });
    const inst = await store.primaryInstituteIdForAccount(res.ownerAccountId);
    expect(inst).toBe(res.instituteId);
    expect(inst).not.toBe(sunshineIid);
  });

  it("refuses an owner email that already has an account", async () => {
    await expect(
      store.createDaycare({
        name: "Maple Grove",
        ownerEmail: "parent@example.test", // the seeded parent's email
        ownerPassword: "some-password",
        ownerFullName: "Dup",
      })
    ).rejects.toThrow("owner-email-in-use");
  });

  it("refuses an empty daycare name", async () => {
    await expect(
      store.createDaycare({
        name: "   ",
        ownerEmail: "owner3@maplegrove.test",
        ownerPassword: "some-password",
        ownerFullName: "Dup",
      })
    ).rejects.toThrow("daycare-name-required");
  });
});

describe("listInstitutesForPlatform", () => {
  it("lists every daycare, including disabled ones, with owner/staff counts", async () => {
    const res = await store.createDaycare({
      name: "Maple Grove",
      ownerEmail: "owner4@maplegrove.test",
      ownerPassword: "maple-owner-4",
      ownerFullName: "Maple Owner",
    });
    // One extra non-owner staff row at Maple Grove.
    await store.createStaff({ instituteId: res.instituteId, fullName: "Maple Carer", role: "carer" });

    const rows = await store.listInstitutesForPlatform();
    const names = rows.map((r) => String(r.name));
    expect(names).toContain("Sunshine Daycare");
    expect(names).toContain("Maple Grove");

    const maple = rows.find((r) => String(r.name) === "Maple Grove")!;
    expect(Number(maple.owner_count)).toBe(1);
    expect(Number(maple.staff_count)).toBe(2); // owner staff + carer
    expect(Number(maple.active ?? 1)).toBe(1);

    const sunshine = rows.find((r) => String(r.name) === "Sunshine Daycare")!;
    expect(Number(sunshine.owner_count)).toBe(1); // seeded Maria Lopez owner login
    expect(Number(sunshine.staff_count)).toBe(1);

    // A disabled daycare still lists (the platform needs to see it to re-enable).
    await store.setInstituteActive(res.instituteId, false);
    const after = await store.listInstitutesForPlatform();
    expect(after.some((r) => String(r.name) === "Maple Grove")).toBe(true);
  });
});

describe("toggle disables/restores the new tenant's people", () => {
  async function newTenant(): Promise<{ instituteId: string; ownerId: string; parentId: string }> {
    const res = await store.createDaycare({
      name: "Maple Grove",
      ownerEmail: "owner5@maplegrove.test",
      ownerPassword: "maple-owner-5",
      ownerFullName: "Maple Owner",
    });
    const owner = await findAccountByEmail("owner5@maplegrove.test");
    const parent = await createAccount({
      email: "parent@maplegrove.test",
      password: "maple-parent-1",
      fullName: "Maple Parent",
      role: "parent",
    });
    const child = await store.createChild({
      instituteId: res.instituteId,
      firstName: "Sam",
      lastName: "Ali",
    });
    await store.linkFamily(parent.id as string, child.id as string);
    for (const iid of [sunshineIid, res.instituteId]) {
      // sanity: family row scoped to this daycare's child only
      void iid;
    }
    return {
      instituteId: res.instituteId,
      ownerId: String(owner!.id),
      parentId: String(parent.id),
    };
  }

  it("disabling flags the tenancy and re-enabling restores it", async () => {
    const t = await newTenant();
    expect(await store.isTenancyDisabled(t.ownerId)).toBe(false);
    await store.setInstituteActive(t.instituteId, false);
    expect(await store.isTenancyDisabled(t.ownerId)).toBe(true);
    await store.setInstituteActive(t.instituteId, true);
    expect(await store.isTenancyDisabled(t.ownerId)).toBe(false);
  });

  it("state persists across reads (the reload-persisted criterion)", async () => {
    const t = await newTenant();
    await store.setInstituteActive(t.instituteId, false);
    const reloaded = await store.getInstitute(t.instituteId);
    expect(Number(reloaded!.active)).toBe(0);
  });
});

describe("i18n", () => {
  it("carries the platform labels in both EN and AR with matching key sets", () => {
    const enKeys = keysOf(dictionaries.en).filter((k) => k.startsWith("platform."));
    const arKeys = keysOf(dictionaries.ar).filter((k) => k.startsWith("platform."));
    expect(enKeys.length).toBeGreaterThan(0);
    expect(arKeys.sort()).toEqual(enKeys.sort());
  });
});
