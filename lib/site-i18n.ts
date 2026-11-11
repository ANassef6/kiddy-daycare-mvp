import { getBranding } from "@/lib/theme";
import { getDictionary, tr, type Locale } from "@/lib/i18n";
import { resolveRequestLocale } from "@/lib/i18n-session";

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
};

export async function siteContext(): Promise<SiteContext> {
  const locale = await resolveRequestLocale();
  let brandImage: string | null = null;
  let brandName = "Kiddy";
  try {
    const b = await getBranding();
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
  };
}
