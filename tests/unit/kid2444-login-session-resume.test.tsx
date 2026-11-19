// KID-2444: the installed v4 app launches /login on every cold start. A valid
// 30-day session cookie was present, but /login always painted the sign-in
// form, so a signed-in parent reported "I still need to login every time".
//
// Pinned here:
//   - /login resumes an existing session and redirects to the role home
//     exactly like loginAction does (parent -> /child, staff -> /portal/dashboard,
//     platform operator -> /platform);
//   - a temp-password account lands on /change-password (same rule as login);
//   - guard notices (?error=…, ?confirmed=1) still render and never bounce a
//     disabled/withdrawn account between /login and its home (no loop);
//   - no session still renders the login form.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  headers: {} as Record<string, string>,
  redirects: [] as string[],
}));

vi.mock("next/headers", () => ({
  headers: () => ({
    get: (key: string) => h.headers[key.toLowerCase()] ?? null,
  }),
  cookies: () => ({
    get: (name: string) => (h.headers[name] ? { name, value: h.headers[name] } : undefined),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.redirects.push(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useSearchParams: () => ({ get: () => null }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import LoginPage from "@/app/login/page";
import { createSessionToken, sessionCookieHeader, type Session } from "@/lib/auth";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

const APEX = "daycare.test";

async function signInAs(role: string, accountId: string): Promise<void> {
  const session: Session = {
    accountId,
    role,
    email: "someone@example.test",
    emailConfirmed: true,
  };
  const cookie = sessionCookieHeader(session)["Set-Cookie"].split(";")[0];
  h.headers = { cookie };
}

beforeEach(async () => {
  process.env.PUBLIC_APEX_DOMAIN = APEX;
  h.headers = {};
  h.redirects = [];
  await seedFixture();
});

afterEach(() => {
  delete process.env.PUBLIC_APEX_DOMAIN;
});

describe("KID-2444: /login resumes a valid session instead of showing the form again", () => {
  it("a signed-in parent cold-opening /login goes to /child", async () => {
    const parent = await queryGet("SELECT id FROM account WHERE email = ?", "parent@example.test");
    await signInAs("parent", String(parent!.id));
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirects).toEqual(["/child"]);
  });

  it("a signed-in staff/owner account goes to the portal dashboard", async () => {
    const owner = await queryGet("SELECT id FROM account WHERE email = ?", "trois4ever+admin@gmail.com");
    await signInAs("owner", String(owner!.id));
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirects).toEqual(["/portal/dashboard"]);
  });

  it("the platform operator goes to /platform", async () => {
    await signInAs("platform", "platform-account-id");
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirects).toEqual(["/platform"]);
  });

  it("a temp-password account is sent to /change-password, matching loginAction", async () => {
    const parent = await queryGet("SELECT id FROM account WHERE email = ?", "parent@example.test");
    await queryRun("UPDATE account SET must_change_password = 1 WHERE id = ?", parent!.id);
    await signInAs("parent", String(parent!.id));
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirects).toEqual(["/change-password"]);
  });

  it("a guard notice still renders for a signed-in account and does not bounce (no redirect loop)", async () => {
    const parent = await queryGet("SELECT id FROM account WHERE email = ?", "parent@example.test");
    await signInAs("parent", String(parent!.id));
    const html = renderToStaticMarkup(
      await LoginPage({ searchParams: Promise.resolve({ error: "disabled-institute", reason: "billing" }) }),
    );
    expect(h.redirects).toEqual([]);
    expect(html).toContain("Sign in");
  });

  it("no session still renders the login form", async () => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(h.redirects).toEqual([]);
    expect(html).toContain("Sign in");
  });

  it("the redirect is not applied to the post-confirmation notice", async () => {
    const parent = await queryGet("SELECT id FROM account WHERE email = ?", "parent@example.test");
    await signInAs("parent", String(parent!.id));
    const html = renderToStaticMarkup(
      await LoginPage({ searchParams: Promise.resolve({ confirmed: "1" }) }),
    );
    expect(h.redirects).toEqual([]);
    expect(html).toContain("Sign in");
  });
});
