// KID-230: the /platform daycare name becomes a visible "Open daycare" link
// to https://<prefix>.<apex> (board: daycare admin/parent access stays on each
// daycare's own tenant host). The pieces pinned here are the logic behind
// that link, not its markup:
//
//   lib/subdomain.ts daycarePublicUrl — the openable URL, derived from the
//     row's stored prefix + PUBLIC_APEX_DOMAIN. Empty (→ the page renders a
//     hint, never a dead link) when the apex is unset, the prefix is empty,
//     or the prefix is a reserved platform label.
//   the reserved-label behavior itself (KID-199.3r / KID-212): `kiddy-one` and
//     friends stay platform infrastructure — they must never classify as a
//     tenant host either, which is exactly why daycarePublicUrl refuses them.
//   the new i18n label exists in EN and AR (the dicts must stay key-aligned).

import { afterEach, describe, expect, it } from "vitest";
import { apexDomain, daycarePublicUrl, splitSubdomainHost } from "@/lib/subdomain";
import { dictionaries, keysOf } from "@/lib/i18n";

describe("KID-230 Open daycare URL derivation (pure)", () => {
  const original = process.env.PUBLIC_APEX_DOMAIN;

  afterEach(() => {
    if (original === undefined) delete process.env.PUBLIC_APEX_DOMAIN;
    else process.env.PUBLIC_APEX_DOMAIN = original;
  });

  it("derives https://<prefix>.<apex> when the apex is configured", () => {
    process.env.PUBLIC_APEX_DOMAIN = "daycare.test";
    expect(apexDomain()).toBe("daycare.test");
    expect(daycarePublicUrl("sunshine")).toBe("https://sunshine.daycare.test");
    expect(daycarePublicUrl("maple-grove")).toBe("https://maple-grove.daycare.test");
    expect(daycarePublicUrl("")).toBe("");
  });

  it("with no apex configured, the URL is empty — hint, never a dead link", () => {
    delete process.env.PUBLIC_APEX_DOMAIN;
    expect(apexDomain()).toBe("");
    expect(daycarePublicUrl("sunshine")).toBe("");
  });

  it("an empty or blank stored prefix is never linked, even with the apex set", () => {
    process.env.PUBLIC_APEX_DOMAIN = "daycare.test";
    expect(daycarePublicUrl("")).toBe("");
    expect(daycarePublicUrl("   ")).toBe("");
    expect(daycarePublicUrl(null)).toBe("");
    expect(daycarePublicUrl(undefined)).toBe("");
  });

  it("a reserved prefix never produces the daycare's open link (kiddy-one stays reserved)", () => {
    process.env.PUBLIC_APEX_DOMAIN = "daycare.test";
    for (const slug of ["kiddy-one", "www", "app", "api", "admin", "platform", "mail", "ftp"]) {
      expect(daycarePublicUrl(slug), slug).toBe("");
    }
  });

  it("reserved labels stay generic at host resolution too (behavior kept from KID-199.3r)", () => {
    process.env.PUBLIC_APEX_DOMAIN = "daycare.test";
    // A prefix reserved above is exactly the host label the resolver treats
    // as platform behavior — that is why daycarePublicUrl refuses it.
    expect(splitSubdomainHost(`kiddy-one.daycare.test`)).not.toEqual({
      kind: "subdomain",
      slug: "kiddy-one",
    });
    expect(splitSubdomainHost(`kiddy-one.daycare.test`).kind).toBe("apex");
    expect(splitSubdomainHost(`www.daycare.test`).kind).toBe("apex");
    // A non-reserved prefix keeps resolving as its tenant.
    expect(splitSubdomainHost(`maple-grove.daycare.test`)).toEqual({
      kind: "subdomain",
      slug: "maple-grove",
    });
  });
});

describe("i18n: the Open daycare label exists in EN and AR", () => {
  it("platform.openDaycare is present in both dictionaries", () => {
    const enKeys = new Set(keysOf(dictionaries.en));
    const arKeys = new Set(keysOf(dictionaries.ar));
    expect(enKeys.has("platform.openDaycare")).toBe(true);
    expect(arKeys.has("platform.openDaycare")).toBe(true);
    // The dictionaries must stay key-aligned (kid199/kid227 pin this too).
    expect([...arKeys].sort()).toEqual([...enKeys].sort());
  });
});
