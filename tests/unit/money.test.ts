// Money helper unit tests: formatting and cents parsing for M3 billing.

import { describe, expect, it } from "vitest";
import { formatMoney, parseDollarsToCents } from "@/lib/money";

describe("formatMoney", () => {
  it("formats integer cents as $X.XX with two decimals", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(120000)).toBe("$1,200.00");
    expect(formatMoney(42)).toBe("$0.42");
    expect(formatMoney(null)).toBe("$0.00");
    expect(formatMoney(undefined)).toBe("$0.00");
  });

  it("handles negatives with a leading minus", () => {
    expect(formatMoney(-500)).toBe("-$5.00");
  });

  it("formats other currencies with their symbols", () => {
    expect(formatMoney(120000, "EUR")).toBe("€1,200.00");
    expect(formatMoney(100, "GBP")).toBe("£1.00");
    expect(formatMoney(100, "CAD")).toBe("C$1.00");
    expect(formatMoney(100, "AUD")).toBe("A$1.00");
  });
});

describe("parseDollarsToCents", () => {
  it("parses common inputs into integer cents", () => {
    expect(parseDollarsToCents("120.50")).toBe(12050);
    expect(parseDollarsToCents("$120")).toBe(12000);
    expect(parseDollarsToCents("0")).toBe(0);
    expect(parseDollarsToCents("0.05")).toBe(5);
    expect(parseDollarsToCents("1,200")).toBe(120000);
  });

  it("throws on negative input", () => {
    expect(() => parseDollarsToCents("-5")).toThrow();
  });

  it("rejects blank/non-numeric input (regression pin D5)", () => {
    // parseDollarsToCents used to strip non-numeric characters, so ""/"   "/"abc"
    // -> 0 cents and a mistyped amount silently became $0.00. It now throws on
    // blank, whitespace-only, or non-numeric input. QA finding D5.
    expect(() => parseDollarsToCents("")).toThrow();
    expect(() => parseDollarsToCents("   ")).toThrow();
    expect(() => parseDollarsToCents("abc")).toThrow();
  });
});