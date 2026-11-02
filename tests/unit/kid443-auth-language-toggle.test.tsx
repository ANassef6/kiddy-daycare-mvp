// KID-443 defect 3: the EN/AR control on the unauthenticated surfaces. QA
// check 4 of the Sunshine TWA round FAILed because /login (the surface the
// parents land on) offered no language control even though its copy already
// followed the kiddy_lang cookie (KID-368) — so an Arabic-read parent had no
// way to switch before signing in.
//
// Pinned here (test style follows kid437: next/headers host+cookie mocked per
// test over the seeded SQLite fixture, server auth pages rendered directly
// with next/link mocked):
//   - /login serves the toggle for EVERY visitor (apex + tenant subdomain),
//     with the exact KID-403 toggle markup contract (role group, both EN and
//     AR options, the current one aria-pressed=true);
//   - the toggle labels come from the new login.langLabel/langEn/langAr dict
//     keys in both dictionaries (the KID-403 lib/i18n infra);
//   - /forgot-password (the "if trivial" extension) gets the same control and
//     its previously-English copy now resolves from the new forgot dict
//     section, following the same kiddy_lang cookie precedence as /login.

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

import ForgotPasswordPage from "@/app/forgot-password/page";
import LoginPage from "@/app/login/page";
import AuthLangToggle from "@/components/AuthLangToggle";
import { dictionaries } from "@/lib/i18n";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";

const APEX = "daycare.test";
let sunshineSlug: string;

beforeEach(async () => {
  process.env.PUBLIC_APEX_DOMAIN = APEX;
  mockHeaders = {};
  await seedFixture();
  sunshineSlug = String((await queryGet("SELECT subdomain FROM institute ORDER BY created_at LIMIT 1"))!.subdomain);
});

afterEach(() => {
  delete process.env.PUBLIC_APEX_DOMAIN;
});

// The KID-403 toggle contract, rendered server-side with the resolved state:
// exactly two options inside a labelled group, and the visitor's current
// language owns the single aria-pressed=true.
function pressedOption(html: string): string | null {
  const match = html.match(/class="btn btn-primary" aria-pressed="true" lang="(\w+)"/);
  return match ? match[1] : null;
}

describe("KID-443: /login serves the EN/AR control for the pre-sign-in visitor", () => {
  it("renders the toggle under the EN default (no cookie) — English pressed", async () => {
    mockHeaders = { host: APEX };
    const html = renderToStaticMarkup(await LoginPage({ searchParams: {} }));
    expect(html).toContain('class="login-lang-toggle"');
    expect(html).toContain('role="group"');
    expect(pressedOption(html)).toBe("en");
    expect(html).toContain("English");
    expect(html).toContain(">العربية</");
    expect(html).toContain('aria-label="App language"');
    // the page chrome around the toggle already follows the same cookie (KID-368 kept)
    expect(html).toContain("Welcome back");
  });

  it("renders the toggle with the AR cookie pressed, everything else AR too", async () => {
    mockHeaders = { host: APEX, kiddy_lang: "ar" };
    const html = renderToStaticMarkup(await LoginPage({ searchParams: {} }));
    expect(html).toContain('class="login-lang-toggle"');
    expect(pressedOption(html)).toBe("ar");
    expect(html).toContain("English");
    expect(html).toContain(">العربية</");
    expect(html).toContain('aria-label="لغة التطبيق"');
    expect(html).toContain("أهلًا بعودتك");
  });

  it("the tenant subdomain keeps the toggle + tenant brand (Sunshine parents get both)", async () => {
    mockHeaders = { host: `${sunshineSlug}.${APEX}` };
    const html = renderToStaticMarkup(await LoginPage({ searchParams: {} }));
    expect(html).toContain('class="login-lang-toggle"');
    expect(html).toContain('<span class="brand">Sunshine Daycare</span>');
    expect(pressedOption(html)).toBe("en");
    expect(html).toContain(">العربية</");
  });
});

describe("KID-443: /forgot-password follows the same cookie + offers the toggle", () => {
  it("resolves the copy from the new forgot dict section under the kiddy_lang cookie", async () => {
    mockHeaders = { host: APEX, kiddy_lang: "ar" };
    const html = renderToStaticMarkup(await ForgotPasswordPage());
    expect(html).toContain("إعادة تعيين كلمة المرور");
    expect(html).toContain("أرسل رابط إعادة التعيين");
    expect(html).toContain('dir="rtl">');
    expect(html).not.toContain("Reset your password");
    expect(html).toContain('class="login-lang-toggle"');
    expect(html).toContain('aria-label="لغة التطبيق"');
    expect(pressedOption(html)).toBe("ar");
  });

  it("English stays the default on the cookie's absence, toggle present", async () => {
    mockHeaders = { host: APEX };
    const html = renderToStaticMarkup(await ForgotPasswordPage());
    expect(html).toContain("Reset your password");
    expect(html).toContain("Send reset link");
    expect(html).toContain('class="login-lang-toggle"');
    expect(pressedOption(html)).toBe("en");
  });
});

describe("KID-443: the toggle + localization are wired through lib/i18n", () => {
  it("both dictionaries carry the login.lang* + forgot.* keys in the same shape", () => {
    for (const dict of Object.values(dictionaries)) {
      expect(dict.login.langLabel).toBeTruthy();
      expect(dict.login.langEn).toBe("English");
      expect(dict.login.langAr).toBe("العربية");
      expect(Object.keys(dict.forgot).sort()).toEqual(Object.keys(dictionaries.en.forgot).sort());
    }
    expect(dictionaries.en.login.langLabel).toBe("App language");
    expect(dictionaries.ar.login.langLabel).toBe("لغة التطبيق");
  });

  it("AuthLangToggle pins the pressed state to the locale prop (group, no dropdown)", () => {
    const en = renderToStaticMarkup(
      <AuthLangToggle locale="en" label="App language" en="English" ar="العربية" />
    );
    const ar = renderToStaticMarkup(
      <AuthLangToggle locale="ar" label="لغة التطبيق" en="English" ar="العربية" />
    );
    expect(pressedOption(en)).toBe("en");
    expect(pressedOption(ar)).toBe("ar");
    // both long-form labels always visible for discoverability on both sides
    expect(ar).toContain(">English</");
    expect(ar).toContain(">العربية</");
  });

  it("the toggle persists the kiddy_lang cookie and reloads (server pages re-render)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/AuthLangToggle.tsx"), "utf8");
    expect(src).toContain("document.cookie = `${LANG_COOKIE}=${code}; path=/; max-age=31536000; SameSite=Lax`;");
    expect(src).toContain("window.location.reload()");
    // no silent failure
    expect(src).toContain("console.error");
  });

  it("both unauthenticated pages mount the shared AuthLangToggle", () => {
    for (const p of [
      "app/login/page.tsx",
      "components/AuthLangToggle.tsx",
      "app/forgot-password/forgot-password-form.tsx",
    ]) {
      expect(fs.readFileSync(path.join(process.cwd(), p), "utf8")).toContain("AuthLangToggle");
    }
  });
});
