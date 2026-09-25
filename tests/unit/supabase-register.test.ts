// KID-123: unit tests for the GoTrue already-registered matcher used by
// registerAction to adopt an existing GoTrue user (e.g. created by an admin
// invite) instead of leaving the parent stuck on "already registered".
// Pure-function tests only; the sign-in adoption itself needs GoTrue.

import { describe, expect, it } from "vitest";
import { isGoTrueAlreadyRegisteredError, isGoTrueServerError } from "@/lib/supabase";

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

// KID-124: server-error matcher — tells "sign-in service is down" apart from
// "wrong password / rejected input" so registerAction can message each case
// exactly instead of leaking a raw 500 text to the parent.
describe("isGoTrueServerError", () => {
  it("matches HTTP 5xx AuthErrors", () => {
    expect(isGoTrueServerError({ status: 500, code: "unexpected_failure", message: "Internal Server Error" })).toBe(true);
    expect(isGoTrueServerError({ status: 503, message: "Service Unavailable" })).toBe(true);
  });

  it("matches transport failures without a status", () => {
    expect(isGoTrueServerError(new TypeError("fetch failed"))).toBe(true);
    expect(isGoTrueServerError({ message: "Network request failed" })).toBe(true);
  });

  it("rejects 4xx validation, rate-limit and already-registered errors", () => {
    expect(isGoTrueServerError({ status: 400, code: "weak_password", message: "Password is too short" })).toBe(false);
    expect(isGoTrueServerError({ status: 401, message: "Invalid login credentials" })).toBe(false);
    expect(isGoTrueServerError({ status: 422, message: "Email rate limit exceeded" })).toBe(false);
    expect(isGoTrueServerError({ code: "user_already_exists", message: "User already registered" })).toBe(false);
    expect(isGoTrueServerError(null)).toBe(false);
    expect(isGoTrueServerError(undefined)).toBe(false);
    expect(isGoTrueServerError("oops")).toBe(false);
  });
});
