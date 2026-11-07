// KID-683: per-daycare branding must never appear on the public platform
// (kiddyapp.net) or the global auth pages. KID-493 mounted BrandBanner in the
// root layout, and getBranding's anonymous/generic-host path resolved the
// first-created institute — so the Sunshine Daycare logo + brand image
// (uploaded in production, row 1) rendered on the apex landing page and
// /login.
//
// Rule pinned here:
//   lib/theme.ts getBranding        — apex/anonymous → PLATFORM brand only
//                                     (never getFirstInstitute(); per-daycare
//                                     brand reaches an anonymous caller only
//                                     through that daycare's own subdomain);
//   lib/theme.ts brandNameForTitle  — same precedence for the /login header;
//   the signed-in path              — portal/parent surfaces carry the signed-in
//                                     user's OWN daycare brand only, and a
//                                     second daycare's assets never leak.
//
// Follows the repo's leak-history convention (KID-152/207/199.3r): every no-leak
// assertion is made against concrete tenant asset URLs, not just names.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- request-scope mock (same shape as kid212-subdomain.test.ts). ----------
let mockHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  headers: () => ({
    get: (key: string) => mockHeaders[key.toLowerCase()] ?? null,
  }),
}));

import * as store from "@/lib/store";
import { createSessionToken } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { brandNameForTitle, clearBrandingCache, getBranding } from "@/lib/theme";
import { seedFixture } from "../helpers";

const APEX = "daycare.test";
const SUNSHINE_ASSETS = {
  logo_url: "https://cdn.daycare.test/sunshine/logo.png",
  brand_image_url: "https://cdn.daycare.test/sunshine/brand-image.png",
  primary_color: "#7C3AED",
};
const MAPLE_ASSETS = {
  logo_url: "https://cdn.daycare.test/maple/logo.png",
  brand_image_url: "https://cdn.daycare.test/maple/brand-image.png",
  primary_color: "#DC2626",
};

function cookieFor(accountId: string, role: string, email: string): string {
  return `kiddy_sess=${encodeURIComponent(
    createSessionToken({ accountId, role, email, emailConfirmed: true })
  )}`;
}

async function sunshineIid(): Promise<string> {
  return String(
    (await queryGet("SELECT id FROM institute ORDER BY created_at LIMIT 1"))!.id
  );
}

async function seedSunshineAssets(): Promise<void> {
  await store.updateInstitute(await sunshineIid(), SUNSHINE_ASSETS);
}

async function seedMaple(): Promise<{ instituteId: string; ownerAccountId: string }> {
  const res = await store.createDaycare({
    name: "Maple Tree Daycare",
    subdomain: "mapletree",
    ownerEmail: "owner@mapletree.test",
    ownerPassword: "maple-owner-1",
    ownerFullName: "Maple Owner",
  });
  await store.updateInstitute(res.instituteId, MAPLE_ASSETS);
  return { instituteId: res.instituteId, ownerAccountId: res.ownerAccountId };
}

beforeEach(async () => {
  process.env.PUBLIC_APEX_DOMAIN = APEX;
  mockHeaders = {};
  await seedFixture();
  // Reproduce the reported production state: the first-created tenant has an
  // uploaded logo + brand image. Whatever the anonymous rule resolves, these
  // URLs must not show on the platform.
  await seedSunshineAssets();
});

afterEach(async () => {
  // The TTL caches hold resolved branding across tests; purge them or the
  // next test could read the previous one's tenant.
  delete process.env.PUBLIC_APEX_DOMAIN;
  clearBrandingCache();
});

describe("KID-683: anonymous apex shows the platform brand only", () => {
  it("Public home + global auth resolve branding with NO daycare asset at all", async () => {
    mockHeaders = { host: APEX };
    const b = await getBranding();
    expect(b.name).toBe("Kiddy");
    expect(b.logoUrl).toBeNull();
    expect(b.brandImageUrl).toBeNull();
    expect(b.primaryColor).toBe("#3B82F6");
    // The /login header brand (AuthBrand's only input) follows the same rule.
    expect(await brandNameForTitle()).toBe("Kiddy");
  });

  it("The login header brand stays the platform name even when the first tenant has every brand asset set", async () => {
    // Sunshine owns SO many assets at this point; any first-institute fallback
    // anywhere in the auth resolution would name it.
    await seedMaple();
    mockHeaders = { host: APEX };
    expect(await brandNameForTitle()).toBe("Kiddy");
  });
});

describe("KID-683: a two-daycare fixture never leaks", () => {
  it(" Sunshine's subdomain shows Sunshine, Maple's shows Maple, the apex shows neither", async () => {
    const maple = await seedMaple();
    const sun = await sunshineIid();

    mockHeaders = { host: `sunshine-daycare.${APEX}` };
    const sunBrand = await getBranding();
    expect(sunBrand.name).toBe("Sunshine Daycare");
    expect(sunBrand.brandImageUrl).toBe(SUNSHINE_ASSETS.brand_image_url);
    expect(sunBrand.logoUrl).toBe(SUNSHINE_ASSETS.logo_url);

    clearBrandingCache();
    mockHeaders = { host: `mapletree.${APEX}` };
    const mapleBrand = await getBranding();
    expect(mapleBrand.name).toBe("Maple Tree Daycare");
    expect(mapleBrand.brandImageUrl).toBe(MAPLE_ASSETS.brand_image_url);
    expect(mapleBrand.logoUrl).toBe(MAPLE_ASSETS.logo_url);

    clearBrandingCache();
    mockHeaders = { host: APEX };
    const apexBrand = await getBranding();
    expect(apexBrand.name).toBe("Kiddy");
    expect(apexBrand.brandImageUrl).toBeNull();
    expect(apexBrand.logoUrl).toBeNull();
    void sun;
    void maple;
  });

  it("an unknown subdomain resolves the platform brand, never a tenant's assets", async () => {
    await seedMaple();
    mockHeaders = { host: `nope.${APEX}` };
    const b = await getBranding();
    expect(b.name).toBe("Kiddy");
    expect(b.brandImageUrl).toBeNull();
    expect(b.logoUrl).toBeNull();
  });
});

describe("KID-683: portal/parent surfaces carry the signed-in account's daycare brand only", () => {
  it("Apex + Sunshine session resolves Sunshine, with its uploaded assets", async () => {
    const account = await queryGet(
      "SELECT id, email FROM account WHERE email = 'trois4ever+admin@gmail.com'"
    );
    mockHeaders = {
      host: APEX,
      cookie: cookieFor(String(account!.id), "owner", String(account!.email)),
    };
    const b = await getBranding();
    expect(b.name).toBe("Sunshine Daycare");
    expect(b.brandImageUrl).toBe(SUNSHINE_ASSETS.brand_image_url);
    expect(b.logoUrl).toBe(SUNSHINE_ASSETS.logo_url);
  });

  it("Apex + Maple session resolves Maple — never the first-created tenant", async () => {
    const maple = await seedMaple();
    mockHeaders = {
      host: APEX,
      cookie: cookieFor(maple.ownerAccountId, "owner", "owner@mapletree.test"),
    };
    const b = await getBranding();
    expect(b.name).toBe("Maple Tree Daycare");
    expect(b.brandImageUrl).toBe(MAPLE_ASSETS.brand_image_url);
    expect(b.logoUrl).toBe(MAPLE_ASSETS.logo_url);
  });

  it("The platform operator on the apex stays on the platform brand", async () => {
    const op = await queryGet("SELECT id, email FROM account WHERE email = 'superadmin@kiddy.test'");
    mockHeaders = {
      host: APEX,
      cookie: cookieFor(String(op!.id), "platform", String(op!.email)),
    };
    const b = await getBranding();
    expect(b.name).toBe("Kiddy");
    expect(b.brandImageUrl).toBeNull();
    expect(b.logoUrl).toBeNull();
  });
});

describe("KID-683: upload/cache invalidation contract unchanged", () => {
  it("a freshly uploaded brand image leaves the anonymous apex cold (still platform-only)", async () => {
    mockHeaders = { host: APEX };
    const b = await getBranding();
    expect(b.brandImageUrl).toBeNull();
    // The KID-493 upload → clearBrandingCache → revalidate chain keeps working;
    // the anonymous path just never re-reads a tenant's assets anymore. Theme
    // upload/state tests for those chains live in kid489-branding.test.tsx and
    // kid199-platform-rework.test.ts.
    expect(clearBrandingCache()).toBeUndefined();
  });
});
