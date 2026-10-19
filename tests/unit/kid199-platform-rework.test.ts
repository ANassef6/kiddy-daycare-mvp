// KID-199.4r: the reworked /platform surface.
//
// The board decision (KID-210) this pins:
//
//   1. `superadmin` is NOT a role. `lib/role.ts` stops at owner|admin|staff|
//      carer|parent, no label exists in EN or AR, and any attempt to mint the
//      role through an account-creation path fails loudly.
//   2. /platform access is the env-based operator allowlist
//      (PLATFORM_ADMIN_EMAIL) paired with the internal sentinel session —
//      tested at the pure-function level here; the next/headers parts of the
//      guards stay out of the suite (same split as kid152/kid203, documented
//      there).
//   3. The extended create-daycare form: number of branches (one branch row
//      per branch, "Main" first), logo upload persisted to
//      institute.logo_url, and a theme preset mapped over the existing
//      branding tokens — owner credentials still seed a loginable account.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "@/lib/store";
import { createAccount, findAccountByEmail, verifyPassword } from "@/lib/auth";
import { queryAll, queryGet } from "@/lib/db";
import { dictionaries, keysOf } from "@/lib/i18n";
import { brandingFromInstitute } from "@/lib/theme";
import {
  PLATFORM_OPERATOR_ROLE,
  PLATFORM_THEME_KEYS,
  defaultThemeTokens,
  isPlatformOperatorEmail,
  isPlatformOperatorRole,
} from "@/lib/platform";
import { ROLES } from "@/lib/role";
import { seedFixture } from "../helpers";

beforeEach(async () => {
  await seedFixture();
});

describe("superadmin is not a role", () => {
  it("the role union stops at the five real daycare roles", () => {
    expect([...ROLES]).toEqual(["owner", "admin", "staff", "carer", "parent"]);
    expect(JSON.stringify(ROLES)).not.toContain("superadmin");
  });

  it("the operator sentinel is internal and never passes center-admin gates", () => {
    expect(isPlatformOperatorRole(PLATFORM_OPERATOR_ROLE)).toBe(true);
    expect(isPlatformOperatorRole("superadmin")).toBe(false);
    expect(isPlatformOperatorRole("owner")).toBe(false);
    expect(isPlatformOperatorRole("admin")).toBe(false);
  });

  it("minting a `superadmin` account fails (attempts to assign it fail)", async () => {
    await expect(
      createAccount({
        email: "boss@example.test",
        password: "super-secret-1",
        fullName: "Boss",
        role: "superadmin",
      })
    ).rejects.toThrow("account-role-not-assignable");
    expect(await findAccountByEmail("boss@example.test")).toBeUndefined();
  });

  it("the seeded operator row carries only the internal sentinel, not a daycare role", async () => {
    const row = await queryGet("SELECT role FROM account WHERE email = 'superadmin@kiddy.test'");
    expect(row).toBeDefined();
    expect(String(row!.role)).toBe(PLATFORM_OPERATOR_ROLE);
    // Its email is on the default allowlist, but a random operator-looking
    // email is not.
    expect(isPlatformOperatorEmail("superadmin@kiddy.test")).toBe(true);
    expect(isPlatformOperatorEmail("owner@maplegrove.test")).toBe(false);
  });
});

describe("operator allowlist", () => {
  it("matches exactly the emails in PLATFORM_ADMIN_EMAIL (comma-separated)", () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAIL", "ceo@example.test , ops@example.test,");
    try {
      expect(isPlatformOperatorEmail("CEO@example.test")).toBe(true);
      expect(isPlatformOperatorEmail("ops@example.test")).toBe(true);
      expect(isPlatformOperatorEmail("owner@maplegrove.test")).toBe(false);
      expect(isPlatformOperatorEmail("")).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to the legacy SUPERADMIN_EMAIL when the new var is unset", () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAIL", "");
    vi.stubEnv("SUPERADMIN_EMAIL", "fallback@example.test");
    try {
      expect(isPlatformOperatorEmail("fallback@example.test")).toBe(true);
      expect(isPlatformOperatorEmail("superadmin@kiddy.test")).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("theme presets map onto the existing branding tokens", () => {
  it("every preset resolves to #RRGGBB colors and a font", () => {
    for (const key of PLATFORM_THEME_KEYS) {
      const t = defaultThemeTokens(key);
      expect(t.primaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(t.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(t.font.length).toBeGreaterThan(0);
    }
  });

  it("an unknown or empty theme falls back to a safe default", () => {
    expect(defaultThemeTokens("not-a-theme").primaryColor).toMatch(/^#/);
    expect(defaultThemeTokens("").primaryColor).toMatch(/^#/);
  });
});

describe("createDaycare extended fields", () => {
  it("creates one branch row per branch: Main first, then named extras", async () => {
    const res = await store.createDaycare({
      name: "Maple Grove",
      branches: 3,
      ownerEmail: "owner7@maplegrove.test",
      ownerPassword: "maple-owner-7",
      ownerFullName: "Nadia Kareem",
    });
    expect(res.branchIds).toHaveLength(3);
    const rows = await queryAll(
      `SELECT name FROM branch WHERE institute_id = ? ORDER BY created_at`,
      res.instituteId
    );
    expect(rows.map((r) => String(r.name))).toEqual(["Main", "Branch 2", "Branch 3"]);
  });

  it("defaults to a single Main branch and clamps absurd counts", async () => {
    const res = await store.createDaycare({
      name: "Cedar Street",
      ownerEmail: "owner8@cedarstreet.test",
      ownerPassword: "cedar-owner-8",
      ownerFullName: "Nadia Kareem",
    });
    expect(res.branchIds).toHaveLength(1);
    const branch = await queryGet(`SELECT name FROM branch WHERE id = ?`, res.branchIds[0]);
    expect(String(branch!.name)).toBe("Main");

    const res20 = await store.createDaycare({
      name: "Palm Court",
      branches: 999,
      ownerEmail: "owner9@palmcourt.test",
      ownerPassword: "palm-owner-9",
      ownerFullName: "Nadia Kareem",
    });
    expect(res20.branchIds).toHaveLength(20);
  });

  it("persists the logo URL so the tenant branding renders it", async () => {
    const res = await store.createDaycare({
      name: "Ocean Cove",
      logoUrl: "https://cdn.example.test/daycares/ocean-cove/logo.png",
      ownerEmail: "owner10@oceancove.test",
      ownerPassword: "ocean-owner-10",
      ownerFullName: "Nadia Kareem",
    });
    const branding = brandingFromInstitute(await store.getInstitute(res.instituteId));
    expect(branding.logoUrl).toBe("https://cdn.example.test/daycares/ocean-cove/logo.png");
  });

  it("applies the owner credentials so the new daycare is immediately loginable", async () => {
    await store.createDaycare({
      name: "Lily Field",
      ownerEmail: "owner11@lilyfield.test",
      ownerPassword: "lily-owner-11",
      ownerFullName: "Owner One",
    });
    const account = await findAccountByEmail("owner11@lilyfield.test");
    expect(account).toBeDefined();
    expect(verifyPassword("lily-owner-11", String(account!.password_hash))).toBe(true);
  });
});

describe("i18n", () => {
  it("no superadmin label exists in either dictionary", () => {
    for (const dict of [dictionaries.en, dictionaries.ar]) {
      for (const key of keysOf(dict)) {
        expect(key.endsWith(".superadmin")).toBe(false);
      }
    }
  });

  it("the extended create-form labels exist in EN and AR with matching key sets", () => {
    const required = [
      "platform.operator",
      "platform.branches",
      "platform.logo",
      "platform.theme",
      "platform.themeOcean",
      "platform.themeSunset",
      "platform.themeForest",
      "platform.themeMidnight",
      "platform.themeCustom",
    ];
    const enKeys = new Set(keysOf(dictionaries.en));
    const arKeys = new Set(keysOf(dictionaries.ar));
    for (const key of required) {
      expect(enKeys.has(key)).toBe(true);
      expect(arKeys.has(key)).toBe(true);
    }
    // The daycare role labels are exactly the five real roles in both dicts.
    const roleKeys = (d: typeof dictionaries.en) =>
      keysOf(d).filter((k) => k.startsWith("roles.")).sort();
    expect(roleKeys(dictionaries.en)).toEqual([
      "roles.admin",
      "roles.carer",
      "roles.owner",
      "roles.parent",
      "roles.staff",
    ]);
    expect([...arKeys].sort()).toEqual([...enKeys].sort());
  });
});
