// KID-240: the landing chrome showed the demo call-to-action twice (a plain
// "Book a demo" nav entry next to the blue primary CTA) and the footer Company
// column leaked the raw platform inbox as a mailto item. These tests pin the
// cleanup:
//   1. The header renders "Book a demo" exactly once — the blue primary CTA
//      pointing at /contact.
//   2. The footer Company column keeps "Book a demo", "Contact us" and
//      "Sign in", and carries no raw-email mailto link.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

describe("KID-240: single Book-a-demo CTA in the header", () => {
  it("renders 'Book a demo' exactly once, as the primary CTA", async () => {
    const { default: SiteHeader } = await import("@/components/SiteHeader");
    const html = renderToStaticMarkup(SiteHeader({}));
    expect(html.split("Book a demo").length - 1).toBe(1);
    expect(html).toContain("site-nav-cta");
    expect(html).toContain('href="/contact"');
  });
});

describe("KID-240: footer Company column without the raw email", () => {
  it("keeps the three link items and carries no mailto", async () => {
    const { default: SiteFooter } = await import("@/components/SiteFooter");
    const html = renderToStaticMarkup(SiteFooter());
    expect(html).toContain("Book a demo");
    expect(html).toContain("Contact us");
    expect(html).toContain("Sign in");
    expect(html).not.toContain("mailto:");
  });
});
