// KID-199.2 regression tests: the top-right account menu in the portal layout
// used to be a plain `open`-gated <details> in the server layout, so it stayed
// open across client-side navigation. It is now a client component that closes
// on route change, clicks anywhere outside it, Escape, and picking any entry.
//
// The suite runs in a node environment (no DOM), so the interactive close paths
// are asserted through the markup contract and the pure item list; browser
// interaction itself is verified by KID-199 QA.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// usePathname cannot work outside a mounted App Router; capture the current
// pathname we feed to it so assertions can pin the closed-by-default mark-up.
let currentPathname = "/portal/dashboard";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

import PortalAccountMenu, { accountMenuItems } from "@/components/PortalAccountMenu";
import { en } from "@/lib/i18n";

const base = {
  email: "admin@example.test",
  role: "admin",
  displayName: "Amir Hassan",
  photoUrl: null,
  dict: en,
};

function html() {
  return renderToStaticMarkup(<PortalAccountMenu {...base} />);
}

describe("PortalAccountMenu", () => {
  it("renders closed by default (no rendered 'open' attribute)", () => {
    expect(html()).not.toMatch(/<details[^>]*\sopen[ >]/);
    expect(html()).toContain("portal-account-menu");
  });

  it("keeps every original entry and gates Center settings to admins", () => {
    const items = accountMenuItems("admin");
    expect(items.map((i) => i.href)).toEqual(["/portal/account", "/portal/settings", "/portal/support"]);
    const adminOnly = accountMenuItems("parent").filter((i) => i.adminOnly);
    expect(adminOnly.map((i) => i.href)).toEqual(["/portal/settings"]);
  });

  it("never shows Center settings for non-admins in markup", () => {
    const markup = renderToStaticMarkup(
      <PortalAccountMenu {...base} role="parent" displayName="Sara Parent" />
    );
    expect(markup).not.toContain('href="/portal/settings"');
    expect(markup).toContain('href="/portal/account"');
  });

  it("keeps the hard logout link unchanged", () => {
    expect(html()).toContain('href="/api/logout"');
    expect(html()).toContain('href="/portal/account"');
  });
});
