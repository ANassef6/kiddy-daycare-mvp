import { describe, expect, it } from "vitest";
import { getDictionary, keysOf } from "@/lib/i18n";
import { checkInPolicyError, pickupPolicyError } from "@/lib/policy-i18n";
import type { PickupTimeDecision } from "@/lib/pickup-policy";

const en = getDictionary("en");
const ar = getDictionary("ar");

function refusal(code: "invalid_time" | "cross_day" | "past" | "closed_day" | "outside_hours", extra: Partial<Extract<PickupTimeDecision, { ok: false }>> = {}) {
  return { ok: false as const, code, error: "legacy", ...extra };
}

describe("KID-2413 bug 6: policy refusals are dictionary-backed", () => {
  it("localizes the check-in gate in both languages", () => {
    expect(checkInPolicyError(en, { code: "closed_day", day: "6" })).toContain("Saturday is a closed day");
    expect(checkInPolicyError(ar, { code: "closed_day", day: "6" })).toContain("السبت يوم مغلق");
    expect(checkInPolicyError(en, { code: "before_open", open: "07:00" })).toContain("opening time is 07:00");
    expect(checkInPolicyError(ar, { code: "before_open", open: "07:00" })).toContain("07:00");
    expect(checkInPolicyError(en, {})).toBeUndefined();
  });

  it("localizes every pickup refusal code", () => {
    expect(pickupPolicyError(en, refusal("past"))).toContain("in the past");
    expect(pickupPolicyError(ar, refusal("past"))).toContain("في الماضي");
    expect(pickupPolicyError(en, refusal("cross_day"))).toContain("for today");
    expect(pickupPolicyError(ar, refusal("cross_day"))).toContain("لليوم فقط");
    expect(pickupPolicyError(en, refusal("closed_day", { day: "0" }))).toContain("Sunday is a closed day");
    expect(pickupPolicyError(ar, refusal("closed_day", { day: "0" }))).toContain("الأحد");
    expect(pickupPolicyError(en, refusal("outside_hours", { detail: "before_open", open: "08:00" }))).toContain("08:00");
    expect(pickupPolicyError(en, refusal("outside_hours", { detail: "after_close", close: "18:00" }))).toContain("closed after 18:00");
    expect(pickupPolicyError(ar, refusal("outside_hours", { detail: "after_close", close: "18:00" }))).toContain("18:00");
    expect(pickupPolicyError(en, refusal("invalid_time"))).toContain("could not be read");
  });

  it("ships the same policy keys in both dictionaries", () => {
    const enKeys = keysOf(en).filter((k) => k.startsWith("policy."));
    const arKeys = keysOf(ar).filter((k) => k.startsWith("policy."));
    expect(enKeys.length).toBeGreaterThan(10);
    expect(arKeys).toEqual(enKeys);
  });
});
