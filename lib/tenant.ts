// KID-199.3: session-aware tenancy. Server-only (reads request headers).
//
// History: every portal/parent page used to resolve its daycare with a
// "first institute created wins" query (firstInstituteId(), institutes[0],
// getFirstInstitute()). With more than one daycare in the table every user --
// staff and parents of the second daycare included -- landed on the FIRST
// daycare's data and branding. The fix is one resolution rule used everywhere:
//
//   platform operator -> no tenant (""), the /platform surface (KID-199.4)
//                 picks daycares explicitly. Their session role is an
//                 internal sentinel (`lib/platform.ts`), not a daycare role.
//   staff      -> their staff row's institute.
//   parent     -> their KID-152 tenancy set (invites + family links), earliest
//                 institute first.
//   no session -> the legacy first-institute fallback, which is also what
//                 public (logged-out) pages render.
//
// `instituteIdsForAccount` (KID-152) stays untouched as the parent-side
// tenancy definition; this module only consumes it.
import { headers } from "next/headers";
import { isPlatformOperatorRole } from "./platform";
import { primaryInstituteIdForAccount } from "./store";

/** Legacy fallback: the first-created institute. Still right for public pages
 *  (login/landing branding) and single-institute deployments.
 */
export async function fallbackInstituteId(): Promise<string> {
  const { queryGet } = await import("./db");
  const row = await queryGet("SELECT id FROM institute ORDER BY created_at LIMIT 1");
  return String(row?.id ?? "");
}

/** Resolve the session's tenant from a raw Cookie header (no next/headers
 *  dependency, so it is directly testable).
 */
export async function tenantInstituteIdForCookie(cookie: string | null | undefined): Promise<string> {
  const { readSessionFromCookie } = await import("./auth");
  const session = readSessionFromCookie(cookie);
  if (session && isPlatformOperatorRole(session.role)) return "";
  if (session) {
    return primaryInstituteIdForAccount(session.accountId);
  }
  return fallbackInstituteId();
}

/** The resolver pages and actions call. Falls back to the legacy first
 *  institute when called outside a request scope (tests, seed scripts).
 */
export async function resolveTenantInstituteId(): Promise<string> {
  let cookie: string | null = null;
  try {
    cookie = headers().get("cookie");
  } catch {
    cookie = null;
  }
  return tenantInstituteIdForCookie(cookie);
}
