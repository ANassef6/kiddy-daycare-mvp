import { NextResponse } from "next/server";
import { getBranding } from "@/lib/theme";

// KID-1178/F-08: the branding endpoint is intentionally PUBLIC and unauthenticated —
// it powers the anonymous marketing surfaces (apex landing page, /login brand
// header, tenant health checks). The response contract is therefore restricted
// to branding-configuration fields ONLY: the daycare display name, logo/brand
// image URLs, colors, and font. No account data, no PII, no secrets, and no
// per-visitor resolution beyond the per-host tenancy rule lib/theme.ts applies
// to every anonymous surface (KID-683: unknown subdomains get neutral "Kiddy").
export const dynamic = "force-dynamic";

// Caching this data: browsers hold a brand swap at most 5 minutes,
// and the app cache behind it expires after 30s (getBranding). No s-maxage:
// the response is host-dependent (tenant branding is keyed on the request
// origin) and a shared CDN cache keyed on the path alone could stamp one
// tenant's brand across another. Browser-level caching is per-origin, so it
// cannot cross tenants.
const cacheControl = "public, max-age=300, must-revalidate";

export async function GET() {
  try {
    const b = await getBranding();
    return new NextResponse(
      JSON.stringify({
        name: b.name,
        logoUrl: b.logoUrl,
        brandImageUrl: b.brandImageUrl,
        primaryColor: b.primaryColor,
        accentColor: b.accentColor,
        font: b.font,
      }),
      {
        status: 200,
        headers: { "Cache-Control": cacheControl },
      }
    );
  } catch {
    // Fallback when the datastore is unavailable: the same neutral defaults the
    // surfaces themselves render. Keep the cache short so a failed lookup does
    // not stick, but never zero (each caller is anonymous traffic on the
    // unauthenticated page render path).
    return new NextResponse(JSON.stringify({ name: "Kiddy", logoUrl: null }), {
      status: 200,
      headers: { "Cache-Control": "public, max-age=60, must-revalidate" },
    });
  }
}
