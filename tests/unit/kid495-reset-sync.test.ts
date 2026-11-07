// KID-651 (KID-497 O-1): unit coverage for syncAppPasswordAfterResetAction
// (shipped in KID-495). /reset-password updates the password in Supabase
// GoTrue first, then calls this action with the reset session's access token
// so the server can project the same change onto app.account.password_hash.
//
// Pins (against a mocked GoTrue auth boundary — lib/supabase):
//   1. The reset access token is re-verified against GoTrue NOW, and the
//      verified user's email must match the submitted email exactly
//      (case-normalised). The action never trusts the client.
//   2. On a valid token the app-side hash is rewritten: the new password
//      verifies, the old one does not.
//   3. On an invalid/expired token, a token that verifies for a DIFFERENT
//      email, or a GoTrue error, the hash is left untouched and the action
//      resolves with a structured { ok: false } instead of throwing — the
//      user-visible reset already succeeded and must not be blocked.
//   4. Missing/garbage input is rejected before any GoTrue call is made.

import { beforeEach, describe, expect, it, vi } from "vitest";

type GoTrueUser = { id: string; email: string };

const mockState = {
  user: null as GoTrueUser | null,
  error: null as { message: string } | null,
  lastToken: null as string | null,
  calls: 0,
};

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined }),
  headers: () => new Headers(),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseConfigured: () => true,
  getSupabase: () => ({
    auth: {
      getUser: async (token: string) => {
        mockState.calls += 1;
        mockState.lastToken = String(token);
        // Mirrors GoTrue semantics: authApiError shape on failure.
        if (mockState.error) return { data: { user: null }, error: mockState.error };
        return { data: { user: mockState.user }, error: null };
      },
    },
  }),
}));

import { createAccount, findAccountByEmail, verifyPassword } from "@/lib/auth";
import { seedFixture } from "../helpers";

function verifiedUser(email: string): void {
  mockState.error = null;
  mockState.user = { id: "gotrue-user-1", email };
}

beforeEach(async () => {
  await seedFixture();
  mockState.user = null;
  mockState.error = null;
  mockState.lastToken = null;
  mockState.calls = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("KID-651 syncAppPasswordAfterResetAction", () => {
  it("rewrites the app-side password_hash on a token that verifies for the same email", async () => {
    await createAccount({
      email: "reset@sunshine.example",
      password: "old-password-1",
      fullName: "Rami Kamel",
      role: "parent",
    });
    verifiedUser("reset@sunshine.example");
    const { syncAppPasswordAfterResetAction } = await import("@/lib/actions");

    const result = await syncAppPasswordAfterResetAction(
      "reset@sunshine.example",
      "new-password-2",
      "sb-access-token"
    );
    expect(result).toEqual({ ok: true });

    // The submitted access token was really handed to GoTrue.
    expect(mockState.calls).toBe(1);
    expect(mockState.lastToken).toBe("sb-access-token");

    const account = await findAccountByEmail("reset@sunshine.example");
    expect(verifyPassword("new-password-2", String(account!.password_hash))).toBe(true);
    expect(verifyPassword("old-password-1", String(account!.password_hash))).toBe(false);
  });

  it("accepts a mixed-case submitted email after normalisation", async () => {
    await createAccount({
      email: "mixed@sunshine.example",
      password: "old-password-1",
      fullName: "Mixed Case",
      role: "parent",
    });
    // GoTrue stores/returns lowercase; the client may submit mixed case.
    verifiedUser("mixed@sunshine.example");
    const { syncAppPasswordAfterResetAction } = await import("@/lib/actions");

    const result = await syncAppPasswordAfterResetAction(
      "  Mixed@Sunshine.example  ",
      "new-password-2",
      "sb-access-token"
    );
    expect(result).toEqual({ ok: true });
    const account = await findAccountByEmail("mixed@sunshine.example");
    expect(verifyPassword("new-password-2", String(account!.password_hash))).toBe(true);
  });

  it("does not write on an expired/invalid token (GoTrue error)", async () => {
    await createAccount({
      email: "expired@sunshine.example",
      password: "old-password-1",
      fullName: "Expired Token",
      role: "parent",
    });
    mockState.error = { message: "invalid claim: missing sub claim" };
    const { syncAppPasswordAfterResetAction } = await import("@/lib/actions");

    const result = await syncAppPasswordAfterResetAction(
      "expired@sunshine.example",
      "new-password-2",
      "stale-token"
    );
    expect(result).toEqual({ ok: false, reason: "unverified" });
    // Logged, not silent.
    expect(vi.mocked(console.error).mock.calls.length).toBeGreaterThan(0);

    const account = await findAccountByEmail("expired@sunshine.example");
    expect(verifyPassword("new-password-2", String(account!.password_hash))).toBe(false);
    expect(verifyPassword("old-password-1", String(account!.password_hash))).toBe(true);
  });

  it("does not write when the token verifies for a DIFFERENT email", async () => {
    await createAccount({
      email: "victim@sunshine.example",
      password: "old-password-1",
      fullName: "Victim",
      role: "parent",
    });
    verifiedUser("attacker@sunshine.example");
    const { syncAppPasswordAfterResetAction } = await import("@/lib/actions");

    const result = await syncAppPasswordAfterResetAction(
      "victim@sunshine.example",
      "attacker-password",
      "someone-elses-token"
    );
    expect(result).toEqual({ ok: false, reason: "unverified" });

    const account = await findAccountByEmail("victim@sunshine.example");
    expect(verifyPassword("attacker-password", String(account!.password_hash))).toBe(false);
    expect(verifyPassword("old-password-1", String(account!.password_hash))).toBe(true);
  });

  it("rejects missing or unparseable input before ever contacting GoTrue", async () => {
    const { syncAppPasswordAfterResetAction } = await import("@/lib/actions");

    expect(await syncAppPasswordAfterResetAction("", "pw-12345678", "token")).toEqual({
      ok: false,
      reason: "missing-input",
    });
    expect(await syncAppPasswordAfterResetAction("not-an-email", "pw-12345678", "token")).toEqual({
      ok: false,
      reason: "missing-input",
    });
    expect(await syncAppPasswordAfterResetAction("a@sunshine.example", "", "token")).toEqual({
      ok: false,
      reason: "missing-input",
    });
    expect(await syncAppPasswordAfterResetAction("a@sunshine.example", "pw-12345678", "")).toEqual({
      ok: false,
      reason: "missing-input",
    });
    expect(mockState.calls).toBe(0);
  });

  it("resolves with no-account instead of throwing when GoTrue knows the user but the app does not", async () => {
    verifiedUser("gotrue-only@sunshine.example");
    const { syncAppPasswordAfterResetAction } = await import("@/lib/actions");

    const result = await syncAppPasswordAfterResetAction(
      "gotrue-only@sunshine.example",
      "new-password-2",
      "sb-access-token"
    );
    expect(result).toEqual({ ok: false, reason: "no-account" });
  });

  it("never rejects: an unverified path resolves so the user-visible reset is not blocked", async () => {
    await createAccount({
      email: "unverified@sunshine.example",
      password: "old-password-1",
      fullName: "Not Blocked",
      role: "parent",
    });
    mockState.user = { id: "u", email: "someone-else@sunshine.example" };
    const { syncAppPasswordAfterResetAction } = await import("@/lib/actions");

    await expect(
      syncAppPasswordAfterResetAction("unverified@sunshine.example", "new-password-2", "bad-token")
    ).resolves.toEqual({ ok: false, reason: "unverified" });
  });
});
