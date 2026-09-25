// KID-113: resend-activation indicator + action.
// Unit tests for the domain service (lib/activation.ts): unactivated-state
// detection, email validation, and the rate-limit decision. Plus one
// DB-backed check that activationByEmails batches correctly and the audit
// log records attempts.

import { describe, expect, it, beforeEach } from "vitest";
import {
  normalizeEmail,
  isValidEmail,
  isUnactivatedAccount,
  decideRateLimit,
  activationByEmails,
  activationStepError,
  logResendAttempt,
  countRecentResendsForEmail,
  RESEND_PER_EMAIL_PER_HOUR,
  RESEND_PER_ADMIN_PER_HOUR,
} from "@/lib/activation";
import { createAccount } from "@/lib/auth";
import { queryAll } from "@/lib/db";
import { seedFixture } from "../helpers";

describe("activation email helpers", () => {
  it("normalizes emails for comparison", () => {
    expect(normalizeEmail("  Admin@Example.com ")).toBe("admin@example.com");
    expect(normalizeEmail(null)).toBe("");
  });

  it("validates emails at the boundary", () => {
    expect(isValidEmail("parent@example.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("a".repeat(250) + "@x.com")).toBe(false);
  });

  it("detects unactivated accounts via email_confirmed = 0", () => {
    expect(isUnactivatedAccount({ email_confirmed: 0 })).toBe(true);
    expect(isUnactivatedAccount({ email_confirmed: 1 })).toBe(false);
    expect(isUnactivatedAccount(undefined)).toBe(false);
    expect(isUnactivatedAccount(null)).toBe(false);
  });
});

describe("resend rate limit", () => {
  it("allows traffic under both caps", () => {
    expect(decideRateLimit(0, 0)).toEqual({ limited: false });
    expect(decideRateLimit(RESEND_PER_EMAIL_PER_HOUR - 1, RESEND_PER_ADMIN_PER_HOUR - 1)).toEqual({
      limited: false,
    });
  });

  it("blocks the target address at the per-email cap", () => {
    const d = decideRateLimit(RESEND_PER_EMAIL_PER_HOUR, 0);
    expect(d.limited).toBe(true);
    if (d.limited) expect(d.reason).toMatch(/hour/i);
  });

  it("blocks the admin at the per-admin cap", () => {
    const d = decideRateLimit(0, RESEND_PER_ADMIN_PER_HOUR);
    expect(d.limited).toBe(true);
    if (d.limited) expect(d.reason).toMatch(/hour/i);
  });
});

describe("activation lookup + audit (db)", () => {
  beforeEach(async () => {
    await seedFixture();
  });

  it("returns entries only for emails with a login account", async () => {
    await createAccount({
      email: "pending-parent@example.com",
      password: "secret-123",
      fullName: "Pending Parent",
      role: "parent",
      emailConfirmed: false,
    });
    await createAccount({
      email: "active-parent@example.com",
      password: "secret-123",
      fullName: "Active Parent",
      role: "parent",
      emailConfirmed: true,
    });

    const map = await activationByEmails([
      "pending-parent@example.com",
      "ACTIVE-parent@example.com",
      "no-login-yet@example.com",
      "",
      null,
    ]);

    expect(map.get("pending-parent@example.com")?.unactivated).toBe(true);
    expect(map.get("active-parent@example.com")?.unactivated).toBe(false);
    // No login account -> absent, so the UI shows no resend affordance.
    expect(map.has("no-login-yet@example.com")).toBe(false);
  });

  it("audit-logs resend attempts for later review", async () => {
    await createAccount({
      email: "pending-parent@example.com",
      password: "secret-123",
      fullName: "Pending Parent",
      role: "parent",
      emailConfirmed: false,
    });
    await logResendAttempt({
      targetEmail: "pending-parent@example.com",
      adminAccountId: null,
      channel: "supabase",
      status: "sent",
    });
    expect(await countRecentResendsForEmail("pending-parent@example.com")).toBe(1);
    const rows = await queryAll("SELECT target_email, status FROM activation_resend_log");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
  });
});

// KID-124: every registerAction step maps to a distinct user-facing message
// with a short code, so the next human report names the failing call. Auth
// steps must read as a service problem, data steps as our write problem —
// neither may read as "wrong password".
describe("activationStepError", () => {
  it("codes auth steps as a sign-in service problem", () => {
    for (const step of ["goTrueSignUp", "goTrueAdoptSignIn"]) {
      const msg = activationStepError(step);
      expect(msg).toContain("ACT-AUTH");
      expect(msg).toMatch(/sign-in service/i);
    }
  });

  it("codes data steps distinctly", () => {
    expect(activationStepError("createAccount")).toContain("ACT-ACCOUNT");
    expect(activationStepError("setPin")).toContain("ACT-PIN");
    expect(activationStepError("linkFamily")).toContain("ACT-LINK");
    expect(activationStepError("consumeInvite")).toContain("ACT-INVITE");
    expect(activationStepError("findAccount")).toContain("ACT-LOOKUP");
  });

  it("falls back to the generic message for unknown steps", () => {
    expect(activationStepError("somethingElse")).toContain("couldn't activate");
  });
});
