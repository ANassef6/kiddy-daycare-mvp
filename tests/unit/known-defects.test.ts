// Regression pins for the first-release QA defects (D1–D6).
//
// QA gated release 1 CONDITIONAL PASS and the Coder fixed each defect. These
// pins now assert the FIXED (contract) behavior so any regression is caught by
// the suite. If a fix is ever reverted, these tests fail — do not delete a pin
// without confirming the fix is still in place in code.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { mustGet, seedFixture } from "../helpers";

beforeEach(async () => {
  await seedFixture();
});

const today = () => new Date().toISOString().slice(0, 10);

describe("FIXED D1 — same-second check-in/out resolves newest event via id tie-break", () => {
  it("lastEvent reports the newer event when check-in and check-out land in the same SQLite second", async () => {
    // Repro: parent checks in then immediately checks out. SQLite has 1-second
    // resolution so recorded_at ties; ORDER BY recorded_at DESC, id DESC makes
    // the newer (later id) row win deterministically.
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const acc = await mustGet("SELECT id FROM account WHERE role='parent'");
    await store.checkChildInOut({ childId: child.id, accountId: acc.id, type: "in" });
    await store.checkChildInOut({ childId: child.id, accountId: acc.id, type: "out" });
    const status = await store.todayStatus(child.id);
    expect(status.lastEvent!.type).toBe("out");
    const attendance = (await store.attendanceOn(inst.id, today())).find((a) => a.id === child.id)!;
    expect(attendance.last_event).toBe("out");
  });
});

describe("FIXED D2 — same-second newsfeed posts sort newest-first", () => {
  it("a post created in the same second as the seed post IS feed[0]", async () => {
    const inst = (await store.listInstitutes())[0];
    const owner = await mustGet("SELECT id FROM account WHERE role='owner'");
    const post = await store.createNewsfeedPost({ instituteId: inst.id, accountId: owner.id, body: "Newest post" });
    const feed = await store.listNewsfeed(inst.id);
    expect(feed[0].id).toBe(post.id);
  });
});

describe("FIXED D3 — same-second consent list sorts newest-first", () => {
  it("a consent created in the same second as the seed consent IS list[0]", async () => {
    const inst = (await store.listInstitutes())[0];
    const consent = await store.createConsent({ instituteId: inst.id, title: "Newer consent" });
    await store.respondConsent(consent.id, "approved");
    const list = await store.listConsents(inst.id);
    expect(list[0].id).toBe(consent.id);
    expect(list[0].status).toBe("approved");
  });
});

describe("FIXED D4 — verifyToken returns null for any malformed signature", () => {
  it("a short malformed token returns null instead of throwing RangeError", async () => {
    const { verifyToken } = await import("@/lib/auth");
    expect(verifyToken("a.b")).toBeNull();
    expect(verifyToken("not-a-token")).toBeNull();
  });
});

describe("FIXED D5 — billing amount input is validated", () => {
  it("blank/non-numeric billing amounts are rejected", async () => {
    const { parseDollarsToCents } = await import("@/lib/money");
    expect(() => parseDollarsToCents("")).toThrow();
    expect(() => parseDollarsToCents("   ")).toThrow();
    expect(() => parseDollarsToCents("abc")).toThrow();
  });
});