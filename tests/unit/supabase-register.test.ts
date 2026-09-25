// KID-123: unit tests for the GoTrue already-registered matcher used by
// registerAction to adopt an existing GoTrue user (e.g. created by an admin
// invite) instead of leaving the parent stuck on "already registered".
// Pure-function tests only; the sign-in adoption itself needs GoTrue.

import { describe, expect, it } from "vitest";
import { isGoTrueAlreadyRegisteredError } from "@/lib/supabase";

describe("isGoTrueAlreadyRegisteredError", () => {
  it("matches the current user_already_exists code", () => {
    expect(isGoTrueAlreadyRegisteredError({ code: "user_already_exists", message: "User already registered" })).toBe(true);
  });

  it("matches the legacy email_exists code", () => {
    expect(isGoTrueAlreadyRegisteredError({ code: "email_exists", message: "User already registered" })).toBe(true);
  });

  it("matches the admin-invite wording without a code", () => {
    expect(
      isGoTrueAlreadyRegisteredError({ message: "A user with this email address has already been registered" })
    ).toBe(true);
  });

  it("rejects rate-limit, network and empty errors", () => {
    expect(
      isGoTrueAlreadyRegisteredError({ code: "over_email_send_rate_limit", message: "Email rate limit exceeded" })
    ).toBe(false);
    expect(isGoTrueAlreadyRegisteredError({ message: "Failed to fetch" })).toBe(false);
    expect(isGoTrueAlreadyRegisteredError(null)).toBe(false);
    expect(isGoTrueAlreadyRegisteredError(undefined)).toBe(false);
    expect(isGoTrueAlreadyRegisteredError("already registered")).toBe(false);
  });
});
