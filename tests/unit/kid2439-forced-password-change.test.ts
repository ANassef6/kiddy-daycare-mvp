// KID-2439: forced password change for temporary/reset passwords.
//
// Pins the minimal forced flow:
//   1. loginAction sends a flagged account straight to /change-password,
//   2. changePasswordAction refuses a new password equal to the current one,
//   3. a successful forced change clears must_change_password (so the gate
//      opens), and the action returns to the forced screen with status,
//   4. the mobile login response advertises the flag to app clients.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, createSessionToken, findAccountByEmail, getAccount, mustChangePasswordFor, verifyPassword } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { _resetRateLimitForTests } from "@/lib/rate-limit";
import { seedFixture } from "../helpers";

let mockCookies: Record<string, string> = {};
let mockHeaders = new Headers();

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (mockCookies[name] ? { name, value: mockCookies[name] } : undefined),
    set: () => undefined,
  }),
  headers: () => mockHeaders,
}));

function signIn(accountId: string, role: string, email: string) {
  mockCookies.kiddy_sess = createSessionToken({ accountId, role, email, emailConfirmed: true });
}

function form(...pairs: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of pairs) fd.set(k, v);
  return fd;
}

async function redirectTarget(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (err) {
    const digest = String((err as { digest?: unknown })?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw err;
  }
}

let iid: string;

beforeEach(async () => {
  vi.unstubAllEnvs();
  _resetRateLimitForTests();
  mockCookies = {};
  mockHeaders = new Headers({ "x-forwarded-for": "203.0.113.91" });
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
});

describe("KID-2439 forced password change", () => {
  it("loginAction routes a flagged account to /change-password before any app page", async () => {
    await createAccount({
      email: "forced-login@sunshine.example",
      password: "temp-pass-1",
      fullName: "Forced Login",
      role: "staff",
      mustChangePassword: true,
    });
    const { loginAction } = await import("@/lib/actions");
    const target = await redirectTarget(() => loginAction(form(["email", "forced-login@sunshine.example"], ["password", "temp-pass-1"])));
    expect(target).toBe("/change-password");
  });

  it("loginAction keeps the normal home page for an unflagged account", async () => {
    await createAccount({
      email: "normal-login@sunshine.example",
      password: "normal-pass-1",
      fullName: "Normal Login",
      role: "staff",
    });
    const { loginAction } = await import("@/lib/actions");
    const target = await redirectTarget(() => loginAction(form(["email", "normal-login@sunshine.example"], ["password", "normal-pass-1"])));
    expect(target).toBe("/portal/dashboard");
  });

  it("refuses a new password equal to the current one and leaves the flag on", async () => {
    const account = await createAccount({
      email: "same-pass@sunshine.example",
      password: "same-pass-1",
      fullName: "Same Pass",
      role: "staff",
      mustChangePassword: true,
    });
    signIn(String(account.id), "staff", "same-pass@sunshine.example");
    const { changePasswordAction } = await import("@/lib/actions");
    const target = await redirectTarget(() =>
      changePasswordAction(form(["currentPassword", "same-pass-1"], ["newPassword", "same-pass-1"], ["confirmPassword", "same-pass-1"]))
    );
    expect(target).toBe("/change-password?pw=same");
    const after = await getAccount(String(account.id));
    expect(mustChangePasswordFor(after)).toBe(true);
    expect(verifyPassword("same-pass-1", String(after!.password_hash))).toBe(true);
  });

  it("a successful forced change clears the flag and returns to the forced screen", async () => {
    const account = await createAccount({
      email: "rotate-pass@sunshine.example",
      password: "temp-pass-1",
      fullName: "Rotate Pass",
      role: "staff",
      mustChangePassword: true,
    });
    signIn(String(account.id), "staff", "rotate-pass@sunshine.example");
    const { changePasswordAction } = await import("@/lib/actions");
    const target = await redirectTarget(() =>
      changePasswordAction(form(["currentPassword", "temp-pass-1"], ["newPassword", "rotated-pass-9"], ["confirmPassword", "rotated-pass-9"]))
    );
    expect(target).toBe("/change-password?pw=changed");
    const after = await getAccount(String(account.id));
    expect(mustChangePasswordFor(after)).toBe(false);
    expect(verifyPassword("rotated-pass-9", String(after!.password_hash))).toBe(true);
    expect(verifyPassword("temp-pass-1", String(after!.password_hash))).toBe(false);
  });

  it("mobile login advertises mustChangePassword for flagged accounts", async () => {
    await createAccount({
      email: "mobile-forced@sunshine.example",
      password: "temp-pass-1",
      fullName: "Mobile Forced",
      role: "staff",
      mustChangePassword: true,
    });
    const { POST } = await import("@/app/api/mobile/login/route");
    const { NextRequest } = await import("next/server");
    const res = await POST(
      new NextRequest("https://kiddy.example/api/mobile/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.92" },
        body: JSON.stringify({ email: "mobile-forced@sunshine.example", password: "temp-pass-1" }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { account: { mustChangePassword?: boolean } };
    expect(body.account.mustChangePassword).toBe(true);
    expect(mustChangePasswordFor(await findAccountByEmail("mobile-forced@sunshine.example"))).toBe(true);
  });
});
