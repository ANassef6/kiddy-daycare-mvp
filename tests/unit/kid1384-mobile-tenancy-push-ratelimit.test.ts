// KID-1384: two findings from KID-1372, fixed and pinned.
//
//   1. Mobile login billing parity: web login blocks a tenancy-disabled
//      daycare (manual disable or billing block — lib/actions.ts
//      tenancyDisabledError, KID-199.3/KID-245). POST /api/mobile/login
//      echoed that gate only in spirit: it authenticated and minted a token
//      with no tenancy check at all. It now refuses BEFORE any token, with
//      the same EN/AR wording, no invoice/tenant details, and the platform
//      operator exemption preserved.
//   2. Push unsubscribe rate limit: POST on /api/push/subscribe had the
//      KID-1178 per-account budget but DELETE did not, so remove churn was
//      unbounded. DELETE now rides the SAME "pushSubscribe" bucket as POST,
//      returning the existing 429 + Retry-After shape.
//
// Harness mirrors kid1178/kid245: next/headers has no request scope under
// vitest, so cookies()/headers() are mocked and the DB is the suite's own
// seeded SQLite copy (Sunshine fixture).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryGet, queryRun, type Row } from "@/lib/db";
import { seedFixture } from "../helpers";
import { _resetRateLimitForTests } from "@/lib/rate-limit";

let mockCookies: Record<string, string> = {};
let mockHeaders = new Headers();

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (mockCookies[name] ? { name, value: mockCookies[name] } : undefined),
    set: () => undefined,
  }),
  headers: () => mockHeaders,
}));

beforeEach(async () => {
  vi.unstubAllEnvs();
  _resetRateLimitForTests();
  mockCookies = {};
  mockHeaders = new Headers();
  await seedFixture();
});

async function sunshine(): Promise<Row> {
  const inst = await queryGet("SELECT * FROM institute ORDER BY created_at LIMIT 1");
  if (!inst) throw new Error("seedFixture: no institute");
  return inst;
}

function mobileLogin(email: string, password: string): NextRequest {
  return new NextRequest("https://kiddy.example/api/mobile/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.90" },
    body: JSON.stringify({ email, password }),
  });
}

async function callMobileLogin(email: string, password: string) {
  const { POST } = await import("@/app/api/mobile/login/route");
  const res = await POST(mobileLogin(email, password));
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { res, body };
}

async function overdueInvoiceFor(instituteId: string): Promise<void> {
  await queryRun(
    `INSERT INTO daycare_invoice
       (id, institute_id, cycle_month, plan, max_active_children, billable_children,
        flat_rate_amount, incremental_rate, incremental_amount, total_amount, currency,
        due_date, status)
     VALUES ('inv-kid1384', ?, '2026-10', 'monthly', 12, 2, 500, 50, 100, 600, 'EGP',
             '2026-11-05', 'overdue')`,
    instituteId
  );
}

describe("POST /api/mobile/login enforces the tenancy billing block (KID-1384)", () => {
  const ADMIN_EMAIL = "trois4ever+admin@gmail.com";
  const ADMIN_PW = "kiddy-admin";

  it("an ACTIVE daycare logs in on mobile (no regression to the happy path)", async () => {
    const { res, body } = await callMobileLogin(ADMIN_EMAIL, ADMIN_PW);
    expect(res.status).toBe(200);
    expect(String(body?.["token"] ?? "")).toBeTruthy();
    expect(body?.["error"]).toBeUndefined();
  });

  it("a billing-blocked daycare (all-institute disabled + overdue invoice) is refused with a token withheld", async () => {
    const iid = String((await sunshine()).id);
    await overdueInvoiceFor(iid);
    await queryRun("UPDATE institute SET active = 0 WHERE id = ?", iid);

    const { res, body } = await callMobileLogin(ADMIN_EMAIL, ADMIN_PW);
    expect(res.status).toBe(403);
    const message = String(body?.["error"] ?? "");
    expect(message).toContain("temporarily blocked due to an overdue invoice");
    // No token, and no invoice/tenant details leak past the user-facing gate
    // wording (KID-245 text + platform contact inbox only).
    expect(body?.["token"]).toBeUndefined();
    expect(message).not.toContain("inv-kid1384");
    expect(message).not.toContain(iid);
  });

  it("a MANUALLY disabled daycare (no overdue invoice) is refused with the generic disable message", async () => {
    const iid = String((await sunshine()).id);
    await queryRun("UPDATE institute SET active = 0 WHERE id = ?", iid);

    const { res, body } = await callMobileLogin(ADMIN_EMAIL, ADMIN_PW);
    expect(res.status).toBe(403);
    const message = String(body?.["error"] ?? "");
    expect(message).toContain("This daycare is currently disabled.");
    expect(message).not.toContain("overdue invoice");
  });

  it("the gate follows the kiddy_lang cookie for its wording (kiddy_lang=ar)", async () => {
    const iid = String((await sunshine()).id);
    await overdueInvoiceFor(iid);
    await queryRun("UPDATE institute SET active = 0 WHERE id = ?", iid);
    mockCookies["kiddy_lang"] = "ar";

    const { res, body } = await callMobileLogin(ADMIN_EMAIL, ADMIN_PW);
    expect(res.status).toBe(403);
    expect(String(body?.["error"] ?? "")).toContain("مؤقتًا");
  });

  it("the account's own language preference is honored when no cookie is set", async () => {
    const iid = String((await sunshine()).id);
    await overdueInvoiceFor(iid);
    await queryRun("UPDATE institute SET active = 0 WHERE id = ?", iid);
    await queryRun("UPDATE account SET language = 'ar' WHERE email = ?", ADMIN_EMAIL);

    const { res, body } = await callMobileLogin(ADMIN_EMAIL, ADMIN_PW);
    expect(res.status).toBe(403);
    expect(String(body?.["error"] ?? "")).toContain("مؤقتًا");
  });

  it("a platform operator passes even while every daycare is disabled", async () => {
    await queryRun("UPDATE institute SET active = 0");
    const op = await createAccount({
      email: "kid1384-operator@example.test",
      password: "operator-pw",
      fullName: "Platform Operator",
      role: "platform",
    });

    const { res, body } = await callMobileLogin("kid1384-operator@example.test", "operator-pw");
    expect(res.status).toBe(200);
    expect(String(body?.["token"] ?? "")).toBeTruthy();
    expect(String((op as Row).role)).toBe("platform");
  });

  it("a token minted on a healthy account still works — the gate is a refusal, not a mangler", async () => {
    const { res, body } = await callMobileLogin(ADMIN_EMAIL, ADMIN_PW);
    expect(res.status).toBe(200);
    expect(Object.keys(body ?? {}).sort()).toEqual(["account", "token"]);
  });

  it("a billing-disabled refusal stays 403 across repeats (never a 429, never a 200)", async () => {
    // A verified password for a disabled tenant is refused UNIFORMLY — the
    // gate must not feed the failure lockout (the credentials are right, the
    // tenant is the problem) and must never leak a token either.
    const iid = String((await sunshine()).id);
    await queryRun("UPDATE institute SET active = 0 WHERE id = ?", iid);

    for (let i = 0; i < 5; i++) {
      const { res } = await callMobileLogin(ADMIN_EMAIL, ADMIN_PW);
      expect(res.status).toBe(403);
    }
  });
});

describe("DELETE /api/push/subscribe rides the same per-account budget (KID-1384)", () => {
  const DUMMY = { endpoint: "https://push.test/kid1384-device", keys: { p256dh: "k", auth: "a" } };

  async function sessionCookie(role = "parent"): Promise<string> {
    const acc = await createAccount({
      email: `kid1384-push-${role}-${Math.random().toString(36).slice(2)}@example.test`,
      password: "push-pw",
      fullName: "Push User",
      role,
    });
    const token = createSessionToken({
      accountId: String((acc as Row).id),
      role: String((acc as Row).role),
      email: String((acc as Row).email),
      emailConfirmed: true,
    });
    mockCookies["kiddy_sess"] = token;
    return String((acc as Row).id);
  }

  function del(): NextRequest {
    return new NextRequest("https://kiddy.example/api/push/subscribe", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: DUMMY.endpoint }),
    });
  }

  function post(): NextRequest {
    return new NextRequest("https://kiddy.example/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(DUMMY),
    });
  }

  it("the 21st UNSUBSCRIBE inside the window is refused with 429 + Retry-After", async () => {
    await sessionCookie();
    const { DELETE } = await import("@/app/api/push/subscribe/route");

    let ok200 = 0;
    for (let i = 0; i < 20; i++) {
      const res = await DELETE(del());
      if (res.status === 200) ok200 += 1;
      else throw new Error(`call ${i} refused early (status ${res.status})`);
    }
    expect(ok200).toBe(20);

    const limited = await DELETE(del());
    expect(limited.status).toBe(429);
    expect(String(limited.headers.get("retry-after") ?? "")).toBeTruthy();
    const body = (await limited.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("rate_limited");
  });

  it("POST + DELETE share ONE bucket: 15 subscribe + 5 unsubscribe leaves the next POST 429'd", async () => {
    await sessionCookie();
    const mod = await import("@/app/api/push/subscribe/route");

    for (let i = 0; i < 15; i++) expect((await mod.POST(post())).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await mod.DELETE(del())).status).toBe(200);
    expect((await mod.POST(post())).status).toBe(429);
  });

  it("unauthenticated DELETE is 401 — the budget never replaces the auth check", async () => {
    mockCookies = {};
    const { DELETE } = await import("@/app/api/push/subscribe/route");
    expect((await DELETE(del())).status).toBe(401);
  });
});
