// KID-256: the generated fallback launcher icon. Every daycare origin serves
// ITS OWN icon (initials on that daycare's brand primary color) with zero
// design work from the operator; a daycare that uploads a logo also gets the
// logo listed first in the manifest (lib/manifest.ts). SVG so it scales to
// any launcher size; PNG-asset generation for the Play listing is a manual
// packaging step — docs/WHITE_LABEL_APPS.md.
import { brandIconSvg, brandingForRequestHost, daycareInitials } from "@/lib/manifest";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const branding = await brandingForRequestHost();
    const initials = daycareInitials(branding.name) || "K";
    return new Response(brandIconSvg(initials, branding.primaryColor), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("brand-icon route failed:", err);
    return new Response(brandIconSvg("K", "#3B82F6"), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
