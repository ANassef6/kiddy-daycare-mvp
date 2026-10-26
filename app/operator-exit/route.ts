import { NextRequest, NextResponse } from "next/server";
import { apexDomain } from "@/lib/subdomain";
import { recordPlatformAccess } from "@/lib/operator-view";
import { readSessionFromCookieValue } from "@/lib/auth";

export const dynamic = "force-dynamic";

// KID-236: the operator-view banner's Exit. POST only — a GET would let the
// Next router's link prefetch (or any stray crawler hit) end a live operator
// view without the operator ever clicking Exit. Clears ONLY the host-only
// operator-view cookie on THIS daycare subdomain — the operator's own
// /platform session lives on the apex host and is never touched (no Domain
// attribute is ever set on either cookie, so the browser scopes each to its
// own host). The exit is recorded in the same audit trail as the entry, then
// the browser returns to https://<apex>/platform. Without an apex configured
// (local dev) the redirect stays relative on the current host — an
// environment that can never reach operator-entry in the first place.
export async function POST(request: NextRequest) {
  const session = readSessionFromCookieValue(request.cookies.get("kiddy_sess")?.value ?? null);
  if (session?.operatorViewInstituteId) {
    await recordPlatformAccess({
      event: "exit",
      operatorAccountId: session.accountId,
      operatorEmail: session.email,
      instituteId: session.operatorViewInstituteId,
    });
  }
  const apex = apexDomain();
  const origin = (() => {
    const host = request.headers.get("host") ?? "";
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return host ? `${proto}://${host}` : "";
  })();
  const res = NextResponse.redirect(
    apex ? `https://${apex}/platform` : new URL("/platform", origin || "http://localhost").toString(),
    303
  );
  // Host-only clear (no Domain): only this subdomain's operator-view cookie
  // is affected.
  res.cookies.set("kiddy_sess", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
