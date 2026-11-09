// KID-437: the auth surfaces' brand header. KID-436 live QA reported the last
// FAIL of the Sunshine parity chain: the VISIBLE brand header on tenant
// /register and /forgot-password (and the /login SSR paint) stayed a hardcoded
// generic-Kiddy span on a daycare's own subdomain — login corrected after
// hydration (KID-368's client-side /api/branding fetch), the other two never
// fetched at all, so Sunshine's parents saw purple "Kiddy" on the daycare's
// own activation + reset screens.
//
// Rule pinned here (the exact per-origin rule the KID-435 titles use, applied
// to the three auth pages' header):
//   - a KNOWN daycare subdomain names that tenant in the SSR paint;
//   - a signed-in non-operator account on a generic host names its OWN daycare;
//   - generic hosts (apex/legacy/unknown subdomains) stay generic Kiddy in the
//     SSR paint — the apex control keeps rendering `<span class="brand">Kiddy</span>`.
// The client-side /api/branding fetch stays (KID-368 acceptance) via the
// shared components/AuthBrand.tsx that /login, /register and /forgot-password
// now mount, so branding updates still take effect without a redeploy.
//
// Test style follows kid435 (next/headers host mocked per test, SQLite
// fixture) with the server auth pages rendered directly (next/navigation and
// next/link mocked the kid239 way).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

let mockHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  headers: () => ({
    get: (key: string) => mockHeaders[key.toLowerCase()] ?? null,
  }),
  cookies: () => ({
    get: (name: string) => (mockHeaders[name] ? { name, value: mockHeaders[name] } : undefined),
  }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import RegisterPage from "@/app/register/page";
import ForgotPasswordPage from "@/app/forgot-password/page";
import LoginPage from "@/app/login/page";
import AuthBrand from "@/components/AuthBrand";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";

const APEX = "daycare.test";
let sunshineSlug: string;

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

describe("KID-437: tenant auth auth pages name their own daycare in the SSR paint", () => {
  it("/register on a known subdomain renders the tenant brand header, no generic-Kiddy brand span", async () => {
    mockHeaders = { host: `${sunshineSlug}.${APEX}` };
    const html = renderToStaticMarkup(await RegisterPage());
    expect(html).toContain('<span class="brand">Sunshine Daycare</span>');
    expect(html).not.toContain('<span class="brand">Kiddy</span>');
  });

  it("/forgot-password on a known subdomain renders the tenant brand header, no generic-Kiddy brand span", async () => {
    mockHeaders = { host: `${sunshineSlug}.${APEX}` };
    const html = renderToStaticMarkup(await ForgotPasswordPage());
    expect(html).toContain('<span class="brand">Sunshine Daycare</span>');
    expect(html).not.toContain('<span class="brand">Kiddy</span>');
  });

  it("/login on a known subdomain no longer paints the generic-Kiddy fallback either", async () => {
    mockHeaders = { host: `${sunshineSlug}.${APEX}` };
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('<span class="brand">Sunshine Daycare</span>');
    expect(html).not.toContain('<span class="brand">Kiddy</span>');
  });

  it("generic hosts keep the generic-Kiddy header (apex control unchanged)", async () => {
    for (const host of [APEX, `www.${APEX}`, "kiddy-one.vercel.app", "localhost:3000", ""]) {
      mockHeaders = host ? { host } : {};
      const registerHtml = renderToStaticMarkup(await RegisterPage());
      const forgotHtml = renderToStaticMarkup(await ForgotPasswordPage());
      const loginHtml = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
      for (const html of [registerHtml, forgotHtml, loginHtml]) {
        expect(html).toContain('<span class="brand">Kiddy</span>');
        expect(html).not.toContain('<span class="brand">Sunshine Daycare</span>');
      }
    }
  });

  it("AuthBrand renders the prop fallback (the SSR paint string)", () => {
    const html = renderToStaticMarkup(<AuthBrand brandName="Mapletree Childcare" />);
    expect(html).toContain('<span class="brand">Mapletree Childcare</span>');
    expect(html).not.toContain('<span class="brand">Kiddy</span>');
    expect(renderToStaticMarkup(<AuthBrand brandName="Kiddy" />)).toContain(
      '<span class="brand">Kiddy</span>'
    );
  });
});

describe("KID-437: the auth pages share one per-origin brand component", () => {
  const AUTH_PAGE_FILES = [
    "app/login/page.tsx",
    "app/register/page.tsx",
    "app/register/register-form.tsx",
    "app/forgot-password/page.tsx",
    "app/forgot-password/forgot-password-form.tsx",
  ];
  const authPageSources = AUTH_PAGE_FILES.map((p) => ({
    path: p,
    src: fs.readFileSync(path.join(process.cwd(), p), "utf8"),
  }));

  it("all three auth pages resolve the header through brandNameForTitle + the shared AuthBrand", () => {
    // The server page resolves the SSR paint string per-origin ...
    for (const p of ["app/login/page.tsx", "app/register/page.tsx", "app/forgot-password/page.tsx"]) {
      expect(fs.readFileSync(path.join(process.cwd(), p), "utf8")).toContain("brandNameForTitle");
    }
    // ... and every auth surface mounts the shared AuthBrand client component
    // (login on the page, register/forgot-password in their client forms).
    for (const p of [
      "app/login/page.tsx",
      "app/register/register-form.tsx",
      "app/forgot-password/forgot-password-form.tsx",
    ]) {
      expect(fs.readFileSync(path.join(process.cwd(), p), "utf8")).toContain("AuthBrand");
    }
    // The regression: this exact literal WAS each page's hardcoded header.
    for (const { src } of authPageSources) {
      expect(src).not.toMatch(/<span className="brand">Kiddy<\/span>/);
    }
    const authBrand = fs.readFileSync(path.join(process.cwd(), "components", "AuthBrand.tsx"), "utf8");
    expect(authBrand).toContain('fetch("/api/branding")');
    expect(authBrand).toContain("brand?.name || brandName");
  });

  it("the superseded per-page component is gone, the register error boundary uses the shared one", () => {
    expect(fs.existsSync(path.join(process.cwd(), "app", "login", "login-brand.tsx"))).toBe(false);
    const errorBoundary = fs.readFileSync(path.join(process.cwd(), "app", "register", "error.tsx"), "utf8");
    expect(errorBoundary).toContain("AuthBrand");
    expect(errorBoundary).not.toMatch(/<span className="brand">Kiddy<\/span>/);
  });
});
