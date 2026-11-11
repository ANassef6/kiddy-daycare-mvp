import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { brandNameForTitle, getBranding } from "@/lib/theme";
import { ensureSeeded } from "@/lib/bootstrap";
import { dirFor } from "@/lib/i18n";
import { resolveRequestLocale } from "@/lib/i18n-session";
import { PUBLIC_PAGE_HEADER } from "@/middleware";
import ChatwootWidget from "@/components/ChatwootWidget";
import BrandBanner from "@/components/BrandBanner";

// KID-435: the title brand follows the same white-label rule as the install
// meta (KID-256): on a daycare's own subdomain every document title names
// that daycare (the Sunshine install no longer reads "Kiddy ..."), signed-in
// accounts on generic hosts keep their own daycare, and apex/anonymous hosts
// stay byte-for-byte generic Kiddy. generateMetadata (not an isomorphic
// `metadata` export) so the per-request host/session decides.
export async function generateMetadata(): Promise<Metadata> {
  let titleBrand = "Kiddy";
  try {
    titleBrand = (await brandNameForTitle()) || "Kiddy";
  } catch (err) {
    console.error("Title brand resolution failed:", err);
  }
  return {
    title: {
      default: `${titleBrand} — childcare, in your pocket`,
      template: `%s | ${titleBrand}`,
    },
    description: "Check-in, check-out, daily reports, and the newsfeed for Egyptian daycares.",
  };
}

export const dynamic = "force-dynamic";

// Resolve the active locale for the request. OBS-001: account.language is the
// canonical preference — the kiddy_lang cookie is accepted only while they
// agree, so a stale cookie (changed from another device) can no longer flip
// `dir` against the page dictionaries. Anonymous visitors keep the cookie
// choice. KID-1826: the logic now lives in lib/i18n-session so the public
// marketing pages resolve the exact same locale their <html lang dir> shows.

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // KID-216: the lazy bootstrap (schema + demo seed + platform operator for the
  // PLATFORM_ADMIN_EMAIL allowlist) was never wired to any request path, so an
  // unmanaged deployment could never mint its operator account. Await it once
  // on the first render of every warm instance; it self-skips afterwards and
  // must never block the render on failure.
  try {
    await ensureSeeded();
  } catch (err) {
    console.error("Bootstrap failed at layout render:", err);
  }

  let theme = "";
  // KID-256: the meta/head branding is the HOST's brand — on
  // sunshine.<apex> the browser chrome, apple-touch icon, and manifest
  // link all name the daycare; apex/legacy hosts keep generic Kiddy. The
  // defaults below are also the no-DB fallback. KID-493: brandImageUrl rides
  // the same resolution for the top banner.
  let metaBrand = {
    name: "Kiddy",
    primaryColor: "#3B82F6",
    logoUrl: null as string | null,
    brandImageUrl: null as string | null,
  };
  try {
    const b = await getBranding();
    metaBrand = { name: b.name, primaryColor: b.primaryColor, logoUrl: b.logoUrl, brandImageUrl: b.brandImageUrl };
    theme = [
      `--brand-primary: ${b.primaryColor};`,
      `--brand-accent: ${b.accentColor};`,
      `--brand-font: '${b.font}', system-ui, sans-serif;`,
    ].join("\n");
  } catch {
    // never block render on DB availability
  }

  const locale = await resolveRequestLocale();
  // KID-1826: middleware flags the public marketing routes so the layout can
  // skip the banner render entirely (see the BrandBanner mount below).
  let isPublicPage = false;
  try {
    isPublicPage = (await headers()).get(PUBLIC_PAGE_HEADER) === "1";
  } catch {
    // no request scope (tests/scripts): keep the banner behavior unchanged
  }

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root{${theme}}` }} />
        <meta name="theme-color" content={metaBrand.primaryColor} />
        {/* KID-256: manifest + generated fallback icon; on a daycare
            subdomain the manifest is that daycare's brand. Relative hrefs so
            the per-origin manifest is picked up on every host. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href={metaBrand.logoUrl ?? "/brand-icon.svg"} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          {locale === "ar" ? "تخطَّ إلى المحتوى" : "Skip to content"}
        </a>
        {/* KID-493: the tenant's brand image tops every page (portal, parent,
            auth, marketing) — before {children}, after the skip link. Null →
            the component renders nothing, so no empty gap and no shift on
            tenants without an image. KID-1826: on the public marketing routes
            the banner is not rendered at all (the middleware marks those
            requests with x-kiddy-public-page) — the tenant image moved inline
            into the site header lockup there, so the full-width strip is gone
            server-side: no flash, no CLS, no hydration dependency.
            App/portal/auth surfaces keep the banner exactly as before. */}
        {isPublicPage ? null : (
          <BrandBanner
            src={metaBrand.brandImageUrl}
            name={metaBrand.name}
            alt={
              locale === "ar"
                ? `صورة العلامة التجارية لـ${metaBrand.name}`
                : `${metaBrand.name} brand image`
            }
          />
        )}
        {/* #1: logo URL available as data attribute for client components */}
        <div data-brand={metaBrand.name} data-logo={metaBrand.logoUrl ?? ""} style={{ display: "none" }} />
        {children}
        {/* KID-306: env-configured Chatwoot support widget (bottom-right,
            Chatwoot default). Renders nothing (no request, no bubble) unless
            both NEXT_PUBLIC_CHATWOOT_* vars are set. Client boundary lives
            inside the component; the server layout above is untouched. */}
        <ChatwootWidget />
      </body>
    </html>
  );
}