import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, queryGet } from "@/lib/db";
import { getAccount } from "@/lib/auth";
import { isPlatformOperatorEmail } from "@/lib/platform";
import { instituteIdBySubdomain } from "@/lib/store";
import { splitSubdomainHost } from "@/lib/subdomain";
import {
  OPERATOR_VIEW_COOKIE_MAX_AGE_S,
  evaluateOperatorEntryGrant,
  operatorViewSessionToken,
  readOperatorEntryGrant,
  recordPlatformAccess,
} from "@/lib/operator-view";

export const dynamic = "force-dynamic";

// Reverse-proxy aware origin for the absolute redirects NextResponse requires
// (same shape as lib/url.ts requestOrigin, but from the route's own request).
function originOf(request: NextRequest): string {
  const host = request.headers.get("host") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

// KID-236: grant consumption — runs ON the daycare's own subdomain, so the
// HOST decides which tenant this is (the repo's one resolution rule). The
// grant is verified here against that host tenant: institute must match,
// nonce must be unspent, operator must still be on the allowlist, daycare
// must be enabled. A pass records the 'enter' audit row (the unique index
// makes it the single-use gate), sets the 60-minute operator-view cookie —
// host-only, so it can never ride along to the apex or another daycare —
// and 302s into /portal/dashboard. Every refusal lands on the friendly
// message paths the app already has. Sessions carry NO tenant identity of
// their own: while viewing tenant A nothing can read tenant B, because the
// host-scoped resolver (lib/tenant.ts) remains the only source of truth.
export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
  } catch (err) {
    console.error("KID-236 ensureSchema failed on operator-entry:", err);
  }
  const origin = originOf(request);
  if (!origin) return NextResponse.redirect(new URL("/login", "http://localhost").toString(), 302);
  const host = request.headers.get("host") ?? "";
  const ctx = splitSubdomainHost(host);
  // Not a daycare host: an entry grant is meaningless here (the apex and
  // legacy hosts keep their generic behavior — extend, never weaken).
  if (ctx.kind !== "subdomain") return NextResponse.redirect(`${origin}/login`, 302);
  const hostIid = await instituteIdBySubdomain(ctx.slug);
  // Unknown subdomain: the neutral error page, never tenant state.
  if (!hostIid) return NextResponse.redirect(`${origin}/unknown-daycare`, 302);

  const grant = readOperatorEntryGrant(request.nextUrl.searchParams.get("grant"));
  const [institute, operator] = await Promise.all([
    queryGet("SELECT id, active, name FROM institute WHERE id = ?", hostIid),
    grant ? getAccount(grant.operatorAccountId) : Promise.resolve(undefined),
  ]);
  const decision = evaluateOperatorEntryGrant(grant, {
    hostInstituteId: hostIid,
    institute: institute ?? null,
    operator: operator ? { role: String(operator.role), email: String(operator.email) } : null,
    operatorEmailAllowlisted: isPlatformOperatorEmail(grant?.operatorEmail ?? ""),
    nonceAlreadyUsed: false,
    nowMs: Date.now(),
  });
  if (!decision.ok) {
    // Refusal rows keep the nonce NULL — a refused grant is never consumed.
    await recordPlatformAccess({
      event: "refused",
      operatorAccountId: grant?.operatorAccountId ?? null,
      operatorEmail: grant?.operatorEmail ?? "",
      instituteId: hostIid,
      detail: decision.reason,
    });
    const target =
      decision.reason === "disabled"
        ? "/login?error=disabled-institute"
        : "/login?error=operator-entry-invalid";
    return NextResponse.redirect(`${origin}${target}`, 302);
  }
  // The atomic single-use gate: the 'enter' row carries the nonce and the
  // 0025 partial unique index refuses a second insert. false here = replay.
  const consumed = await recordPlatformAccess({
    event: "enter",
    operatorAccountId: grant!.operatorAccountId,
    operatorEmail: grant!.operatorEmail,
    instituteId: grant!.instituteId,
    nonce: grant!.nonce,
  });
  if (!consumed) {
    await recordPlatformAccess({
      event: "refused",
      operatorAccountId: grant!.operatorAccountId,
      operatorEmail: grant!.operatorEmail,
      instituteId: hostIid,
      detail: "replay",
    });
    return NextResponse.redirect(`${origin}/login?error=operator-entry-invalid`, 302);
  }
  const res = NextResponse.redirect(`${origin}/portal/dashboard`, 302);
  res.cookies.set("kiddy_sess", operatorViewSessionToken(grant!), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: OPERATOR_VIEW_COOKIE_MAX_AGE_S,
  });
  return res;
}
