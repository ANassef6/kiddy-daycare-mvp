import { describe, it, expect, beforeAll } from "vitest";
import {
  en,
  ar,
  dictionaries,
  DEFAULT_LOCALE,
  LANG_COOKIE,
  LOCALES,
  dirFor,
  getDictionary,
  keysOf,
  localeOf,
  tr,
} from "@/lib/i18n";

// KID-57: Arabic (ar) must cover every English (en) key so the acceptance
// criteria "full Arabic translations" can be proven mechanically.
describe("i18n dictionary coverage", () => {
  const enKeys = keysOf(en).sort();
  const arKeys = keysOf(ar).sort();

  it("both locales expose the same leaf keys", () => {
    expect(enKeys).toEqual(arKeys);
  });

  it("every ar value is non-empty", () => {
    for (const key of arKeys) {
      expect(tr(ar, key).trim().length, `ar:${key} should not be empty`).toBeGreaterThan(0);
    }
  });

  it("no ar value ships as the MISSING marker", () => {
    for (const key of arKeys) {
      const value = tr(ar, key);
      expect(value.startsWith("MISSING:"), `ar:${key} resolved to a missing marker`).toBe(false);
    }
  });

  it("nested keys are flattened with dot paths", () => {
    expect(keysOf(en)).toContain("messages.threadWith");
    expect(keysOf(en)).toContain("learning.newObservation");
    expect(keysOf(en)).toContain("common.save");
  });
});

describe("i18n helpers", () => {
  it("localeOf normalizes valid/unknown values and falls back to en", () => {
    expect(localeOf("ar")).toBe("ar");
    expect(localeOf("en")).toBe("en");
    expect(localeOf("fr")).toBe(DEFAULT_LOCALE);
    expect(localeOf(null)).toBe(DEFAULT_LOCALE);
  });

  it("dirFor is rtl for Arabic and ltr for English", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
  });

  it("getDictionary returns the right locale and tolerates junk", () => {
    expect(getDictionary("ar")).toBe(ar);
    expect(getDictionary("en")).toBe(en);
    expect(getDictionary("xx" as any)).toBe(en);
  });

  it("LANG_COOKIE and LOCALES are stable", () => {
    expect(LANG_COOKIE).toBe("kiddy_lang");
    expect(LOCALES).toEqual(["en", "ar"]);
  });

  it("tr interpolates {var} placeholders", () => {
    expect(tr(en, "attendees.checkedInAt", { time: "8:05 AM" })).toBe("Checked in at 8:05 AM");
    expect(tr(ar, "attendees.checkedInAt", { time: "8:05" })).toBe("سجّل الحضور في 8:05");
  });

  it("tr interpolates multiple placeholders", () => {
    expect(tr(en, "learning.ageBandPrompt", { band: "3-4", name: "Ayla" })).toBe(
      "Age band: 3-4 — how is Ayla doing here? Pick one:"
    );
    expect(tr(ar, "learning.ageBandPrompt", { band: "3-4", name: "أيلا" })).toBe(
      "الفئة العمرية: 3-4 — كيف حال أيلا هنا؟ اختر واحدًا:"
    );
  });

  it("tr returns the key itself for missing en keys and MISSING: for ar", () => {
    expect(tr(en, "does.not.exist")).toBe("does.not.exist");
    expect(tr(ar, "does.not.exist")).toBe("MISSING:does.not.exist");
  });
});