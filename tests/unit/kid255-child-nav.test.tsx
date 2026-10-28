// KID-255 regression tests: the parent header used to cram the brand, nine
// nav links, settings and the sign-out button into one wrapping .nav row, so
// at phone widths (real Android) the sign-out button landed past the right
// viewport edge — trimmed and untappable. The nav now collapses into a
// hamburger dropdown below 720px while the sign-out button is pinned as the
// last header item at every width.
//
// The suite runs in a node environment (no DOM), so responsive CSS and the
// interactive open/close paths are asserted through the markup contract;
// browser-level behavior (geometry at 320–430px, RTL, close-on-navigate) is
// verified against the dev server in docs/evidence/kid255.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// usePathname cannot work outside a mounted App Router; pin it so the
// closed-by-default markup is asserted deterministically.
vi.mock("next/navigation", () => ({
  usePathname: () => "/child",
}));

import ChildNavMenu from "@/components/ChildNavMenu";
import { ar, en } from "@/lib/i18n";

const items = [
  { href: "/child", label: "My children" },
  { href: "/child/newsfeed", label: "News feed" },
  { href: "/child/messages", label: "Chat" },
];

function html(overrides: Partial<Parameters<typeof ChildNavMenu>[0]> = {}) {
  const props = {
    items,
    settingsHref: "/child/settings",
    settingsLabel: "Settings",
    settingsTitle: "Account settings",
    signOutLabel: "Sign out",
    dict: en,
    ...overrides,
  };
  return renderToStaticMarkup(<ChildNavMenu {...props} />);
}

describe("ChildNavMenu (KID-255)", () => {
  it("renders the hamburger closed by default (no open panel markup)", () => {
    const markup = html();
    expect(markup).toContain("child-nav-burger");
    expect(markup).not.toContain("child-nav-panel");
    expect(markup).toMatch(/aria-expanded="false"/);
  });

  it("keeps every nav item and the settings link in the inline (desktop) nav", () => {
    const markup = html();
    for (const item of items) {
      expect(markup).toContain(`href="${item.href}"`);
      expect(markup).toContain(item.label);
    }
    expect(markup).toContain('href="/child/settings"');
  });

  it("pins the sign-out button as the last header item, outside the nav flow", () => {
    const markup = html();
    expect(markup).toContain('formaction="/api/logout"');
    // The sign-out form is a direct child of .child-nav, after the inline nav.
    expect(markup.indexOf("child-nav-inline")).toBeLessThan(markup.indexOf('formaction="/api/logout"'));
  });

  it("collapses to a single link set when the pickup role shrinks the nav", () => {
    const markup = html({ items: [{ href: "/child", label: "My children" }] });
    expect(markup).toContain('href="/child"');
    expect(markup).not.toContain('href="/child/newsfeed"');
    expect(markup).toContain('formaction="/api/logout"');
  });

  it("labels the hamburger in both locales (expand/collapse + menu)", () => {
    expect(html()).toContain("Expand Menu");
    expect(html({ dict: ar })).toContain("توسيع القائمة");
  });
});
