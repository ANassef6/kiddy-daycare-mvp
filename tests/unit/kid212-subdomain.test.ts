// KID-199.3r (KID-212): white-label wildcard subdomains — one branded tenant
// per daycare domain. Board clarification (KID-210): "this is going to be a
// white label app, so every daycare account needs to be separate and we will
// be using wildcard domain names as well. For example for sunshine daycare
// (sunshine.domain.com), for maple tree daycare (mapletree.domain.com)."
//
// Layers pinned here:
//   lib/subdomain.ts — pure slug normalization + host classification (apex is
//     the PUBLIC_APEX_DOMAIN env; no domain is ever hardcoded);
//   lib/store.ts     — institute.subdomain normalized + unique at create,
//     editable for /platform (0024 unique index is the backstop);
//   lib/tenant.ts    — the request-level host resolver wrapped around the
//     KID-199.3 session resolver, fail-closed for cross-tenant sessions;
//   lib/theme.ts     — anonymous branding on a subdomain follows THAT tenant
//     (the "first daycare renders everywhere" leak).
//
// The repo's cross-tenant leak history (KID-152, KID-207) is why every
// refusal below is asserted as absence of data, not just a kind label.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- request-scope mock: theme.ts/tenant.ts read next/headers; tests inject
// the host/cookie per test instead of spinning a server. -------------------
let mockHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  headers: () => ({
    get: (key: string) => mockHeaders[key.toLowerCase()] ?? null,
  }),
}));

import * as store from "@/lib/store";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import {
  loginHostGate,
  resolveRequestTenantFor,
  tenantInstituteIdForCookie,
} from "@/lib/tenant";
import { apexDomain, normalizeSubdomainSlug, splitSubdomainHost } from "@/lib/subdomain";
import { getBranding } from "@/lib/theme";
import { seedFixture } from "../helpers";

const APEX = "daycare.test";
let sunshineIid: string;

function cookieFor(accountId: string, role: string, email: string): string {
  return `kiddy_sess=${encodeURIComponent(
    createSessionToken({ accountId, role, email, emailConfirmed: true })
  )}`;
}

/** The second tenant, created through the real platform path (createDaycare),
 *  so its owner login carries the staff link tenant resolution reads. */
async function seedMaple(subdomain = "mapletree"): Promise<{ instituteId: string; ownerAccountId: string }> {
  const res = await store.createDaycare({
    name: "Maple Tree Daycare",
    subdomain,
    ownerEmail: "owner@mapletree.test",
    ownerPassword: "maple-owner-1",
    ownerFullName: "Maple Owner",
  });
  return { instituteId: res.instituteId, ownerAccountId: res.ownerAccountId };
}

async function sunshineOwner(): Promise<{ accountId: string; email: string }> {
  const row = await queryGet(
    "SELECT a.id, a.email FROM account a WHERE a.email = 'admin@sunshinedaycare.test'"
  );
  return { accountId: String(row!.id), email: String(row!.email) };
}

async function operator(): Promise<{ accountId: string; email: string }> {
  const row = await queryGet("SELECT id, email FROM account WHERE email = 'superadmin@kiddy.test'");
  return { accountId: String(row!.id), email: String(row!.email) };
}

beforeEach(async () => {
  process.env.PUBLIC_APEX_DOMAIN = APEX;
  mockHeaders = {};
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute ORDER BY created_at LIMIT 1"))!.id);
});

afterEach(() => {
  delete process.env.PUBLIC_APEX_DOMAIN;
});

describe("KID-199.3r slug normalization (pure)", () => {
  it("slugifies the board's example daycares", () => {
    expect(normalizeSubdomainSlug("Sunshine Daycare")).toBe("sunshine-daycare");
    expect(normalizeSubdomainSlug("Maple Tree Daycare")).toBe("maple-tree-daycare");
  });

  it("folds diacritics and strips punctuation", () => {
    expect(normalizeSubdomainSlug("Héllo Wörld!")).toBe("hello-world");
    expect(normalizeSubdomainSlug("  --Weird__Name--  ")).toBe("weird-name");
  });

  it("returns empty for names with no usable slug", () => {
    expect(normalizeSubdomainSlug("   ")).toBe("");
    expect(normalizeSubdomainSlug("!!!")).toBe("");
  });

  it("caps the label so uniqueness suffixes stay inside the DNS limit", () => {
    expect(normalizeSubdomainSlug("x".repeat(80)).length).toBe(50);
  });
});

describe("KID-199.3r host classification (pure, apex is env-driven)", () => {
  it("reads the tenant slug from the first label under the apex", () => {
    expect(splitSubdomainHost(`sunshine.${APEX}`)).toEqual({ kind: "subdomain", slug: "sunshine" });
    expect(splitSubdomainHost(`mapletree.${APEX}`)).toEqual({ kind: "subdomain", slug: "mapletree" });
    expect(splitSubdomainHost(`maple-tree.${APEX}`)).toEqual({ kind: "subdomain", slug: "maple-tree" });
  });

  it("strips the port and trailing dot", () => {
    expect(splitSubdomainHost(`sunshine.${APEX}:3000`).kind).toBe("subdomain");
    expect(splitSubdomainHost(`sunshine.${APEX}.`).kind).toBe("subdomain");
  });

  it("keeps the apex and reserved labels generic", () => {
    expect(splitSubdomainHost(APEX).kind).toBe("apex");
    expect(splitSubdomainHost(`www.${APEX}`).kind).toBe("apex");
    expect(splitSubdomainHost(`platform.${APEX}`).kind).toBe("apex");
    expect(splitSubdomainHost(`api.${APEX}`).kind).toBe("apex");
  });

  it("never treats foreign domains, deep nesting, localhost or IPs as tenants", () => {
    expect(splitSubdomainHost("sunshine.attacker.com").kind).toBe("generic");
    expect(splitSubdomainHost(`a.b.${APEX}`).kind).toBe("generic");
    expect(splitSubdomainHost("localhost").kind).toBe("generic");
    expect(splitSubdomainHost("localhost:3000").kind).toBe("generic");
    expect(splitSubdomainHost("192.168.0.1").kind).toBe("generic");
    expect(splitSubdomainHost("kiddy-one.vercel.app").kind).toBe("generic");
  });

  it("with no apex configured, no hostname is a tenant host (legacy behavior)", () => {
    delete process.env.PUBLIC_APEX_DOMAIN;
    expect(apexDomain()).toBe("");
    expect(splitSubdomainHost("sunshine.anything.test").kind).toBe("generic");
    expect(splitSubdomainHost("daycare.test").kind).toBe("generic");
  });
});

describe("KID-199.3r institute.subdomain at create + edit", () => {
  it("the seeded demo daycare gets a slug derived from its name", async () => {
    const row = await queryGet("SELECT subdomain FROM institute WHERE id = ?", sunshineIid);
    expect(String(row!.subdomain)).toBe("sunshine-daycare");
  });

  it("createDaycare honors an explicit subdomain", async () => {
    const maple = await seedMaple("mapletree");
    const row = await queryGet("SELECT subdomain FROM institute WHERE id = ?", maple.instituteId);
    expect(String(row!.subdomain)).toBe("mapletree");
  });

  it("createDaycare derives the slug from the name when blank", async () => {
    const res = await store.createDaycare({
      name: "Cedar Grove Kids",
      ownerEmail: "owner@cedar.test",
      ownerPassword: "cedar-owner-1",
      ownerFullName: "Cedar Owner",
    });
    const row = await queryGet("SELECT subdomain FROM institute WHERE id = ?", res.instituteId);
    expect(String(row!.subdomain)).toBe("cedar-grove-kids");
  });

  it("a colliding slug gets a -2 suffix instead of failing or overwriting", async () => {
    // Sunshine is already "sunshine-daycare"; a second daycare with the same
    // name must land on a free variant.
    const inst = await store.seedInstitute({ name: "Sunshine Daycare" });
    expect(String(inst.subdomain)).toBe("sunshine-daycare-2");
  });

  it("setInstituteSubdomain normalizes, refuses clashes and refuses garbage", async () => {
    await expect(store.setInstituteSubdomain(sunshineIid, "Sunshine!!")).resolves.toBe("sunshine");
    const maple = await seedMaple();
    await expect(store.setInstituteSubdomain(maple.instituteId, "sunshine")).rejects.toThrow("subdomain-taken");
    await expect(store.setInstituteSubdomain(maple.instituteId, "!!!")).rejects.toThrow("subdomain-invalid");
    // Same value back onto its own row is never a clash.
    await expect(store.setInstituteSubdomain(maple.instituteId, "mapletree")).resolves.toBe("mapletree");
  });

  it("the 0024/SQLite unique index refuses a duplicate subdomain at the SQL layer", async () => {
    const maple = await seedMaple();
    await expect(
      queryRun("UPDATE institute SET subdomain = 'sunshine-daycare' WHERE id = ?", maple.instituteId)
    ).rejects.toThrow();
  });
});

describe("KID-199.3r host→tenant resolution", () => {
  it("anonymous visitors on a subdomain get THAT tenant, not the first-created one", async () => {
    // Arrange: Sunshine was created first. The legacy fallback would hand
    // every anonymous visitor Sunshine — this is the leak this test pins shut.
    const maple = await seedMaple();

    // Act
    const rt = await resolveRequestTenantFor(null, `mapletree.${APEX}`);

    // Assert
    expect(rt).toEqual({ kind: "host", instituteId: maple.instituteId });
  });

  it("a matching session on its own subdomain resolves to its tenant", async () => {
    const maple = await seedMaple();
    const cookie = cookieFor(maple.ownerAccountId, "owner", "owner@mapletree.test");
    expect(await resolveRequestTenantFor(cookie, `mapletree.${APEX}`)).toEqual({
      kind: "host",
      instituteId: maple.instituteId,
    });
  });

  it("FAILS CLOSED: a Sunshine account on the Maple subdomain is refused, not silently served", async () => {
    // Arrange: Sunshine session, Maple host.
    const maple = await seedMaple();
    const sun = await sunshineOwner();
    const cookie = cookieFor(sun.accountId, "owner", sun.email);

    // Act
    const rt = await resolveRequestTenantFor(cookie, `mapletree.${APEX}`);

    // Assert: no tenant data of Maple's is reachable (id "" == no tenant).
    expect(rt).toEqual({ kind: "cross-tenant", instituteId: "" });
  });

  it("a parent of BOTH daycares is served on either subdomain (genuine tenancy)", async () => {
    // Arrange: the KID-152 multi-centre parent shape — invites + family links
    // at both centres.
    const maple = await seedMaple();
    const room = await store.createRoom(maple.instituteId, "Maple Room", 5);
    const child = await store.createChild({
      instituteId: maple.instituteId,
      firstName: "Dual",
      lastName: "Tenant",
      roomId: String(room.id),
    });
    await store.createInvite(maple.instituteId, String(child.id), "dual@example.test", "DUAL-1", "parent");
    const account = await createAccount({
      email: "dual@example.test",
      password: "kiddy-parent",
      fullName: "Dual Parent",
      role: "parent",
    });
    await store.linkFamily(String(account.id), String(child.id), "parent");
    const sunshineChild = await store.createChild({
      instituteId: sunshineIid,
      firstName: "Sun",
      lastName: "Kid",
      roomId: String((await queryGet("SELECT id FROM room WHERE institute_id = ? LIMIT 1", sunshineIid))!.id),
    });
    await store.linkFamily(String(account.id), String(sunshineChild.id), "parent");
    const cookie = cookieFor(String(account.id), "parent", "dual@example.test");

    // Act + Assert: the tenancy set decides, not the first-institute fallback.
    expect(await resolveRequestTenantFor(cookie, `mapletree.${APEX}`)).toEqual({
      kind: "host",
      instituteId: maple.instituteId,
    });
  });

  it("an unknown subdomain resolves to no tenant at all", async () => {
    await seedMaple();
    expect(await resolveRequestTenantFor(null, `nope.${APEX}`)).toEqual({
      kind: "unknown-host",
      instituteId: "",
    });
  });

  it("the platform operator on a subdomain sees the host tenant (excluded from daycare tenancy)", async () => {
    const maple = await seedMaple();
    const op = await operator();
    const cookie = cookieFor(op.accountId, "platform", op.email);
    expect(await resolveRequestTenantFor(cookie, `mapletree.${APEX}`)).toEqual({
      kind: "host",
      instituteId: maple.instituteId,
    });
  });

  it("apex behavior is unchanged: anonymous falls back to first institute, sessions resolve themselves", async () => {
    const maple = await seedMaple();
    const sun = await sunshineOwner();
    // Anonymous on apex: legacy first-institute fallback (generic behavior).
    expect(await resolveRequestTenantFor(null, APEX)).toEqual({ kind: "generic", instituteId: sunshineIid });
    // Sunshine's owner on apex: their own tenant, not the host's (no host).
    const sunCookie = cookieFor(sun.accountId, "owner", sun.email);
    expect(await resolveRequestTenantFor(sunCookie, APEX)).toEqual({ kind: "generic", instituteId: sunshineIid });
    // Operator on apex: no tenant (the /platform surface), unchanged.
    const op = await operator();
    expect(await resolveRequestTenantFor(cookieFor(op.accountId, "platform", op.email), APEX)).toEqual({
      kind: "generic",
      instituteId: "",
    });
    // Legacy host: same generic rule.
    expect(await resolveRequestTenantFor(sunCookie, "kiddy-one.vercel.app")).toEqual({
      kind: "generic",
      instituteId: sunshineIid,
    });
    void maple;
  });

  it("keeps tenantInstituteIdForCookie as the generic-host rule (back-compat)", async () => {
    const sun = await sunshineOwner();
    expect(await tenantInstituteIdForCookie(cookieFor(sun.accountId, "owner", sun.email))).toBe(sunshineIid);
  });
});

describe("KID-199.3r login host gate", () => {
  it("a Sunshine account signing in on the Maple subdomain is refused with the owning daycare named", async () => {
    await seedMaple();
    const sun = await sunshineOwner();
    const gate = await loginHostGate(sun.accountId, "owner", `mapletree.${APEX}`);
    expect(gate).not.toBeNull();
    expect(gate!.error).toContain("Sunshine Daycare");
  });

  it("credentials are valid on their own subdomain, the apex, and legacy hosts", async () => {
    await seedMaple();
    const sun = await sunshineOwner();
    expect(await loginHostGate(sun.accountId, "owner", `sunshine-daycare.${APEX}`)).toBeNull();
    expect(await loginHostGate(sun.accountId, "owner", APEX)).toBeNull();
    expect(await loginHostGate(sun.accountId, "owner", "kiddy-one.vercel.app")).toBeNull();
  });

  it("the platform operator may sign in on any host", async () => {
    const maple = await seedMaple();
    const op = await operator();
    expect(await loginHostGate(op.accountId, "platform", `mapletree.${APEX}`)).toBeNull();
    void maple;
  });

  it("an unknown subdomain never leaks tenancy through the gate", async () => {
    await seedMaple();
    const sun = await sunshineOwner();
    expect(await loginHostGate(sun.accountId, "owner", `nope.${APEX}`)).toBeNull();
  });
});

describe("KID-199.3r branding follows the host", () => {
  it("anonymous branding on a subdomain is that tenant's (the leak fix)", async () => {
    const maple = await seedMaple();
    mockHeaders = { host: `mapletree.${APEX}` };
    const b = await getBranding();
    expect(b.name).toBe("Maple Tree Daycare");
    void maple;
  });

  it("unknown subdomains get neutral Kiddy defaults, never a tenant", async () => {
    await seedMaple();
    mockHeaders = { host: `nope.${APEX}` };
    expect((await getBranding()).name).toBe("Kiddy");
  });

  it("anonymous branding on the apex keeps the legacy first-institute fallback", async () => {
    await seedMaple();
    mockHeaders = { host: APEX };
    expect((await getBranding()).name).toBe("Sunshine Daycare");
  });
});
