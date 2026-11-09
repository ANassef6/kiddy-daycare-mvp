// KID-1178/F-06: the auth surfaces actually enforce the budgets end-to-end.
// loginAction (web) and POST /api/mobile/login must both:
//  1. count verified failures toward a per-account progressive lockout,
//  2. refuse an already-locked account even with CORRECT credentials, saying
//     only that the limit is reached (never whether the account exists),
//  3. keep normal users unaffected (a success clears the counter; a different
//     account from the same secretary IP stays usable).
// The harness mirrors kid238/kid245: next/headers has no request scope under
// vitest, so cookies()/headers() are mocked and the DB is the suite's own
// seeded SQLite copy.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSessionToken } from "@/lib/auth";
import { createAccount, findAccountByEmail } from "@/lib/auth";
import { queryRun } from "@/lib/db";
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
  mockHeaders = new Headers({ "x-forwarded-for": "203.0.113.50" });
  await seedFixture();
});

function loginForm(email: string, password: string): FormData {
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  return form;
}

async function callLogin(email: string, password: string): Promise<{ error?: string } | { redirected: true }> {
  const { loginAction } = await import("@/lib/actions");
  try {
    const result = (await loginAction(loginForm(email, password))) as { error?: string };
    return result;
  } catch (err) {
    const digest = String((err as { digest?: unknown })?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return { redirected: true };
    throw err;
  }
}

function mobileRequest(email: string, password: string, ip = "203.0.113.77"): NextRequest {
  return new NextRequest("https://kiddy.example/api/mobile/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ email, password }),
  });
}

async function callMobileLogin(email: string, password: string, ip?: string) {
  const { POST } = await import("@/app/api/mobile/login/route");
  const res = await POST(mobileRequest(email, password, ip));
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    body = null;
  }
  return { res, body: body as Record<string, unknown> | null };
}

describe("loginAction keeps the brute-force gates", () => {
  it("counts verified failures and locks the account, refusing correct credentials while locked", async () => {
    const email = "locktarget@example.test";
    await createAccount({ email, password: "correct-pw", fullName: "Locked Target", role: "owner" });

    for (let i = 0; i < 5; i++) {
      const result = await callLogin(email, "wrong-password");
      expect(result, `failure ${i} refused with the uniform invalid message`).toHaveProperty(
        "error"
      );
      expect((result as { error?: string }).error).not.toContain("rate");
    }

    const locked = await callLogin(email, "correct-pw");
    expect(locked).toHaveProperty("error");
    const message = (locked as { error?: string }).error ?? "";
    expect(message.toLowerCase()).toContain("too many attempts");
    // Uniform: the lockout message names no account state beyond the limit.
    expect(message).not.toContain(email);
  });

  it("keeps a different account on the same IP usable while one account is locked", async () => {
    const victim = "lockvictim@example.test";
    await createAccount({ email: victim, password: "correct-pw", fullName: "Victim", role: "staff" });
    const colleague = "colleague@example.test";
    await createAccount({ email: colleague, password: "correct-pw", fullName: "Colleague", role: "staff" });

    for (let i = 0; i < 5; i++) {
      expect(await callLogin(victim, "wrong-password")).toHaveProperty("error");
    }
    expect(await callLogin(victim, "correct-pw")).toHaveProperty("error");

    // The colleague logs in through the exact same IP — the redirect throws
    // NEXT_REDIRECT on success, which the harness maps to { redirected: true }.
    const ok = await callLogin(colleague, "correct-pw");
    expect(ok).toEqual({ redirected: true });
  });

  it("a successful login clears the account counter (normal users are never punished)", async () => {
    const email = "recovering@example.test";
    await createAccount({ email, password: "correct-pw", fullName: "Recovering", role: "owner" });

    for (let i = 0; i < 4; i++) {
      expect(await callLogin(email, "oops-nearly-there")).toHaveProperty("error");
    }
    const ok = await callLogin(email, "correct-pw");
    expect(ok).toEqual({ redirected: true });

    for (let i = 0; i < 4; i++) {
      expect(await callLogin(email, "more-typo-failures")).toHaveProperty("error");
    }
    // Still under the threshold — the 4th verified failure of the fresh window
    // does NOT trigger the 5-failure lockout.
    expect(await callLogin(email, "correct-pw")).toEqual({ redirected: true });
  });
});

describe("POST /api/mobile/login keeps the brute-force gates", () => {
  it("throttles failures into a 429 with Retry-After, then refuses correct credentials", async () => {
    const email = "mobilelock@example.test";
    await createAccount({ email, password: "correct-pw", fullName: "Mobile Target", role: "owner" });

    for (let i = 0; i < 5; i++) {
      const { res } = await callMobileLogin(email, "wrong-password");
      expect(res.status).toBe(401);
    }
    const locked = await callMobileLogin(email, "correct-pw");
    expect(locked.res.status).toBe(429);
    expect(String(locked.res.headers.get("retry-after") ?? "")).toBeTruthy();
    expect(String(locked.body?.["error"] ?? "").toLowerCase()).toContain("too many attempts");
  });

  it("fires 429 once one IP's attempt budget is exhausted (distinct emails, so no account-lockout race)", async () => {
    // 30 distinct addresses (none of them real accounts — findAccountByEmail
    // misses stay cheap) ride the same IP through the attempt budget; the
    // 31st call from that IP is refused before any credential work.
    const ip = "198.51.100.201";
    for (let i = 0; i < 30; i++) {
      const { res } = await callMobileLogin(`ipprobe${i}@example.test`, "whatever", ip);
      expect(res.status).toBe(401);
    }
    const blocked = await callMobileLogin("ipprobe-final@example.test", "whatever", ip);
    expect(blocked.res.status).toBe(429);
    expect(String(blocked.body?.["error"] ?? "").toLowerCase()).toContain("too many attempts");
  }, 30_000);
});
