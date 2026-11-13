import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { en, ar, keysOf, tr } from "@/lib/i18n";

// KID-2400: the EN/AR parity test alone could not stop a new page from
// shipping literal English — an entirely untranslated page passes key parity
// because it references no dictionary at all. This guard walks every page
// route and fails when a page that renders user-facing text declares no
// dictionary usage. Fail-closed: a new page must either adopt i18n or add an
// explicit one-line allowlist entry with a reason.

const APP_DIR = join(process.cwd(), "app");

// Pages exempted from the dictionary check. One line per entry, stating why
// the page can carry no user-facing copy. Anything NOT listed here must
// reference the dictionary; a new English-only page fails this test.
const ALLOWLIST: Record<string, string> = {
  "portal/inquiries/page.tsx":
    "pure redirect to /portal/forms?view=inquiries (KID-86) — no rendered copy",
  "portal/reports/page.tsx":
    "pure redirect to /portal/report-center (KID-52) — no rendered copy",
  "portal/children/development/page.tsx":
    "pure redirect to /portal/learning (KID-52) — no rendered copy",
  "platform/daycares/page.tsx":
    "pure redirect alias for the operator /platform daycares list — no rendered copy",
};

function walkPages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkPages(full));
    } else if (entry === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

// A page "declares dictionary usage" when it resolves a dictionary in any of
// the codebase's established ways: i18nForAccount/resolveRequestLocale/
// resolveSiteLocale (lib/i18n-session, lib/site-i18n), getDictionary, the
// translate helpers tr(/t(, getString, or a dict prop. The broad `i18n`
// token also matches those module names.
const DICT_USAGE = /i18n|getDictionary|tr\(|getString|siteContext/;

describe("i18n page coverage (KID-2400)", () => {
  const pages = walkPages(APP_DIR)
    .map((p) => relative(APP_DIR, p).split(sep).join("/"))
    .sort();

  it("walks a non-trivial number of pages (sanity)", () => {
    expect(pages.length).toBeGreaterThan(40);
  });

  it("every page that renders user-facing text declares dictionary usage", () => {
    const offenders: string[] = [];
    for (const rel of pages) {
      if (ALLOWLIST[rel]) continue;
      const source = readFileSync(join(APP_DIR, rel), "utf8");
      if (!DICT_USAGE.test(source)) offenders.push(rel);
    }
    expect(
      offenders,
      `These pages render without any dictionary usage. Localize them (i18nForAccount / getDictionary / tr) or add a justified ALLOWLIST entry in tests/unit/i18n-page-coverage.test.ts:\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("every allowlisted path actually exists (allowlist stays pruned)", () => {
    for (const rel of Object.keys(ALLOWLIST)) {
      expect(pages, `allowlist entry no longer matches a real page: ${rel}`).toContain(rel);
    }
  });
});

// KID-2400: an ar value identical to its en value is how a translation gets
// skipped silently. Brand names, glyphs, and codes are exempt via allowlist.
const AR_MAY_EQUAL_EN = new Set([
  // Language names: each language is shown under its own name in both locales.
  "app.arabic",
  "app.english",
  "account.arabic",
  "account.english",
  "login.langEn",
  "login.langAr",
  "help.langEn",
  "help.langAr",
  "site.lang.en",
  "site.lang.ar",
  // Brand / product / format names kept untranslated by design.
  "roles.staff", // "Staff" kept as the role loanword in AR (roles group)
  "platform.toolBilling", // "Billing" loanword kept in AR
  "drive.kindPdf", // "PDF" is a file-format code
  "enhancements.colLinear", // column header is the Vikunja product name
  "parent.pushTestTitle", // push-test notification title is the brand name
  // Placeholders and pure-data templates with no translatable words.
  "settings.instapayLinkPlaceholder", // "https://…" URL glyph
  "site.contact.emailPlaceholder", // "you@daycare.eg" example address
  "staff.emailPlaceholder", // "staff@yourdaycare.eg" example address
  "childBilling.amountPlaceholder", // "0.00" numeric placeholder
  "smartList.savedCount", // "({count})" pure count template
  "staff.perStaffHeading", // "{name} · {role}" pure data template
  "childBilling.backToChild", // "← {first} {last}" pure data template
  "feed.suppliesBody", // "{qty} {unit}{notes}" pure data template
  "feed.billingMeta", // "{amount} {currency} · {status}" pure data template
  "feed.reportBody", // "{summary}" pure data template
]);

describe("ar/en divergence guard (KID-2400)", () => {
  it("no ar value silently equals its en value outside the allowlist", () => {
    const offenders: string[] = [];
    for (const key of keysOf(en)) {
      const enValue = tr(en, key);
      const arValue = tr(ar, key);
      if (enValue === arValue && enValue.trim().length > 0 && !AR_MAY_EQUAL_EN.has(key)) {
        offenders.push(key);
      }
    }
    expect(
      offenders,
      `These ar values equal their en values — a skipped translation. Translate them or add a justified AR_MAY_EQUAL_EN entry:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
