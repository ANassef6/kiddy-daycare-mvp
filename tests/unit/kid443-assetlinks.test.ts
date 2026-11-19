// KID-443 defect 2: /.well-known/assetlinks.json for the Sunshine TWA. QA +
// the KID-440 hand-off recorded it as NOT published on
// sunshine.kiddyapp.net — the TWA could never reach verified immersive mode
// on devices.
//
// Pinned here:
//   - lib/twa.ts resolves the statement set per REQUEST HOST through the
//     same per-origin tenancy rule as every tenant surface: the known
//     `sunshine` subdomain gets the net.kiddyapp.sunshine statement, apex /
//     legacy / preview / unknown subdomains stay fail-closed (no statement);
//   - the fingerprint is the release cert digest in the ONLY shape the
//     Digital Asset Links verifier accepts: colon-separated uppercase SHA-256
//     hex (KID-2443 — the earlier base64 rendering was rejected as a malformed
//     fingerprint and silently degraded the TWA to a Custom Tab with a URL
//     bar). Public by design, matching QA's 8ce12814…01bd digest (derived,
//     never hand-copied);
//   - the serving path is wired as code: next.config rewrites
//     /.well-known/assetlinks.json → /api/assetlinks, whose route is
//     application/json and never renders one tenant's statement for another
//     host.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

let mockHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  headers: () => ({
    get: (key: string) => mockHeaders[key.toLowerCase()] ?? null,
  }),
}));

import {
  KIDDY_PLAY_SIGNING_CERT_SHA256_HEX,
  KIDDY_RELEASE_CERT_SHA256_HEX,
  TWA_RELATION,
  assetLinksForHost,
} from "@/lib/twa";
import { GET as AssetlinksRouteGET } from "@/app/api/assetlinks/route";
import { queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

const APEX = "daycare.test";

beforeEach(async () => {
  process.env.PUBLIC_APEX_DOMAIN = APEX;
  mockHeaders = {};
  await seedFixture();
});

afterEach(() => {
  delete process.env.PUBLIC_APEX_DOMAIN;
});

describe("KID-443: assetlinks resolves per request host (same tenancy rule as the surfaces)", () => {
  // Production layout (docs/evidence/kid437): the live Sunshine daycare's
  // stored subdomain is the `sunshine` label — the fixture's random demo slug
  // is renamed to the production value for the host-shape assertions below.
  beforeEach(async () => {
    await queryRun("UPDATE institute SET subdomain = 'sunshine' WHERE id = (SELECT id FROM institute ORDER BY created_at LIMIT 1)");
  });
  it("the sunshine tenant subdomain publishes the sunshine.kiddy.app statement first, then the legacy packages", () => {
    const statements = assetLinksForHost(`sunshine.${APEX}`);
    expect(statements!.map((s) => s.target.package_name)).toEqual([
      "sunshine.kiddy.app", // KID-459: board naming rule <daycare>.kiddy.app — the Play app record package
      "net.kiddyapp.sunshine", // KID-440/443/446/454/456 test TWA/APK lineage
      "com.kiddy.app", // KID-251 control build still installed on QA devices
    ]);
    for (const s of statements!) {
      expect(s.relation).toEqual([TWA_RELATION]);
      expect(s.target.namespace).toBe("android_app");
      expect(s.target.sha256_cert_fingerprints).toContain(KIDDY_RELEASE_CERT_SHA256_HEX);
    }
  });

  it("KID-470: only the Play package carries the Play App Signing fingerprint alongside the release cert", () => {
    const statements = assetLinksForHost(`sunshine.${APEX}`);
    expect(statements!.length).toBe(3);
    const byPackage = new Map(
      statements!.map((s) => [s.target.package_name, s.target.sha256_cert_fingerprints]),
    );
    // sunshine.kiddy.app is signed by Play App Signing on its distributed
    // builds, so it must verify against BOTH signs of identity.
    expect(byPackage.get("sunshine.kiddy.app")).toEqual([
      KIDDY_RELEASE_CERT_SHA256_HEX,
      KIDDY_PLAY_SIGNING_CERT_SHA256_HEX,
    ]);
    // The legacy packages keep ONLY the release/upload certificate.
    expect(byPackage.get("net.kiddyapp.sunshine")).toEqual([KIDDY_RELEASE_CERT_SHA256_HEX]);
    expect(byPackage.get("com.kiddy.app")).toEqual([KIDDY_RELEASE_CERT_SHA256_HEX]);
  });

  it("generic hosts (apex/legacy/previews/subdomain-less) publish nothing — fail closed", () => {
    for (const host of [APEX, `www.${APEX}`, `a.b.${APEX}`, "kiddy-one.vercel.app", "localhost:3000", "", null]) {
      expect(assetLinksForHost(host as string)).toBeNull();
    }
  });

  it("an unknown / non-tenant subdomain publishes nothing either", () => {
    expect(assetLinksForHost(`mapletree.${APEX}`)).toBeNull();
    expect(assetLinksForHost(`admin.${APEX}`)).toBeNull(); // reserved label
  });

  it("the release fingerprint is the QA-recorded digest in colon-separated uppercase SHA-256 hex", () => {
    // QA (KID-441) recorded the signer cert digest as this hex; KID-2443 proved
    // the verifier rejects base64 of the same bytes as a malformed fingerprint.
    const hex = "8CE12814125FD35DB0F662DC56D6F3D5E5A3F714BC2C2656483F30263D5001BD";
    const expectedHex = hex.match(/.{2}/g)!.join(":");
    expect(KIDDY_RELEASE_CERT_SHA256_HEX).toBe(expectedHex);
    expect(KIDDY_RELEASE_CERT_SHA256_HEX).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    // Regression guard: never publish base64 again.
    expect(KIDDY_RELEASE_CERT_SHA256_HEX).not.toMatch(/[=+/]/);
  });

  it("the Play fingerprint is the Android-Publisher-reported Play App Signing digest, colon-separated uppercase hex", () => {
    // KID-470: the Android Publisher API reported the Play-signed versionCode 5
    // APK certificate as this hex (the Play App Signing key, not the upload key).
    const hex = "AF88F9A080C216AF64B7BCCAB6648D88AB7B535EA001537EAF70F471E0B7EBD7";
    const expectedHex = hex.match(/.{2}/g)!.join(":");
    expect(KIDDY_PLAY_SIGNING_CERT_SHA256_HEX).toBe(expectedHex);
    expect(KIDDY_PLAY_SIGNING_CERT_SHA256_HEX).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(KIDDY_PLAY_SIGNING_CERT_SHA256_HEX).not.toMatch(/[=+/]/);
  });

  it("the route serves JSON, serves only the request host's own statements, no-store on its failure paths", async () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app/api/assetlinks/route.ts"), "utf8");
    expect(src).toContain("assetLinksForHost");
    expect(src).toContain("NextResponse.json");
    expect(src).toContain("Cache-Control");
    // regression: it must never publish a package when the host has no TWA
    mockHeaders = { host: APEX };
    const res = await AssetlinksRouteGET();
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body?.error?.code).toBe("no_twa_app");
  });

  it("the well-known path is routed as code (next.config rewrites → the api route)", () => {
    const cfg = fs.readFileSync(path.join(process.cwd(), "next.config.mjs"), "utf8");
    expect(cfg).toContain('"/.well-known/assetlinks.json"');
    expect(cfg).toContain('"/api/assetlinks"');
  });
});
