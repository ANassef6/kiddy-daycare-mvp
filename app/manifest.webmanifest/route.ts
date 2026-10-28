// KID-256: the per-tenant PWA manifest. On a known daycare subdomain the
// manifest IS the daycare's brand (name, theme color, its logo plus the
// generated fallback icon, start_url/scope bound to that origin by staying
// relative). Apex and legacy hosts keep the generic Kiddy manifest — the
// install CTA there stays generic, never a tenant's name.
import { GENERIC_SKIN, brandingForRequestHost, manifestForBranding } from "@/lib/manifest";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const branding = await brandingForRequestHost();
    return Response.json(manifestForBranding(branding), {
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // Fail loud, fail generic: never a tenant name on a broken manifest.
    console.error("manifest route failed:", err);
    return Response.json(manifestForBranding(GENERIC_SKIN), {
      headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
