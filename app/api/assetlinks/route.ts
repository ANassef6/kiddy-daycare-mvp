import { NextResponse } from "next/server";
import { assetLinksForHost } from "@/lib/twa";

export const dynamic = "force-dynamic";

// KID-443 (defect 2): /.well-known/assetlinks.json is rewritten here
// (next.config.mjs) so Digital Asset Links for a tenant's TWA app are served
// as code through the same per-origin tenancy rule as every other tenant
// surface. Sunshine is the registry's first entry; since KID-459 its host
// publishes the Play package sunshine.kiddy.app plus the legacy test-TWA
// packages (see lib/twa.ts).
export async function GET() {
  try {
    const host = (await (await import("next/headers")).headers()).get("host");
    const statements = assetLinksForHost(host);
    if (!statements) {
      // Fail closed like the tenant surfaces: a host without a registered TWA
      // never publishes some other app's certification.
      return NextResponse.json(
        { error: { code: "no_twa_app", message: `No Android app published for ${host}` } },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(statements, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (err) {
    console.error("assetlinks host resolution failed:", err);
    return NextResponse.json(
      { error: { code: "internal", message: "assetlinks resolution failed" } },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
