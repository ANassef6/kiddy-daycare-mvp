// KID-111: unit tests for the parent-invite email service.
// Pure-function tests only (validation + template); delivery attempts need a
// provider and are covered by the logged server-action path instead.

import { describe, expect, it } from "vitest";
import {
  activationUrlForCode,
  buildParentInviteEmail,
  isValidInviteCode,
  isValidInviteEmail,
} from "@/lib/invite-email";

describe("isValidInviteEmail", () => {
  it("accepts normal addresses", () => {
    expect(isValidInviteEmail("parent@example.com")).toBe(true);
    expect(isValidInviteEmail("  Parent@Example.COM  ")).toBe(true);
  });

  it("rejects blanks, non-emails and non-strings", () => {
    expect(isValidInviteEmail("")).toBe(false);
    expect(isValidInviteEmail("not-an-email")).toBe(false);
    expect(isValidInviteEmail("a@b")).toBe(false);
    expect(isValidInviteEmail(null)).toBe(false);
    expect(isValidInviteEmail(undefined)).toBe(false);
  });
});

describe("isValidInviteCode", () => {
  it("accepts codes in range", () => {
    expect(isValidInviteCode("SUNSHINE-1234")).toBe(true);
    expect(isValidInviteCode("ABCD")).toBe(true);
  });

  it("rejects short, blank and overlong codes", () => {
    expect(isValidInviteCode("")).toBe(false);
    expect(isValidInviteCode("ABC")).toBe(false);
    expect(isValidInviteCode("x".repeat(65))).toBe(false);
    expect(isValidInviteCode(null)).toBe(false);
  });
});

describe("buildParentInviteEmail", () => {
  it("contains the code, the activation link and the child name", () => {
    const mail = buildParentInviteEmail({
      parentEmail: "Parent@Example.com",
      code: "SUNSHINE-1234",
      childName: "Becca Nassef",
      origin: "https://kiddy.example",
    });
    expect(mail.to).toBe("parent@example.com");
    expect(mail.subject).toContain("Kiddy");
    expect(mail.text).toContain("SUNSHINE-1234");
    expect(mail.text).toContain("https://kiddy.example/register?code=SUNSHINE-1234");
    expect(mail.text).toContain("Becca Nassef");
    expect(mail.text).toContain("single-use");
  });

  it("works without a child name and tolerates a trailing slash origin", () => {
    const mail = buildParentInviteEmail({
      parentEmail: "a@b.co",
      code: "CODE-1",
      origin: "https://kiddy.example/",
    });
    expect(mail.text).toContain("https://kiddy.example/register?code=CODE-1");
    expect(mail.text).not.toContain("undefined");
  });
});

describe("activationUrlForCode", () => {
  it("builds a prefilled register link", () => {
    expect(activationUrlForCode("https://kiddy.example/", "SUNSHINE-1234")).toBe(
      "https://kiddy.example/register?code=SUNSHINE-1234"
    );
  });
});
