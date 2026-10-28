// KID-256: per-daycare white-label install branding. A parent on
// sunshine.<apex> installs "Sunshine Daycare" — the manifest, theme color,
// and apple-touch icon all name THAT daycare — while apex/legacy/unknown
// hosts keep the generic Kiddy brand, unchanged from KID-199.3r behavior.
//
// Layers pinned here:
//   lib/manifest.ts — pure pure manifest construction (names, icons) and the
//     host→branding rule (same subdomain rule as lib/theme.ts, fail-generic
//     for unknown/legacy hosts with no first-institute fallback);
//   app/manifest.webmanifest/route.ts, app/brand-icon.svg/route.ts — the two
//     request routes served on every origin;
//   app/layout.tsx — the meta surface (theme-color, manifest, apple-touch).
//
// To import the route handlers we need an institute whose subdomain the
// route reads through next/headers — mocked per test like kid212 does.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  headers: () => ({
    get: (key: string) => mockHeaders[key.toLowerCase()] ?? null,
  }),
}));

import { queryGet, queryRun } from "@/lib/db";
import {
  BRAND_ICON_PATH,
  GENERIC_SKIN,
  appNamesForBranding,
  brandIconSvg,
  brandingForRequestHost,
  daycareInitials,
  manifestForBranding,
} from "@/lib/manifest";
import * as manifestRoute from "@/app/manifest.webmanifest/route";
import * as brandIconRoute from "@/app/brand-icon.svg/route";
import { getInstitute as storeGetInstitute } from "@/lib/store";
import { seedFixture } from "../helpers";

const APEX = "daycare.test";
const SUNSHINE = "sunshine-daycare";
let sunshineIid: string;

beforeEach(async () => {
  process.env.PUBLIC_APEX_DOMAIN = APEX;
  mockHeaders = {};
  await seedFixture();
  sunshineIid = String((await queryGet("SELECT id FROM institute ORDER BY created_at LIMIT 1"))!.id);
});

afterEach(() => {
  delete process.env.PUBLIC_APEX_DOMAIN;
});

async function respond(route: { GET: () => Promise<Response> }): Promise<Response> {
  return route.GET();
}

describe("KID-256 pure builders", () => {
  it("names the app after the daycare, appending 'Daycare' when the stored name omits it", () => {
    expect(appNamesForBranding({ ...GENERIC_SKIN, name: "Sunshine Daycare" })).toEqual({
      name: "Sunshine Daycare",
      shortName: "Sunshine",
    });
    expect(appNamesForBranding({ ...GENERIC_SKIN, name: "Mapletree" })).toEqual({
      name: "Mapletree Daycare",
      shortName: "Mapletree",
    });
    expect(appNamesForBranding(GENERIC_SKIN)).toEqual({ name: "Kiddy", shortName: "Kiddy" });
  });

  it("manifest is bound to the serving origin by relative start_url/scope", () => {
    const m = manifestForBranding({ ...GENERIC_SKIN, name: "Sunshine Daycare", primaryColor: "#8B5CF6" });
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.theme_color).toBe("#8B5CF6");
    expect(m.display).toBe("standalone");
  });

  it("lists the daycare logo first and the generated fallback icon always", () => {
    const m = manifestForBranding({ ...GENERIC_SKIN, logoUrl: "https://cdn.test/sunshine.png" });
    const icons = m.icons as { src: string; type: string; sizes: string }[];
    expect(icons[0].src).toBe("https://cdn.test/sunshine.png");
    expect(icons[0].type).toBe("image/png");
    expect(icons.some((i) => i.src === BRAND_ICON_PATH && i.type === "image/svg+xml")).toBe(true);
    const svgOnly = manifestForBranding(GENERIC_SKIN);
    expect(svgOnly.icons as object[]).toEqual([
      expect.objectContaining({ src: BRAND_ICON_PATH, type: "image/svg+xml", sizes: "any" }),
    ]);
  });

  it("initials come from up to two words of the daycare name", () => {
    expect(daycareInitials("Sunshine Daycare")).toBe("SD");
    expect(daycareInitials("Mapletree")).toBe("M");
    expect(daycareInitials("  ")).toBe("");
  });

  it("brandIconSvg is a standalone SVG rendering the initials on the brand color", () => {
    const svg = brandIconSvg("SD", "#8B5CF6");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('fill="#8B5CF6"');
    expect(svg).toContain(">SD</text>");
  });
});

describe("KID-256 host→branding rule", () => {
  it("a known daycare subdomain resolves THAT institute's branding", async () => {
    mockHeaders = { host: `sunshine-daycare.${APEX}` };
    const b = await brandingForRequestHost();
    expect(b.name).toBe("Sunshine Daycare");
    expect(b.primaryColor).toBe("#8B5CF6");
  });

  it("unknown subdomains, the apex, legacy hosts and no-host keep generic Kiddy", async () => {
    for (const host of [`nope.${APEX}`, `www.${APEX}`, APEX, "kiddy-one.vercel.app", "localhost:3000", ""]) {
      mockHeaders = host ? { host } : {};
      const b = await brandingForRequestHost();
      expect(b.name).toBe("Kiddy");
    }
  });

  it("with no apex configured, no host resolves a tenant (legacy behavior)", async () => {
    delete process.env.PUBLIC_APEX_DOMAIN;
    mockHeaders = { host: `sunshine-daycare.${APEX}` };
    expect((await brandingForRequestHost()).name).toBe("Kiddy");
  });
});

describe("KID-256 manifest route", () => {
  it("serves Sunshine branding on sunshine.<apex>", async () => {
    mockHeaders = { host: `${SUNSHINE}.${APEX}` };
    const res = await respond(manifestRoute);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/manifest+json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("Sunshine Daycare");
    expect(body.theme_color).toBe("#8B5CF6");
    const icons = body.icons as { src: string }[];
    expect(icons.some((i) => i.src === BRAND_ICON_PATH)).toBe(true);
  });

  it("apex and unknown hosts stay generic — same JSON shape, generic name", async () => {
    for (const host of [APEX, `nope.${APEX}`, "kiddy-one.vercel.app"]) {
      mockHeaders = { host };
      const res = await respond(manifestRoute);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.name).toBe("Kiddy");
      expect(body.theme_color).toBe(GENERIC_SKIN.primaryColor);
    }
  });

  it("a broken color value still falls back to the default theme color", async () => {
    // The route never renders tenant data it could half-build: name from the
    // row, but a NULL color falls back to the Kiddy default (same rule as
    // brandingFromInstitute), and the response stays 200.
    mockHeaders = { host: `${SUNSHINE}.${APEX}` };
    await queryRun("UPDATE institute SET primary_color = '' WHERE id = ?", sunshineIid);
    const res = await respond(manifestRoute);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.name).toBe("Sunshine Daycare");
    expect(body.theme_color).toBe(GENERIC_SKIN.primaryColor);
  });
});

describe("KID-256 brand-icon route", () => {
  it("renders the daycare's initials on its brand color", async () => {
    mockHeaders = { host: `${SUNSHINE}.${APEX}` };
    const res = await respond(brandIconRoute);
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
    const svg = await res.text();
    expect(svg).toContain('fill="#8B5CF6"');
    expect(svg).toContain(">SD</text>");
  });

  it("stays generic (K) on non-tenant hosts", async () => {
    mockHeaders = { host: APEX };
    const res = await respond(brandIconRoute);
    expect(await res.text()).toContain(">K</text>");
  });
});

describe("KID-256 institute-driven names match the stored record", () => {
  it("the store row drives both name and theme, not hardcode", async () => {
    const inst = await storeGetInstitute(sunshineIid);
    expect(inst).toBeTruthy();
    const m = manifestForBranding({
      ...GENERIC_SKIN,
      name: String(inst!.name),
      primaryColor: String(inst!.primary_color ?? GENERIC_SKIN.primaryColor),
      logoUrl: (inst!.logo_url as string) ?? null,
    });
    expect(m.name).toBe("Sunshine Daycare");
  });
});
