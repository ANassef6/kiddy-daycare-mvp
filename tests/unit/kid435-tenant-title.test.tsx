// KID-435: the document title brand. KID-256 made the install meta
// (theme-color / manifest / apple-touch-icon) follow the host's brand, but the
// root layout's title metadata stayed hardcoded "Kiddy" — a Sunshine parent
// installing the daycare's own app still hit browser tabs and PWA shells
// naming "Kiddy — childcare, in your pocket" on sunshine.<apex>.
//
// Rule pinned here (lib/theme.ts brandNameForTitle, consumed by
// app/layout.tsx generateMetadata):
//   - a KNOWN daycare subdomain names that tenant, anonymous or signed-in;
//   - a signed-in non-operator account on a generic host names its OWN
//     daycare (even when it is not the first-created institute);
//   - every other host state — apex, legacy, unknown subdomains, anonymous,
//     platform operator, no request scope — stays generic "Kiddy".
//     No first-institute fallback — since KID-683 neither the anonymous
//     landing path nor the title brand may follow whichever demo daycare was
//     created first.
//
// Test style follows kid256 (host mocked per test, local SQLite fixture) plus
// source pins on the layout wiring (kid369-style), because the layout module
// imports ./globals.css and cannot be imported in a node test environment.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

let mockHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  headers: () => ({
    get: (key: string) => mockHeaders[key.toLowerCase()] ?? null,
  }),
}));

import { brandNameForTitle } from "@/lib/theme";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import * as store from "@/lib/store";
import { seedFixture } from "../helpers";

const APEX = "daycare.test";
let sunshineSlug: string;

async function sessionCookie(email: string, role: string): Promise<string> {
  const account = (await queryGet(
      "SELECT * FROM account WHERE lower(email) = lower(?)",
      email
    ))!;
  return `kiddy_sess=${encodeURIComponent(
    createSessionToken({
      accountId: String(account.id),
      role,
      email,
      emailConfirmed: true,
    })
  )}`;
}

beforeEach(async () => {
  process.env.PUBLIC_APEX_DOMAIN = APEX;
  mockHeaders = {};
  await seedFixture();
  sunshineSlug = String(
    (await queryGet("SELECT subdomain FROM institute ORDER BY created_at LIMIT 1"))!.subdomain
  );
});

afterEach(() => {
  delete process.env.PUBLIC_APEX_DOMAIN;
});

describe("KID-435 title brand rule", () => {
  it("a known daycare subdomain names that tenant — anonymous and signed-in alike", async () => {
    mockHeaders = { host: `${sunshineSlug}.${APEX}` };
    expect(await brandNameForTitle()).toBe("Sunshine Daycare");
    mockHeaders = { host: `${sunshineSlug}.${APEX}`, cookie: await sessionCookie("parent@example.test", "parent") };
    expect(await brandNameForTitle()).toBe("Sunshine Daycare");
  });

  it("the apex stays generic Kiddy even when Sunshine is the first-created institute", async () => {
    for (const host of [APEX, `www.${APEX}`, "kiddy-one.vercel.app", "localhost:3000", ""]) {
      mockHeaders = host ? { host } : {};
      expect(await brandNameForTitle()).toBe("Kiddy");
    }
  });

  it("a signed-in parent on a generic host sees their own daycare's name", async () => {
    // A Maple-only parent proves this is the account's OWN tenancy, not the
    // first-created institute (Sunshine is created first by the fixture).
    const maple = await store.seedInstitute({ name: "Mapletree Childcare" });
    const mapleChild = await store.createChild({
      instituteId: String(maple.id),
      firstName: "Ava",
      lastName: "Brown",
      dob: "2021-06-01",
    });
    const freightParent = await createAccount({
      email: "maple-parent@example.test",
      password: "kiddy-parent",
      fullName: "Ava Brown",
      role: "parent",
    });
    await store.linkFamily(String(freightParent.id), String(mapleChild.id));

    mockHeaders = {
      host: APEX,
      cookie: await sessionCookie("maple-parent@example.test", "parent"),
    };
    expect(await brandNameForTitle()).toBe("Mapletree Childcare");
  });

  it("a signed-in platform operator on a generic host keeps generic Kiddy", async () => {
    // seedDemo mints the platform operator account (superadmin@kiddy.test,
    // platform sentinel role); a signed-in operator must stay generic.
    const op = (await queryGet(
      "SELECT * FROM account WHERE lower(email) = lower('superadmin@kiddy.test')"
    ))!;
    expect(op).toBeTruthy();
    mockHeaders = {
      host: APEX,
      cookie: await sessionCookie("superadmin@kiddy.test", String(op.role)),
    };
    expect(await brandNameForTitle()).toBe("Kiddy");
  });

  it("layout wiring: generateMetadata + brandNameForTitle, no hardcoded Kiddy title default", () => {
    const layout = fs.readFileSync(path.join(process.cwd(), "app", "layout.tsx"), "utf8");
    expect(layout).toContain("generateMetadata");
    expect(layout).toContain("brandNameForTitle");
    // The regression: this exact literal WAS the metadata default.
    expect(layout).not.toContain('"Kiddy — childcare, in your pocket"');
    expect(layout).toContain("template: `%s | ${titleBrand}`");
  });
});
