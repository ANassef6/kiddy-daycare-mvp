// KID-111: unit tests for the parent-invite email service.
// Pure-function tests only (validation + template); delivery attempts need a
// provider and are covered by the logged server-action path instead.
// KID-115: plus one DB-backed check that pendingInviteByEmails batches the
// family-tab lookup in a single query.

import { describe, expect, it, beforeEach } from "vitest";
import {
  activationUrlForCode,
  buildParentInviteEmail,
  generateInviteCode,
  isValidInviteCode,
  isValidInviteEmail,
  pendingInviteByEmails,
} from "@/lib/invite-email";
import { seedFixture } from "../helpers";

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

describe("generateInviteCode", () => {
  it("produces valid unique KID- codes", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateInviteCode()));
    expect(codes.size).toBe(200);
    for (const code of codes) {
      expect(code).toMatch(/^KID-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      expect(isValidInviteCode(code)).toBe(true);
    }
  });
});

describe("pendingInviteByEmails (db)", () => {
  beforeEach(async () => {
    await seedFixture();
  });

  it("returns the pending invite per email and skips the rest", async () => {
    const store = await import("@/lib/store");
    const { queryGet, queryRun } = await import("@/lib/db");
    const iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
    const invite = await store.createInvite(iid, null, "contact-only@example.com", "PEND-1", "parent");
    // A used invite for the same address must not shadow the pending one.
    await queryRun("UPDATE invite SET status = 'used' WHERE id = ?", String(invite.id));
    await store.createInvite(iid, null, "contact-only@example.com", "PEND-2", "parent");

    const map = await pendingInviteByEmails([
      "contact-only@example.com",
      "CONTACT-only@Example.COM",
      "no-invite@example.com",
      "",
      null,
    ]);

    expect(map.get("contact-only@example.com")?.code).toBe("PEND-2");
    expect(map.has("no-invite@example.com")).toBe(false);
  });

  it("matches case-insensitively like Postgres requires", async () => {
    const { queryGet, queryRun, uid } = await import("@/lib/db");
    const iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
    // Legacy row stored with uppercase, bypassing createInvite's lowercasing.
    await queryRun(
      "INSERT INTO invite (id, institute_id, child_id, email, code, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      uid(),
      iid,
      null,
      "MixedCase@Example.COM",
      "PEND-MIXED"
    );
    const map = await pendingInviteByEmails(["mixedcase@example.com"]);
    expect(map.get("mixedcase@example.com")?.code).toBe("PEND-MIXED");
  });
});
