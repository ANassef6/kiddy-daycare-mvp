import { headers } from "next/headers";
import { getHostBranding } from "@/lib/theme";
import { getDictionary, tr, type Locale } from "@/lib/i18n";
import { resolveSiteLocale } from "@/lib/i18n-session";
import { PUBLIC_PATH_HEADER } from "@/middleware";

// KID-1826: one request-scoped context for every public marketing page —
// the site locale (same resolution as <html lang dir>), the localized
// translate function, and the host's brand image + name for the inline
// header lockup. Branding failures never block a render: the lockup simply
// falls back to [K] Kiddy without the image.
export type SiteContext = {
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
  brandImage: string | null;
  brandName: string;
  // KID-2072: the current path + query (from middleware) for the language
  // switcher's return trip; null when there is no request scope.
  nextPath: string | null;
};

export async function siteContext(): Promise<SiteContext> {
  // KID-2072: the public pages resolve the SITE locale (site cookie wins,
  // ?lang override honored) — the same rule <html lang dir> follows on these
  // pages since the layout uses resolveSiteLocale there too.
  const locale = await resolveSiteLocale();
  let nextPath: string | null = null;
  try {
    nextPath = (await headers()).get(PUBLIC_PATH_HEADER);
  } catch {
    // no request scope (tests/scripts): the switcher omits `next`
  }
  let brandImage: string | null = null;
  let brandName = "Kiddy";
  try {
    // KID-2406: host-only branding so the rendered HTML is identical for every
    // visitor of this host and can live in the shared CDN cache.
    const b = await getHostBranding();
    brandImage = b.brandImageUrl ?? null;
    brandName = b.name;
  } catch (err) {
    console.error("Site branding resolution failed:", err);
  }
  const dict = getDictionary(locale);
  return {
    locale,
    t: (key, vars) => tr(dict, key, vars),
    brandImage,
    brandName,
    nextPath,
  };
}
