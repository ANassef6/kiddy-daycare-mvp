// KID-466: the Linear brand is removed from the Kiddy stack (board directive
// KID-464 — Vikunja is the only ticketing system; enhancement requests sync to
// Vikunja through the Paperclip routine). These tests pin ZERO user-visible
// "Linear" strings in the EN + AR enhancement dictionaries, pin the Vikunja
// replacements, and guard the EN/AR parity of the surfaces that changed.
// Internal legacy identifiers (the linear_created status value, linear_issue_id
// / linear_issue_url columns, LinearWriteBackPayload, i18n key names like
// colLinear) are intentionally out of scope — see the "Legacy internal names"
// note in docs/ENHANCEMENTS_REQUESTS.md.

import { describe, expect, it } from "vitest";
import { dictionaries, keysOf, type Dict } from "@/lib/i18n";

function visibleStrings(section: unknown): string[] {
  if (typeof section === "string") return [section];
  if (section && typeof section === "object") {
    return Object.values(section as Record<string, unknown>).flatMap(visibleStrings);
  }
  return [];
}

function enhancementKeys(dict: Dict): string[] {
  return keysOf(dict as never)
    .filter((k) => k.startsWith("enhancements.") || k === "nav.enhancements")
    .sort();
}

describe("KID-466: no user-visible Linear naming in the enhancements dictionaries", () => {
  for (const [lang, dict] of Object.entries(dictionaries) as [
    keyof typeof dictionaries,
    Dict,
  ][]) {
    it(`dictionaries.${lang} carries zero "Linear" strings in enhancements.* + nav.enhancements`, () => {
      const leaks = [dict.enhancements, { tab: dict.nav.enhancements }]
        .flatMap(visibleStrings)
        .filter((s) => /linear/i.test(s));
      expect(leaks).toEqual([]);
    });
  }

  it("pins the Vikunja replacements in both languages (EN/AR parity)", () => {
    expect(dictionaries.en.enhancements.submitted).toContain("Vikunja");
    expect(dictionaries.ar.enhancements.submitted).toContain("Vikunja");
    expect(dictionaries.en.enhancements.colLinear).toBe("Vikunja");
    expect(dictionaries.ar.enhancements.colLinear).toBe("Vikunja");
    expect(dictionaries.en.enhancements.linearLink).toBe("Open in Vikunja");
    expect(dictionaries.ar.enhancements.linearLink).toBe("افتح في Vikunja");
    expect(dictionaries.en.enhancements.statusLinearCreated).toBe("In Vikunja");
    expect(dictionaries.ar.enhancements.statusLinearCreated).toBe("في Vikunja");
  });

  it("keeps EN/AR key parity for the touched surfaces", () => {
    expect(enhancementKeys(dictionaries.ar)).toEqual(enhancementKeys(dictionaries.en));
  });
});
