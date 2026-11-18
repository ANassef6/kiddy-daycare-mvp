// KID-2439: the mobile leg of the forced password change.
//
// The founder requirement covers web AND mobile. These tests pin the server
// contract the app relies on:
//   1. a flagged session cannot read family data on any mobile endpoint,
//   2. the change-password endpoint refuses a wrong current password, a short
//      password, and a "new" password equal to the current one,
//   3. a successful change rotates the hash, clears the flag, and re-opens the
//      normal mobile payload.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAccount,
  createSessionToken,
  getAccount,
  mustChangePasswordFor,
  verifyPassword,
} from "@/lib/auth";
import { _resetRateLimitForTests } from "@/lib/rate-limit";
import { seedFixture } from "../helpers";

function tokenFor(email: string, accountId: string, role = "parent"): string {
  return createSessionToken({ accountId, role, email, emailConfirmed: true });
}

beforeEach(async () => {
  vi.unstubAllEnvs();
  _resetRateLimitForTests();
  await seedFixture();
});

async function bootstrapRequest(token: string) {
  const { GET } = await import("@/app/api/mobile/bootstrap/route");
  const { NextRequest } = await import("next/server");
  return GET(
    new NextRequest("https://kiddy.example/api/mobile/bootstrap", {
      headers: { authorization: `Bearer ${token}`, "x-forwarded-for": "203.0.113.77" },
    })
  );
}

async function changeRequest(token: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/mobile/change-password/route");
  const { NextRequest } = await import("next/server");
  return POST(
    new NextRequest("https://kiddy.example/api/mobile/change-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-forwarded-for": "203.0.113.78",
      },
      body: JSON.stringify(body),
    })
  );
}

describe("KID-2439 mobile forced password change", () => {
  it("blocks mobile family data while the temporary password is active", async () => {
    const account = await createAccount({
      email: "mobile-gate@sunshine.example",
      password: "temp-pass-1",
      fullName: "Mobile Gate",
      role: "parent",
      mustChangePassword: true,
    });
    const token = tokenFor("mobile-gate@sunshine.example", String(account.id));
    const res = await bootstrapRequest(token);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("password_change_required");
  });

  it("refuses the current password as the replacement", async () => {
    const account = await createAccount({
      email: "mobile-same@sunshine.example",
      password: "temp-pass-1",
      fullName: "Mobile Same",
      role: "parent",
      mustChangePassword: true,
    });
    const token = tokenFor("mobile-same@sunshine.example", String(account.id));
    const res = await changeRequest(token, {
      currentPassword: "temp-pass-1",
      newPassword: "temp-pass-1",
      confirmPassword: "temp-pass-1",
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code?: string }).code).toBe("password_unchanged");
    const after = await getAccount(String(account.id));
    expect(mustChangePasswordFor(after)).toBe(true);
    expect(verifyPassword("temp-pass-1", String(after!.password_hash))).toBe(true);
  });

  it("refuses a wrong current password and a short replacement", async () => {
    const account = await createAccount({
      email: "mobile-bad@sunshine.example",
      password: "temp-pass-1",
      fullName: "Mobile Bad",
      role: "parent",
      mustChangePassword: true,
    });
    const token = tokenFor("mobile-bad@sunshine.example", String(account.id));

    const wrong = await changeRequest(token, {
      currentPassword: "not-the-password",
      newPassword: "brand-new-pass",
      confirmPassword: "brand-new-pass",
    });
    expect(wrong.status).toBe(422);
    expect(((await wrong.json()) as { code?: string }).code).toBe("wrong_current_password");

    const short = await changeRequest(token, {
      currentPassword: "temp-pass-1",
      newPassword: "short",
      confirmPassword: "short",
    });
    expect(short.status).toBe(422);
    expect(((await short.json()) as { code?: string }).code).toBe("password_too_short");

    const after = await getAccount(String(account.id));
    expect(mustChangePasswordFor(after)).toBe(true);
  });

  it("changes the password, clears the flag, and re-opens the app", async () => {
    const account = await createAccount({
      email: "mobile-change@sunshine.example",
      password: "temp-pass-1",
      fullName: "Mobile Change",
      role: "parent",
      mustChangePassword: true,
    });
    const token = tokenFor("mobile-change@sunshine.example", String(account.id));

    const res = await changeRequest(token, {
      currentPassword: "temp-pass-1",
      newPassword: "my-own-pass-9",
      confirmPassword: "my-own-pass-9",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; account?: { mustChangePassword?: boolean } };
    expect(body.ok).toBe(true);
    expect(body.account?.mustChangePassword).toBe(false);

    const after = await getAccount(String(account.id));
    expect(mustChangePasswordFor(after)).toBe(false);
    expect(verifyPassword("my-own-pass-9", String(after!.password_hash))).toBe(true);
    expect(verifyPassword("temp-pass-1", String(after!.password_hash))).toBe(false);

    // The same token now reaches the normal payload — no re-login needed.
    const boot = await bootstrapRequest(token);
    expect(boot.status).toBe(200);
  });
});
