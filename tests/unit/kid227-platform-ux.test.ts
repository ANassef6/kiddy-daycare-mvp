// KID-227: /platform rework — layout, native color pickers, and the
// subdomain prefix/URL UX. Board rejection on KID-199: the /platform layout
// was squeezed by the portal sidebar grid, colors were typed as raw hex, and
// the subdomain edit was undiscoverable (unlabeled, silent URL, errors lost
// the typed value).
//
// The pieces pinned here are the parts that are logic rather than markup:
//   lib/subdomain.ts subdomainEditErrorPath — the failed inline edit lands on
//     the edited row (`edit`) with the typed prefix (`prefix`) echoed back, so
//     the input keeps what the operator typed and the message shows in place;
//   the new i18n labels exist in EN and AR (the dicts must stay key-aligned).

import { afterEach, describe, expect, it } from "vitest";
import { apexDomain, subdomainEditErrorPath, subdomainUrl } from "@/lib/subdomain";
import { dictionaries, keysOf } from "@/lib/i18n";

describe("subdomainEditErrorPath (failed inline prefix saves)", () => {
  it("keys the error to the edited row and echoes the typed prefix", () => {
    const path = subdomainEditErrorPath("inst-1", "sunshine2", "subdomain-taken");
    expect(path.startsWith("/platform?")).toBe(true);
    const params = new URLSearchParams(path.slice("/platform?".length));
    expect(params.get("error")).toBe("subdomain-taken");
    expect(params.get("edit")).toBe("inst-1");
    expect(params.get("prefix")).toBe("sunshine2");
  });

  it("encodes tricky typed values so they survive the redirect intact", () => {
    const path = subdomainEditErrorPath("inst-2", "Sun Shine!#", "subdomain-invalid");
    const params = new URLSearchParams(path.slice("/platform?".length));
    expect(params.get("prefix")).toBe("Sun Shine!#");
    expect(params.get("edit")).toBe("inst-2");
  });

  it("round-trips an empty typed prefix (the operator tried to clear it)", () => {
    const path = subdomainEditErrorPath("inst-3", "", "unknown");
    const params = new URLSearchParams(path.slice("/platform?".length));
    expect(params.get("prefix")).toBe("");
    expect(params.get("edit")).toBe("inst-3");
  });
});

describe("public URL helpers behind the row UI", () => {
  const original = process.env.PUBLIC_APEX_DOMAIN;

  afterEach(() => {
    if (original === undefined) delete process.env.PUBLIC_APEX_DOMAIN;
    else process.env.PUBLIC_APEX_DOMAIN = original;
  });

  it("renders https://<prefix>.<apex> only when the apex is configured", () => {
    process.env.PUBLIC_APEX_DOMAIN = "daycare.test";
    expect(subdomainUrl("sunshine")).toBe("https://sunshine.daycare.test");
  });

  it("with no apex configured the URL is empty — the page shows the env hint instead", () => {
    delete process.env.PUBLIC_APEX_DOMAIN;
    expect(apexDomain()).toBe("");
    expect(subdomainUrl("sunshine")).toBe("");
  });
});

describe("i18n: the prefix/URL labels exist in EN and AR", () => {
  it("every new key is present in both dictionaries", () => {
    const required = [
      "platform.editPrefix",
      "platform.copyUrl",
      "platform.copied",
      "platform.noPrefix",
      "platform.apexMissing",
    ];
    const enKeys = new Set(keysOf(dictionaries.en));
    const arKeys = new Set(keysOf(dictionaries.ar));
    for (const key of required) {
      expect(enKeys.has(key)).toBe(true);
      expect(arKeys.has(key)).toBe(true);
    }
    // The dictionaries must stay key-aligned (kid199 pins this too).
    expect([...arKeys].sort()).toEqual([...enKeys].sort());
  });
});
