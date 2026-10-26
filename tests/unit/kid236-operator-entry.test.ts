// KID-236: "Enter as admin" — one-click, audited platform-operator access
// into any daycare's own portal, with no per-tenant accounts (the board's
// rule). The rails pinned here, mirroring the ticket:
//
//   1. ONLY a platform operator can mint a grant — staff/parent/guest mint
//      attempts are refused before any grant exists (the real action, with
//      the session cookie mocked — the same harness kid169 documents).
//   2. The grant is single-use, <= 60s, bound to its institute: replay,
//      expiry, wrong-host, unknown-host, disabled-daycare and non-operator
//      consumption are all refused (the pure decision function, plus the
//      0025 unique index as the atomic gate).
//   3. The operator-view session is <= 60 min, refused after expiry, and
//      accepted ONLY for its bound institute on its own host — every
//      pre-existing resolution rule stays byte-for-byte (cross-tenant
//      fail-closed per KID-152/207, unknown-host neutral).
//   4. The audit trail records enter/exit/refused; refusal rows never carry
//      the nonce (a refused grant is never consumed).
//
// This repo's cross-tenant leak history (KID-152, KID-207) is why every
// refusal below is asserted as absence of data, not just a kind label.

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- request-scope mock: actions read cookies(), the tenant resolver reads
// headers; tests inject both per test instead of spinning a server. --------
const sessionCookie = { value: "" };
let mockHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (name === "kiddy_sess" ? sessionCookie : undefined) }),
  headers: () => ({
    get: (key: string) => mockHeaders[key.toLowerCase()] ?? null,
  }),
}));

import * as store from "@/lib/store";
import {
  createSessionToken,
  readSessionFromCookie,
  signToken,
  findAccountByEmail,
  type Session,
} from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import {
  OPERATOR_ENTRY_GRANT_TTL_MS,
  OPERATOR_VIEW_SESSION_TTL_MS,
  evaluateOperatorEntryGrant,
  mintOperatorEntryGrant,
  operatorViewSessionToken,
  readOperatorEntryGrant,
  recordPlatformAccess,
  type OperatorEntryGrant,
} from "@/lib/operator-view";
import { resolveRequestTenantFor, tenantInstituteIdForCookie } from "@/lib/tenant";
import { apexDomain, splitSubdomainHost } from "@/lib/subdomain";
import { seedFixture } from "../helpers";

const APEX = "daycare.test";
const OPERATOR_EMAIL = "superadmin@kiddy.test";
let sunshineIid: string;
let mapleIid: string;

function tokenFor(session: Session): string {
  // The bare value a cookies().get() reader sees (what server actions parse).
  return createSessionToken(session);
}

function cookieFor(session: Session): string {
  // The raw Cookie-header form the header-level session reader parses.
  return `kiddy_sess=${encodeURIComponent(tokenFor(session))}`;
}

function viewCookieFor(grant: OperatorEntryGrant): string {
  return `kiddy_sess=${encodeURIComponent(operatorViewSessionToken(grant))}`;
}

/** The second tenant, through the real platform path, so its subdomain and
 *  owner login match production shapes. */
async function seedMaple(): Promise<void> {
  const res = await store.createDaycare({
    name: "Maple Tree Daycare",
    subdomain: "mapletree",
    ownerEmail: "owner@mapletree.test",
    ownerPassword: "maple-owner-1",
    ownerFullName: "Maple Owner",
  });
  mapleIid = res.instituteId;
}

async function operatorSession(): Promise<Session> {
  const row = await queryGet("SELECT id, email, role FROM account WHERE email = ?", OPERATOR_EMAIL);
  return {
    accountId: String(row!.id),
    role: String(row!.role),
    email: String(row!.email),
    emailConfirmed: true,
  };
}

beforeEach(async () => {
  process.env.PUBLIC_APEX_DOMAIN = APEX;
  sessionCookie.value = "";
  mockHeaders = {};
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute WHERE name = 'Sunshine Daycare'"))!.id);
  // The seeded demo daycare ships without a web prefix (production gets one
  // from the operator); set it so the subdomain hosts resolve like prod.
  await store.setInstituteSubdomain(sunshineIid, "sunshine");
  await seedMaple();
});

describe("grant mint/read: signed, shaped, and single-purpose", () => {
  it("caps the grant at 60s and the view session at 60 minutes", () => {
    expect(OPERATOR_ENTRY_GRANT_TTL_MS).toBeLessThanOrEqual(60_000);
    expect(OPERATOR_VIEW_SESSION_TTL_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it("round-trips a minted grant bound to operator, institute and nonce", () => {
    const before = Date.now();
    const token = mintOperatorEntryGrant({ accountId: "acc-1", email: "Op@Example.test" }, sunshineIid);
    const grant = readOperatorEntryGrant(token);
    expect(grant).not.toBeNull();
    expect(grant!.kind).toBe("operator-entry");
    expect(grant!.operatorAccountId).toBe("acc-1");
    expect(grant!.operatorEmail).toBe("op@example.test");
    expect(grant!.instituteId).toBe(sunshineIid);
    expect(grant!.nonce).toMatch(/^[0-9a-f]{32}$/);
    const after = Date.now();
    expect(grant!.exp).toBeGreaterThan(before);
    expect(grant!.exp).toBeLessThanOrEqual(after + OPERATOR_ENTRY_GRANT_TTL_MS);
  });

  it("refuses tampered, foreign-kind and truncated tokens (fail closed)", () => {
    const token = mintOperatorEntryGrant({ accountId: "acc-1", email: "op@example.test" }, sunshineIid);
    const [body, sig] = token.split(".");
    const forged = `${body!.slice(0, -2)}XX.${sig}`;
    expect(readOperatorEntryGrant(forged)).toBeNull();
    expect(readOperatorEntryGrant(`${body}.${sig!.slice(0, -2)}XX`)).toBeNull();
    // A regular session token is not a grant.
    expect(readOperatorEntryGrant(createSessionToken({ accountId: "a", role: "staff", email: "e@x.test", emailConfirmed: true }))).toBeNull();
    expect(readOperatorEntryGrant("")).toBeNull();
    expect(readOperatorEntryGrant(null)).toBeNull();
    expect(readOperatorEntryGrant("not-a-token")).toBeNull();
  });
});

describe("evaluateOperatorEntryGrant: every refusal the ticket pins", () => {
  const NOW = 1_700_000_000_000;
  const baseGrant = {
    kind: "operator-entry" as const,
    operatorAccountId: "acc-op",
    operatorEmail: OPERATOR_EMAIL,
    instituteId: "",
    nonce: "a".repeat(32),
    exp: NOW + 60_000,
  };
  const okOpts = {
    hostInstituteId: "",
    institute: { active: 1 },
    operator: { role: "platform", email: OPERATOR_EMAIL },
    operatorEmailAllowlisted: true,
    nonceAlreadyUsed: false,
    nowMs: NOW,
  };

  it("accepts a fresh grant for its own host's enabled daycare", () => {
    const grant = { ...baseGrant, instituteId: sunshineIid };
    expect(evaluateOperatorEntryGrant(grant, { ...okOpts, hostInstituteId: sunshineIid })).toEqual({ ok: true });
  });

  it("refuses a malformed grant", () => {
    expect(evaluateOperatorEntryGrant(null, okOpts)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses expiry, fail-closed on the boundary", () => {
    const grant = { ...baseGrant, instituteId: sunshineIid };
    expect(
      evaluateOperatorEntryGrant(grant, { ...okOpts, hostInstituteId: sunshineIid, nowMs: grant.exp })
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      evaluateOperatorEntryGrant(grant, { ...okOpts, hostInstituteId: sunshineIid, nowMs: grant.exp + 1 })
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a grant consumed on another daycare's host — and on an unknown host", () => {
    const grant = { ...baseGrant, instituteId: sunshineIid };
    expect(
      evaluateOperatorEntryGrant(grant, { ...okOpts, hostInstituteId: mapleIid })
    ).toEqual({ ok: false, reason: "host-mismatch" });
    expect(
      evaluateOperatorEntryGrant(grant, { ...okOpts, hostInstituteId: null })
    ).toEqual({ ok: false, reason: "host-mismatch" });
    expect(
      evaluateOperatorEntryGrant(grant, { ...okOpts, hostInstituteId: "" })
    ).toEqual({ ok: false, reason: "host-mismatch" });
  });

  it("refuses consumption by a non-operator: gone account, wrong role, revoked email, or email mismatch", () => {
    const grant = { ...baseGrant, instituteId: sunshineIid };
    const host = { ...okOpts, hostInstituteId: sunshineIid };
    expect(evaluateOperatorEntryGrant(grant, { ...host, operator: null })).toEqual({
      ok: false,
      reason: "not-operator",
    });
    expect(
      evaluateOperatorEntryGrant(grant, {
        ...host,
        operator: { role: "staff", email: OPERATOR_EMAIL },
      })
    ).toEqual({ ok: false, reason: "not-operator" });
    expect(
      evaluateOperatorEntryGrant(grant, {
        ...host,
        operator: { role: "platform", email: OPERATOR_EMAIL },
        operatorEmailAllowlisted: false,
      })
    ).toEqual({ ok: false, reason: "not-operator" });
    expect(
      evaluateOperatorEntryGrant(grant, {
        ...host,
        operator: { role: "platform", email: "someone-else@kiddy.test" },
      })
    ).toEqual({ ok: false, reason: "not-operator" });
  });

  it("refuses a disabled daycare through the friendly path's reason", () => {
    const grant = { ...baseGrant, instituteId: sunshineIid };
    const host = { ...okOpts, hostInstituteId: sunshineIid };
    expect(
      evaluateOperatorEntryGrant(grant, { ...host, institute: { active: 0 } })
    ).toEqual({ ok: false, reason: "disabled" });
    expect(
      evaluateOperatorEntryGrant(grant, { ...host, institute: null })
    ).toEqual({ ok: false, reason: "missing-institute" });
  });

  it("refuses a replayed grant", () => {
    const grant = { ...baseGrant, instituteId: sunshineIid };
    expect(
      evaluateOperatorEntryGrant(grant, { ...okOpts, hostInstituteId: sunshineIid, nonceAlreadyUsed: true })
    ).toEqual({ ok: false, reason: "replay" });
  });
});

describe("the 0025 audit table is the atomic single-use gate", () => {
  it("records enter/exit/refused and refuses a second enter with the same nonce", async () => {
    const nonce = "b".repeat(32);
    expect(
      await recordPlatformAccess({ event: "enter", operatorEmail: OPERATOR_EMAIL, instituteId: sunshineIid, nonce })
    ).toBe(true);
    // Replay: the unique index wins, the caller learns false — never a throw.
    expect(
      await recordPlatformAccess({ event: "enter", operatorEmail: OPERATOR_EMAIL, instituteId: sunshineIid, nonce })
    ).toBe(false);
    // A different grant (new nonce) still enters.
    expect(
      await recordPlatformAccess({ event: "enter", operatorEmail: OPERATOR_EMAIL, instituteId: mapleIid, nonce: "c".repeat(32) })
    ).toBe(true);
    // Exit and refused rows carry no nonce and never collide.
    expect(
      await recordPlatformAccess({ event: "exit", operatorEmail: OPERATOR_EMAIL, instituteId: sunshineIid })
    ).toBe(true);
    expect(
      await recordPlatformAccess({ event: "refused", operatorEmail: OPERATOR_EMAIL, instituteId: sunshineIid, detail: "expired" })
    ).toBe(true);

    const rows = await queryGet(
      "SELECT COUNT(*) AS c FROM platform_access_log WHERE event = 'enter' AND nonce = ?",
      nonce
    );
    expect(Number(rows!.c)).toBe(1);
  });

  it("keeps operator email and institute on every enter row (the audit record)", async () => {
    const nonce = "d".repeat(32);
    await recordPlatformAccess({ event: "enter", operatorEmail: OPERATOR_EMAIL, instituteId: sunshineIid, nonce });
    const row = await queryGet("SELECT * FROM platform_access_log WHERE event = 'enter' AND nonce = ?", nonce);
    expect(String(row!.operator_email)).toBe(OPERATOR_EMAIL);
    expect(String(row!.institute_id)).toBe(sunshineIid);
    expect(String(row!.created_at)).toBeTruthy();
  });
});

describe("operator-view session: reads back as this daycare's admin, only while fresh", () => {
  it("carries the marker and the effective admin role, capped at 60 minutes", () => {
    const grant = readOperatorEntryGrant(mintOperatorEntryGrant({ accountId: "acc-op", email: OPERATOR_EMAIL }, sunshineIid))!;
    const before = Date.now();
    const token = operatorViewSessionToken(grant);
    const after = Date.now();
    const session = readSessionFromCookie(`kiddy_sess=${encodeURIComponent(token)}`);
    expect(session).not.toBeNull();
    expect(session!.accountId).toBe("acc-op");
    expect(session!.email).toBe(OPERATOR_EMAIL);
    // Effective role: the daycare's admin — the operator can actually use the
    // daycare's admin surfaces during the view.
    expect(session!.role).toBe("admin");
    expect(session!.operatorViewInstituteId).toBe(sunshineIid);
    // Token expiry honours the 60-minute cap exactly: TTL measured from the
    // token's own mint moment (between `before` and `after`).
    const data = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString());
    expect(data.exp).toBeGreaterThanOrEqual(before + OPERATOR_VIEW_SESSION_TTL_MS);
    expect(data.exp).toBeLessThanOrEqual(after + OPERATOR_VIEW_SESSION_TTL_MS);
  });

  it("is refused after expiry", () => {
    // The exact payload the entry route mints, with the clock wound past the
    // 60-minute window — the session reader must return null.
    const expired = signToken({
      accountId: "acc-op",
      role: "platform",
      email: OPERATOR_EMAIL,
      emailConfirmed: true,
      operatorViewInstituteId: sunshineIid,
      exp: Date.now() - 1000,
    });
    expect(readSessionFromCookie(`kiddy_sess=${encodeURIComponent(expired)}`)).toBeNull();
  });

  it("the marker never leaks into a long-lived regular session token", () => {
    // createSessionToken strips the marker: no code path can mint a 30-day
    // operator-view token through the regular session helpers.
    const token = createSessionToken({
      accountId: "acc-op",
      role: "platform",
      email: OPERATOR_EMAIL,
      emailConfirmed: true,
      operatorViewInstituteId: sunshineIid,
    });
    const session = readSessionFromCookie(`kiddy_sess=${encodeURIComponent(token)}`);
    expect(session!.role).toBe("platform");
    expect(session!.operatorViewInstituteId).toBeUndefined();
  });

  it("a marker without the platform sentinel role is ignored, not honored", () => {
    // Even a correctly-signed token cannot conjure operator view by pairing a
    // marker with a daycare role — it degrades to the ordinary session rules.
    const forged = signToken({
      accountId: "acc-staff",
      role: "staff",
      email: "staff@sunshinedaycare.test",
      emailConfirmed: true,
      operatorViewInstituteId: sunshineIid,
      exp: Date.now() + 60_000,
    });
    const session = readSessionFromCookie(`kiddy_sess=${encodeURIComponent(forged)}`);
    expect(session!.role).toBe("staff");
    expect(session!.operatorViewInstituteId).toBeUndefined();
  });
});

describe("tenant resolution accepts an operator-view session only on its bound host", () => {
  it("serves the bound daycare on its own host", async () => {
    const grant = readOperatorEntryGrant(mintOperatorEntryGrant({ accountId: "acc-op", email: OPERATOR_EMAIL }, sunshineIid))!;
    const session = readSessionFromCookie(viewCookieFor(grant));
    const rt = await resolveRequestTenantFor(viewCookieFor(grant), `sunshine.${APEX}`);
    expect(rt).toEqual({ kind: "host", instituteId: sunshineIid });
    expect(session!.operatorViewInstituteId).toBe(sunshineIid);
  });

  it("fail-closes as cross-tenant on a second daycare's host", async () => {
    const grant = readOperatorEntryGrant(mintOperatorEntryGrant({ accountId: "acc-op", email: OPERATOR_EMAIL }, sunshineIid))!;
    const rt = await resolveRequestTenantFor(viewCookieFor(grant), `mapletree.${APEX}`);
    expect(rt).toEqual({ kind: "cross-tenant", instituteId: "" });
  });

  it("an unknown subdomain stays unknown-host, marker or not", async () => {
    const grant = readOperatorEntryGrant(mintOperatorEntryGrant({ accountId: "acc-op", email: OPERATOR_EMAIL }, sunshineIid))!;
    expect(await resolveRequestTenantFor(viewCookieFor(grant), `nope.${APEX}`)).toEqual({
      kind: "unknown-host",
      instituteId: "",
    });
  });

  it("resolves NO tenant on the apex or any generic host (fail closed)", async () => {
    const grant = readOperatorEntryGrant(mintOperatorEntryGrant({ accountId: "acc-op", email: OPERATOR_EMAIL }, sunshineIid))!;
    expect(await tenantInstituteIdForCookie(viewCookieFor(grant))).toBe("");
    expect(await resolveRequestTenantFor(viewCookieFor(grant), APEX)).toEqual({
      kind: "generic",
      instituteId: "",
    });
    expect(splitSubdomainHost(`sunshine.${APEX}`).kind).toBe("subdomain");
  });

  it("every pre-existing rule stays byte-for-byte (staff, operator, anonymous)", async () => {
    // A real sunshine admin session: host on its own subdomain, cross-tenant
    // on the second daycare's host — the KID-152/207 fail-closed rule.
    const owner = await findAccountByEmail("admin@sunshinedaycare.test");
    const ownerCookie = cookieFor({
      accountId: String(owner!.id),
      role: "admin",
      email: String(owner!.email),
      emailConfirmed: true,
    });
    expect(await resolveRequestTenantFor(ownerCookie, `sunshine.${APEX}`)).toEqual({
      kind: "host",
      instituteId: sunshineIid,
    });
    expect(await resolveRequestTenantFor(ownerCookie, `mapletree.${APEX}`)).toEqual({
      kind: "cross-tenant",
      instituteId: "",
    });
    // Anonymous visitors see the host's tenant.
    expect(await resolveRequestTenantFor(null, `mapletree.${APEX}`)).toEqual({
      kind: "host",
      instituteId: mapleIid,
    });
    // The operator's REAL apex session on a subdomain keeps today's behavior.
    const op = await operatorSession();
    expect(await resolveRequestTenantFor(cookieFor(op), `mapletree.${APEX}`)).toEqual({
      kind: "host",
      instituteId: mapleIid,
    });
    // Apex configured, apex host resolves generically for the operator.
    expect(apexDomain()).toBe(APEX);
    expect(await resolveRequestTenantFor(cookieFor(op), APEX)).toEqual({
      kind: "generic",
      instituteId: "",
    });
  });
});

describe("only a platform operator can mint a grant (the real action, cookie-mocked)", () => {
  async function redirectTargetFor(form: FormData): Promise<string> {
    const { enterDaycareAsAdminAction } = await import("@/lib/actions");
    try {
      await enterDaycareAsAdminAction(form);
      return "";
    } catch (err) {
      const digest = String((err as { digest?: unknown })?.digest ?? "");
      if (digest.startsWith("NEXT_REDIRECT")) {
        // NEXT_REDIRECT;<type>;<url>;<status>
        return digest.split(";")[2] ?? "";
      }
      throw err;
    }
  }

  function formFor(instituteId: string): FormData {
    const form = new FormData();
    form.set("instituteId", instituteId);
    return form;
  }

  it("the operator's mint 302s to the daycare's own subdomain with a single-use grant", async () => {
    sessionCookie.value = tokenFor(await operatorSession());
    const target = await redirectTargetFor(formFor(sunshineIid));
    expect(target).toMatch(new RegExp(`^https://sunshine\\.${APEX}/operator-entry\\?grant=`));
    const grant = readOperatorEntryGrant(
      new URL(target).searchParams.get("grant")
    );
    expect(grant).not.toBeNull();
    expect(grant!.instituteId).toBe(sunshineIid);
    expect(grant!.operatorEmail).toBe(OPERATOR_EMAIL);
  });

  it("a staff mint attempt is refused to /login before any grant exists", async () => {
    const staff = await findAccountByEmail("admin@sunshinedaycare.test");
    sessionCookie.value = tokenFor({
      accountId: String(staff!.id),
      role: "admin",
      email: String(staff!.email),
      emailConfirmed: true,
    });
    const target = await redirectTargetFor(formFor(sunshineIid));
    expect(target).toBe("/login");
  });

  it("a parent mint attempt is refused the same way", async () => {
    const parent = await findAccountByEmail("parent@example.test");
    sessionCookie.value = tokenFor({
      accountId: String(parent!.id),
      role: "parent",
      email: String(parent!.email),
      emailConfirmed: true,
    });
    const target = await redirectTargetFor(formFor(sunshineIid));
    expect(target).toBe("/login");
  });

  it("an anonymous mint attempt is refused", async () => {
    sessionCookie.value = "";
    const target = await redirectTargetFor(formFor(sunshineIid));
    expect(target).toBe("/login");
  });

  it("an operator whose email left the allowlist is refused too", async () => {
    sessionCookie.value = tokenFor(await operatorSession());
    delete process.env.PLATFORM_ADMIN_EMAIL;
    delete process.env.SUPERADMIN_EMAIL;
    try {
      // The seeded operator's email is on the default allowlist only via the
      // demo fallback — stub a different operator email to simulate revocation.
      process.env.PLATFORM_ADMIN_EMAIL = "someone-else@kiddy.test";
      const target = await redirectTargetFor(formFor(sunshineIid));
      expect(target).toBe("/login");
    } finally {
      delete process.env.PLATFORM_ADMIN_EMAIL;
    }
  });

  it("a disabled daycare refuses at the platform page with the friendly message", async () => {
    sessionCookie.value = tokenFor(await operatorSession());
    await store.setInstituteActive(sunshineIid, false);
    const target = await redirectTargetFor(formFor(sunshineIid));
    expect(target).toBe("/platform?error=enter-disabled");
    // And no grant was minted that could bypass it.
    expect(target).not.toContain("grant=");
  });

  it("a daycare without a web prefix refuses instead of minting a dead grant", async () => {
    sessionCookie.value = tokenFor(await operatorSession());
    // The store derives a slug whenever the name produces one, so a NULL
    // prefix needs a name with no Latin slug at all — exactly how a real
    // daycare can end up without a web address.
    const res = await store.createDaycare({
      name: "روضة النور",
      ownerEmail: "owner@noaddress.test",
      ownerPassword: "no-address-1",
      ownerFullName: "No Address Owner",
    });
    expect(String((await queryGet("SELECT subdomain FROM institute WHERE id = ?", res.instituteId))!.subdomain ?? "")).toBe("");
    const target = await redirectTargetFor(formFor(res.instituteId));
    expect(target).toBe("/platform?error=enter-no-address");
  });
});
