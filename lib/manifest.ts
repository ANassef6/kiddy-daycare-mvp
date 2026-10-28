// KID-256: per-daycare white-label install branding. A parent installs the
// daycare's own app ("Sunshine Daycare") from sunshine.<apex>, never "Kiddy",
// so the Play Store search lands on the daycare brand.
//
// Layers:
//   lib/manifest.ts — pure manifest/initials/name building; unit tests drive it
//     and the two request routes (manifest.webmanifest, brand-icon.svg) use it;
//   app/brand-icon.svg/route.ts — a generated fallback icon (backend SVG:
//     daycare initials on the brand primary color) so a daycare without an
//     uploaded logo is still installable and brand-colored;
//   app/layout.tsx — theme-color / apple-touch / manifest meta on the host's
//     own branding.
//
// Deliberately NOT here: any store publishing. The Play Store path (Bubblewrap
// TWA packaging from this manifest) needs a human per brand — see
// docs/WHITE_LABEL_APPS.md.
import { brandingFromInstitute, type Branding } from "./theme";
import { splitSubdomainHost } from "./subdomain";
import type { Row } from "./db";

/** Generic-brand manifest name on apex/legacy/unknown hosts (KID-199.3r: those
 *  hosts keep exactly the pre-existing generic behavior). */
export const GENERIC_APP_NAME = "Kiddy";
export const GENERIC_SKIN: Branding = {
  name: GENERIC_APP_NAME,
  logoUrl: null,
  brandImageUrl: null,
  primaryColor: "#3B82F6",
  accentColor: "#10B981",
  font: "Inter",
};
/** The generated fallback icon every tenant origin serves (backend SVG). */
export const BRAND_ICON_PATH = "/brand-icon.svg";

/** Up to two leading initials of the daycare name, for the generated icon. */
export function daycareInitials(name: string): string {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0]?.toUpperCase() ?? "")
    .join("");
}

/** The install-facing app names. The stored institute name IS the brand the
 *  parent searches ("Sunshine Daycare"); centros that typed a bare word get
 *  " Daycare" appended so the listing never reads as a generic word. */
export function appNamesForBranding(b: Branding): { name: string; shortName: string } {
  if (b.name === GENERIC_APP_NAME) return { name: GENERIC_APP_NAME, shortName: GENERIC_APP_NAME };
  const name = /(^|\s)daycare$/i.test(b.name.trim()) ? b.name.trim() : `${b.name.trim()} Daycare`;
  // PWA short_name display budget is ~12 glyphs: drop the "Daycare" suffix
  // first ("Sunshine Daycare" → "Sunshine"), then fall back to a truncate.
  const withoutSuffix = name.replace(/\s+daycare$/i, "").trim();
  const shortName =
    withoutSuffix && withoutSuffix.length <= 12 ? withoutSuffix : name.slice(0, 12).trim();
  return { name, shortName };
}

function iconTypeAndSizeFor(logoUrl: string): { type: string; sizes: string } {
  const ext = logoUrl.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  if (ext === "svg") return { type: "image/svg+xml", sizes: "any" };
  if (ext === "ico") return { type: "image/x-icon", sizes: "any" };
  if (ext === "jpg" || ext === "jpeg") return { type: "image/jpeg", sizes: "512x512" };
  if (ext === "webp") return { type: "image/webp", sizes: "512x512" };
  return { type: "image/png", sizes: "512x512" };
}

/** The web app manifest object for a tenant (or the generic default). All URLs
 *  stay relative so the manifest is correct on the daycare's own origin wherever
 *  it is served, and Bubblewrap packages each brand from its own origin. */
export function manifestForBranding(
  b: Branding,
  opts: { iconPath?: string } = {}
): Record<string, unknown> {
  const { name, shortName } = appNamesForBranding(b);
  const icons: Record<string, string>[] = [];
  if (b.logoUrl) {
    const { type, sizes } = iconTypeAndSizeFor(b.logoUrl);
    icons.push({ src: b.logoUrl, sizes, type, purpose: "any maskable" });
  }
  icons.push({
    src: opts.iconPath ?? BRAND_ICON_PATH,
    sizes: "any",
    type: "image/svg+xml",
    purpose: "any",
  });
  return {
    id: "/",
    name,
    short_name: shortName,
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "en",
    dir: "auto",
    background_color: "#FFFFFF",
    theme_color:
      // A blank or malformed color would make Chrome refuse the whole
      // manifest; the generic default is the safe fallback.
      /^#[0-9a-fA-F]{3,8}$/.test(String(b.primaryColor ?? ""))
        ? b.primaryColor
        : GENERIC_SKIN.primaryColor,
    description: `${name} — daily reports, check-in, and messaging for parents.`,
    icons,
  };
}

/** The SVG for the generated fallback icon: brand primary rounded square,
 *  white initials centered. Pure string so tests pin it. */
export function brandIconSvg(initials: string, primaryColor: string): string {
  // Escape anything that could close a tag; the text is our own initials.
  const safe = String(initials ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" rx="96" fill="${primaryColor}"/><text x="256" y="256" font-family="system-ui, sans-serif" font-size="216" font-weight="700" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">${safe}</text></svg>`;
}

/** The branding a request host must serve: a KNOWN daycare subdomain serves
 *  that tenant (anonymous and signed-in alike, same rule as
 *  lib/theme.ts getBranding); unknown subdomains and apex/legacy hosts keep
 *  the generic Kiddy default — never tenant data, never the first institute. */
export async function brandingForRequestHost(): Promise<Branding> {
  try {
    const h = (await import("next/headers")).headers();
    const ctx = splitSubdomainHost(h.get("host"));
    if (ctx.kind === "subdomain") {
      const { instituteIdBySubdomain } = await import("./store");
      const iid = await instituteIdBySubdomain(ctx.slug);
      if (iid) {
        const { getInstitute } = await import("./store");
        const institute: Row | undefined = await getInstitute(iid);
        if (institute) return brandingFromInstitute(institute);
      }
    }
  } catch (err) {
    // Never fail the manifest route on DB/headers availability; log loudly.
    console.error("brandingForRequestHost failed:", err);
  }
  return brandingFromInstitute(undefined);
}
