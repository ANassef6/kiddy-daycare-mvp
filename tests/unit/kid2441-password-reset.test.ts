// KID-2441: password-reset link regression coverage.
//
// The production report was "Auth session missing" after clicking a recovery
// email. The page created a second Supabase client for the submit while the
// first one (detectSessionInUrl: true) had already consumed and cleared the
// recovery fragment. These tests pin the shared session hand-off and the
// friendly failure mapping, plus the page wiring that keeps one client.

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  completePasswordReset,
  establishRecoverySession,
  hasRecoveryCredentials,
  isSessionMissingError,
  parseRecoveryParams,
  type RecoveryAuthClient,
  type RecoveryAuthError,
} from "@/lib/password-reset";

type FakeOptions = {
  setSessionError?: RecoveryAuthError | null;
  exchangeError?: RecoveryAuthError | null;
  updateError?: RecoveryAuthError | null;
  existingToken?: string | null;
  email?: string | null;
};

function fakeClient(options: FakeOptions = {}) {
  let token = options.existingToken ?? "";
  const calls = {
    setSession: vi.fn(async ({ access_token }: { access_token: string; refresh_token: string }) => {
      if (options.setSessionError) return { error: options.setSessionError };
      token = access_token;
      return { error: null };
    }),
    exchangeCodeForSession: vi.fn(async (_code: string) => {
      if (options.exchangeError) return { error: options.exchangeError };
      token = "exchanged-token";
      return { error: null };
    }),
    updateUser: vi.fn(async ({ password }: { password: string }) => {
      if (options.updateError) return { data: { user: null }, error: options.updateError };
      return {
        data: { user: { email: options.email ?? "user@example.com" } },
        error: null,
      };
    }),
    getSession: vi.fn(async () => ({
      data: { session: token ? { access_token: token } : null },
    })),
  };
  const client: RecoveryAuthClient = { auth: calls };
  return { client, calls };
}

describe("KID-2441 recovery URL parsing", () => {
  it("reads the implicit-grant fragment Supabase sends today", () => {
    expect(
      parseRecoveryParams(
        "#access_token=at-1&expires_in=3600&refresh_token=rt-1&token_type=bearer&type=recovery",
        ""
      )
    ).toEqual({ accessToken: "at-1", refreshToken: "rt-1", code: null });
  });

  it("reads a PKCE code from the query string", () => {
    expect(parseRecoveryParams("", "?code=pkce-code&type=recovery")).toEqual({
      accessToken: null,
      refreshToken: "",
      code: "pkce-code",
    });
  });

  it("reads credentials that arrive in the query instead of the fragment", () => {
    expect(parseRecoveryParams("", "?access_token=at-2&refresh_token=rt-2")).toEqual({
      accessToken: "at-2",
      refreshToken: "rt-2",
      code: null,
    });
  });

  it("reports no credentials for a bare /reset-password visit", () => {
    const params = parseRecoveryParams("", "");
    expect(hasRecoveryCredentials(params)).toBe(false);
  });
});

describe("KID-2441 recovery session setup", () => {
  it("sets the session from an implicit fragment", async () => {
    const { client, calls } = fakeClient();
    const result = await establishRecoverySession(client, {
      accessToken: "at-1",
      refreshToken: "rt-1",
      code: null,
    });
    expect(result).toEqual({ ok: true });
    expect(calls.setSession).toHaveBeenCalledWith({ access_token: "at-1", refresh_token: "rt-1" });
  });

  it("exchanges a PKCE code", async () => {
    const { client, calls } = fakeClient();
    const result = await establishRecoverySession(client, {
      accessToken: null,
      refreshToken: "",
      code: "pkce-code",
    });
    expect(result).toEqual({ ok: true });
    expect(calls.exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
  });

  it("maps an expired or malformed token to invalid, keeping the detail for logs", async () => {
    const { client } = fakeClient({
      setSessionError: { message: "Invalid or expired token", code: "otp_expired" },
    });
    await expect(
      establishRecoverySession(client, { accessToken: "old", refreshToken: "old", code: null })
    ).resolves.toEqual({ ok: false, reason: "invalid", detail: "Invalid or expired token" });
  });

  it("maps a bare page to no-token", async () => {
    const { client, calls } = fakeClient();
    await expect(
      establishRecoverySession(client, { accessToken: null, refreshToken: "", code: null })
    ).resolves.toEqual({ ok: false, reason: "no-token" });
    expect(calls.setSession).not.toHaveBeenCalled();
    expect(calls.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe("KID-2441 password update", () => {
  it("reuses the in-memory session from the link check (the regression)", async () => {
    const { client, calls } = fakeClient({ existingToken: "recovery-session", email: "parent@example.com" });
    const result = await completePasswordReset(
      client,
      { accessToken: null, refreshToken: "", code: null },
      "new-password"
    );
    expect(result).toEqual({ ok: true, email: "parent@example.com", accessToken: "recovery-session" });
    expect(calls.setSession).not.toHaveBeenCalled();
    expect(calls.updateUser).toHaveBeenCalledWith({ password: "new-password" });
  });

  it("re-establishes from the fragment after a reload, then updates", async () => {
    const { client, calls } = fakeClient({ email: "parent@example.com" });
    const result = await completePasswordReset(
      client,
      { accessToken: "at-1", refreshToken: "rt-1", code: null },
      "new-password"
    );
    expect(result).toEqual({ ok: true, email: "parent@example.com", accessToken: "at-1" });
    expect(calls.setSession).toHaveBeenCalledOnce();
    expect(calls.updateUser).toHaveBeenCalledOnce();
  });

  it("maps GoTrue AuthSessionMissingError to the localized expired path", async () => {
    const { client } = fakeClient({
      existingToken: "recovery-session",
      updateError: { message: "Auth session missing!", code: "session_not_found" },
    });
    await expect(
      completePasswordReset(client, { accessToken: null, refreshToken: "", code: null }, "new-password")
    ).resolves.toEqual({
      ok: false,
      reason: "expired",
      detail: "Auth session missing!",
    });
  });

  it("maps other update failures to the generic failed path", async () => {
    const { client } = fakeClient({
      existingToken: "recovery-session",
      updateError: { message: "Password should be at least 8 characters", code: "weak_password" },
    });
    await expect(
      completePasswordReset(client, { accessToken: null, refreshToken: "", code: null }, "short")
    ).resolves.toEqual({
      ok: false,
      reason: "failed",
      detail: "Password should be at least 8 characters",
    });
  });

  it("never calls updateUser when the link has no session and no credentials", async () => {
    const { client, calls } = fakeClient();
    await expect(
      completePasswordReset(client, { accessToken: null, refreshToken: "", code: null }, "new-password")
    ).resolves.toEqual({ ok: false, reason: "no-token", detail: undefined });
    expect(calls.updateUser).not.toHaveBeenCalled();
  });
});

describe("KID-2441 session-missing detection", () => {
  it("recognises the GoTrue message and code", () => {
    expect(isSessionMissingError({ message: "Auth session missing!" })).toBe(true);
    expect(isSessionMissingError({ code: "session_not_found" })).toBe(true);
    expect(isSessionMissingError({ message: "Invalid or expired token" })).toBe(false);
    expect(isSessionMissingError(null)).toBe(false);
  });
});

describe("KID-2441 reset page wiring", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/reset-password/reset-form.tsx"),
    "utf8"
  );

  it("disables Supabase URL detection so the fragment survives the link check", () => {
    expect(source).toContain("detectSessionInUrl: false");
    expect(source).not.toContain("detectSessionInUrl: true");
  });

  it("keeps one client for the submit instead of rebuilding it from the (now empty) URL", () => {
    expect(source).toContain("clientRef");
    expect(source).toContain("clientRef.current ??");
    expect(source).not.toContain("supabase.auth.updateUser");
  });

  it("delegates every failure to a localized label, never a raw error message", () => {
    expect(source).toContain("labels.expiredLink");
    expect(source).toContain("labels.invalidLink");
    expect(source).toContain("labels.updateFailed");
    expect(source).not.toContain("setError(updateError.message)");
  });
});
