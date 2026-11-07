// KID-489 items 3+4 (KID-493): the brand lockup stacks — the logo sits ABOVE
// the complete daycare name on every surface (portal sidebar, parent header,
// auth pages, settings preview) — and the uploaded brand image renders as a
// responsive banner at the top of every page from the branding the root
// layout already resolves. Upload feedback is honest: missing storage or a
// failed upload bounces back with a localized error banner instead of the
// old silent no-op, and a success purges the short-lived branding cache plus
// revalidates so the banner appears on the next navigation (not after the
// 30s TTL).
//
// Test style follows kid437/kid472: next/link + next/navigation mocked,
// renderToStaticMarkup for the client islands, source-contract assertions
// for the CSS/layout wiring that renderToStaticMarkup cannot see, and the
// dictionaries asserted directly for EN/AR parity.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children, className, style }: { href: string; children: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
    <a href={href} className={className} style={style}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/dashboard",
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

import PortalSidebar from "@/components/PortalSidebar";
import AuthBrand from "@/components/AuthBrand";
import BrandBanner from "@/components/BrandBanner";
import { getDictionary } from "@/lib/i18n";
import { clearBrandingCache } from "@/lib/theme";

const css = () => fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const src = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("KID-493: the brand lockup stacks — logo above the full daycare name", () => {
  it("PortalSidebar renders the stacked lockup (logo img before the full name span)", () => {
    const html = renderToStaticMarkup(
      <PortalSidebar
        brandName="Sunshine Daycare"
        logoUrl="https://cdn.daycare.test/sunshine/logo.png"
        locale="en"
        dict={getDictionary("en") as never}
        role="owner"
      />
    );
    const anchor = html.match(/<a[^>]*class="site-brand"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
    expect(anchor).toContain("class=\"site-brand\"");
    expect(anchor).toContain("https://cdn.daycare.test/sunshine/logo.png");
    const imgAt = anchor.indexOf("<img");
    const nameAt = anchor.indexOf('>Sunshine Daycare<');
    expect(imgAt).toBeGreaterThanOrEqual(0);
    expect(nameAt).toBeGreaterThan(imgAt);
    // The full name is present — nothing truncated.
    expect(anchor).toContain("Sunshine Daycare");
  });

  it("the sidebar renders the name even with no logo (name-only stacked state)", () => {
    const html = renderToStaticMarkup(
      <PortalSidebar
        brandName="Mapletree Childcare"
        logoUrl={null}
        locale="en"
        dict={getDictionary("en") as never}
        role="admin"
      />
    );
    expect(html).toContain('>Mapletree Childcare<');
  });

  it("AuthBrand keeps the shared /api/branding fetch and renders the stacked site-brand wrapper", () => {
    const html = renderToStaticMarkup(<AuthBrand brandName="Mapletree Childcare" />);
    expect(html).toContain('class="site-brand"');
    expect(html).toContain('<span class="brand">Mapletree Childcare</span>');
    expect(src("components/AuthBrand.tsx")).toContain('fetch("/api/branding")');
  });

  it("globals.css stacks .site-brand as a column with wrapping (no truncation)", () => {
    const sheet = css();
    const brandRule = sheet.match(/\.site-brand \{[^}]+\}/)?.[0] ?? "";
    expect(brandRule).toContain("flex-direction: column");
    expect(brandRule).not.toContain("align-items: center;\n  gap:"); // old inline row
    // KID-493: the parent-header mobile rule no longer ellipsis-truncates the
    // name (ellipsis may legitimately remain elsewhere in the sheet).
    const childHeaderBrand = sheet.match(/\.child-header \.site-brand \.brand \{[^}]+\}/)?.[0] ?? "";
    expect(childHeaderBrand).not.toContain("ellipsis");
    expect(childHeaderBrand).not.toContain("nowrap");
    // The bare `.shell-side a { display: block }` used to out-specify
    // .site-brand and collapse the sidebar lockup back to a block row — the
    // higher-specificity stack rule must exist.
    const sideRule = sheet.match(/\.shell-side a\.site-brand \{[^}]+\}/)?.[0] ?? "";
    expect(sideRule).toContain("flex-direction: column");
  });

  it("all four surfaces ride the stacked lockup", () => {
    // Portal sidebar + parent header pass the className through .site-brand;
    // the auth pages mount AuthBrand; the settings preview is a stacked flex
    // column contract asserted here.
    const layout = src("app/child/layout.tsx");
    expect(layout).toContain('className="site-brand"');
    const page = src("app/portal/settings/page.tsx");
    expect(page).toContain('flexDirection: "column"');
    expect(src("components/PortalSidebar.tsx")).toContain('className="site-brand"');
  });
});

describe("KID-493: the brand image banners every page from the root layout", () => {
  it("BrandBanner renders the image with accessible alt text", () => {
    const html = renderToStaticMarkup(
      <BrandBanner src="https://cdn.daycare.test/sunshine/brand.png" name="Sunshine Daycare" alt="Sunshine Daycare brand image" />
    );
    expect(html).toContain('class="brand-banner"');
    expect(html).toContain('src="https://cdn.daycare.test/sunshine/brand.png"');
    expect(html).toContain('alt="Sunshine Daycare brand image"');
  });

  it("tenants without a brand image render nothing (no wrapper, no gap)", () => {
    const html = renderToStaticMarkup(
      <BrandBanner src={null} name="Sunshine Daycare" alt="Sunshine Daycare brand image" />
    );
    expect(html).toBe("");
  });

  it("the root layout resolves brandImageUrl and mounts BrandBanner after the skip link", () => {
    const layout = src("app/layout.tsx");
    expect(layout).toContain("brandImageUrl: b.brandImageUrl");
    expect(layout).toContain("<BrandBanner");
    expect(layout).toContain('src={metaBrand.brandImageUrl}');
    const body = layout.slice(layout.indexOf("<body>"));
    expect(body.indexOf("skip-link")).toBeLessThan(body.indexOf("<BrandBanner"));
    // The JSX render of {children} (10-space indent inside <body>) follows
    // the BrandBanner mount — the earlier "{children}" hits are the comment
    // and the destructured prop.
    const childrenAt = layout.indexOf("        {children}");
    expect(childrenAt).toBeGreaterThan(layout.indexOf("<BrandBanner"));
  });

  it("brandImageUrl flows from the resolved branding (theme.ts contract stays wired)", () => {
    const theme = src("lib/theme.ts");
    expect(theme).toContain("brandImageUrl: (institute?.brand_image_url as string) ?? null");
  });
});

describe("KID-493: honest upload feedback + cache-busting revalidation", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    clearBrandingCache();
  });

  it("missing storage and failed uploads bounce back with ?error=… instead of a silent no-op", () => {
    const actions = src("lib/actions.ts");
    expect(actions).toContain('/portal/settings?error=upload-storage');
    expect(actions).toContain('/portal/settings?error=upload-failed');
    // A success purges the branding cache AND revalidates the layouts so the
    // banner/logo shows on the next navigation without the 30s TTL window.
    const action = actions.slice(actions.indexOf("export async function uploadBrandingImageAction"));
    expect(action).toContain("clearBrandingCache()");
    expect(action).toContain('revalidatePath("/", "layout")');
  });

  it("the settings page renders both upload error banners from localized strings", () => {
    const page = src("app/portal/settings/page.tsx");
    expect(page).toContain("settings.uploadStorageError");
    expect(page).toContain("settings.uploadFailedError");
    expect(page).toContain('role="alert"');
  });

  it("the upload error strings exist in BOTH dictionaries (EN + AR)", () => {
    for (const locale of ["en", "ar"] as const) {
      const dict = getDictionary(locale) as unknown as {
        settings: { uploadStorageError: string; uploadFailedError: string };
      };
      expect(dict.settings.uploadStorageError.length).toBeGreaterThan(10);
      expect(dict.settings.uploadFailedError.length).toBeGreaterThan(10);
    }
  });

  it("clearBrandingCache is a safe no-op that purges the TTL slots", () => {
    expect(() => { clearBrandingCache(); }).not.toThrow();
    expect(() => { clearBrandingCache(); }).not.toThrow();
  });
});
