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
// KID-199.3r (KID-212): a REQUEST-level host resolver wraps that session
// resolver. On a daycare subdomain (`sunshine.<apex>`, apex from
// PUBLIC_APEX_DOMAIN) the HOST decides the tenant first:
//
//   /login, /portal/*, /child/* and branding serve ONLY that tenant —
//   including for anonymous visitors, which is what fixes the "first daycare
//   renders everywhere" leak the legacy fallback caused once more than one
//   daycare exists.
//
//   A session belonging to a DIFFERENT daycare is fail-closed refused (kind
//   "cross-tenant"): no data and no signed-in state on this host, with a
//   clear "this account belongs to <other>" message. This repo has a
//   cross-tenant leak history (KID-152, KID-207); `resolveRequestTenantFor`
//   is the pure function the unit tests pin.
//
//   An unknown subdomain is "unknown-host": the neutral error page, never
//   tenant data.
//
//   Apex and other legacy hosts (kiddy-one.vercel.app, previews, localhost)
//   keep the generic KID-199.3 behavior exactly.
//
// `instituteIdsForAccount` (KID-152) stays untouched as the parent-side
// tenancy definition; this module only consumes it.
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isPlatformOperatorRole } from "./platform";
import { primaryInstituteIdForAccount, instituteIdBySubdomain, tenancyInstitutesForAccount } from "./store";
import { splitSubdomainHost, subdomainUrl } from "./subdomain";
import { LANG_COOKIE, getDictionary, localeOf, tr, type Locale } from "./i18n";

// KID-368 (DEF-004): the login host gate's wording follows the visitor's
// language — the kiddy_lang cookie wins (same precedence as app/layout.tsx
// resolveLocale); pre-login there is no session preference to fall back on.
function loginGateDict(): { lang: Locale; t: (key: string, vars?: Record<string, string | number>) => string } {
  let lang: Locale = "en";
  try {
    const v = cookies().get(LANG_COOKIE)?.value;
    if (v) lang = localeOf(v);
  } catch {
    // no request scope (tests) — stays English
  }
  const dict = getDictionary(lang);
  return { lang, t: (key, vars) => tr(dict, key, vars) };
}

/** Legacy fallback: the first-created institute. Still right for public pages
 *  (login/landing branding) and single-institute deployments on generic hosts.
 */
export async function fallbackInstituteId(): Promise<string> {
  const { queryGet } = await import("./db");
  const row = await queryGet("SELECT id FROM institute ORDER BY created_at LIMIT 1");
  return String(row?.id ?? "");
}

/** Resolve the session's tenant from a raw Cookie header (no next/headers
 *  dependency, so it is directly testable). Generic hosts only — on a daycare
 *  subdomain `resolveRequestTenantFor` decides. */
export async function tenantInstituteIdForCookie(cookie: string | null | undefined): Promise<string> {
  const { readSessionFromCookie } = await import("./auth");
  const session = readSessionFromCookie(cookie);
  // KID-236: an operator-view session is bound to one daycare subdomain and
  // exists only on that host. On any generic host it resolves NO tenant —
  // fail closed, exactly like the platform sentinel below — so a copied view
  // cookie can never borrow a generic host's legacy first-institute fallback.
  if (session?.operatorViewInstituteId) return "";
  if (session && isPlatformOperatorRole(session.role)) return "";
  if (session) {
    return primaryInstituteIdForAccount(session.accountId);
  }
  return fallbackInstituteId();
}

export type RequestTenant =
  | { kind: "generic"; instituteId: string } // apex / legacy host: session-aware rule
  | { kind: "host"; instituteId: string } // a known daycare subdomain: everyone here reads this tenant
  | { kind: "unknown-host"; instituteId: "" } // subdomain no daycare claims: neutral error page
  | { kind: "cross-tenant"; instituteId: "" }; // session of another daycare: fail closed, no data

/** The host→tenant rule, pure in its inputs (cookie header + host header) so
 *  tests can drive it without a request scope. See the module header for the
 *  layered design. */
export async function resolveRequestTenantFor(
  cookie: string | null | undefined,
  host: string | null | undefined
): Promise<RequestTenant> {
  const ctx = splitSubdomainHost(host);
  if (ctx.kind !== "subdomain") {
    return { kind: "generic", instituteId: await tenantInstituteIdForCookie(cookie) };
  }
  const hostIid = await instituteIdBySubdomain(ctx.slug);
  if (!hostIid) return { kind: "unknown-host", instituteId: "" };
  const { readSessionFromCookie } = await import("./auth");
  const session = readSessionFromCookie(cookie);
  // KID-236: an operator-view session is accepted ONLY for its bound
  // institute on its own host. A view cookie presented on any other daycare
  // subdomain is a cross-tenant refusal (fail closed) — the same treatment a
  // foreign daycare account gets. This check must precede the role checks:
  // the session's effective role reads back as the daycare admin, and only
  // the marker can tell it apart from a real admin session.
  if (session?.operatorViewInstituteId) {
    return String(session.operatorViewInstituteId) === hostIid
      ? { kind: "host", instituteId: hostIid }
      : { kind: "cross-tenant", instituteId: "" };
  }
  // Anonymous visitors and the platform operator (no daycare tenancy, and
  // /platform is an apex surface) both see the host's own tenant.
  if (!session || isPlatformOperatorRole(session.role)) {
    return { kind: "host", instituteId: hostIid };
  }
  // Fail closed on tenancy evidence, never on the first-institute fallback: an
  // account belongs to this subdomain only when its OWN records say so.
  const tenancy = await tenancyInstitutesForAccount(session.accountId);
  const belongs = tenancy.some((i) => String(i.id) === hostIid);
  return belongs ? { kind: "host", instituteId: hostIid } : { kind: "cross-tenant", instituteId: "" };
}

/** The resolver pages and actions call. Falls back to the generic (apex) rule
 *  when called outside a request scope (tests, seed scripts).
 */
export async function resolveTenantInstituteId(): Promise<string> {
  let cookie: string | null = null;
  let host: string | null = null;
  try {
    cookie = headers().get("cookie");
    host = headers().get("host");
  } catch {
    cookie = null;
    host = null;
  }
  return (await resolveRequestTenantFor(cookie, host)).instituteId;
}

/** Guard for the tenant surfaces (portal/child/login layouts): unknown
 *  subdomains land on the neutral error page; a session of ANOTHER daycare is
 *  fail-closed refused with the "belongs to <other>" message. Returns the
 *  request's tenant institute id otherwise. */
export async function requireTenantForPage(): Promise<string> {
  let cookie: string | null = null;
  let host: string | null = null;
  try {
    cookie = headers().get("cookie");
    host = headers().get("host");
  } catch {
    cookie = null;
    host = null;
  }
  const rt = await resolveRequestTenantFor(cookie, host);
  if (rt.kind === "unknown-host") redirect("/unknown-daycare");
  if (rt.kind === "cross-tenant") {
    // The tenant param carries the account's own daycare name for the login
    // message. It is our own DB text, and React renders it as text.
    const tenancy = await (async () => {
      const { readSessionFromCookie } = await import("./auth");
      const session = readSessionFromCookie(cookie);
      return session ? tenancyInstitutesForAccount(session.accountId) : [];
    })();
    const ownName = tenancy[0]?.name ? String(tenancy[0].name) : "";
    redirect(`/login?error=wrong-tenant${ownName ? `&tenant=${encodeURIComponent(ownName)}` : ""}`);
  }
  return rt.instituteId;
}

/** Neutral-host gate for the login surface: an unknown subdomain lands on the
 *  neutral error page. Deliberately NOT the full guard — /login must render
 *  on a known subdomain (that is where a wrong-host visitor is sent), so the
 *  cross-tenant case is handled by the login form's host gate instead. */
export async function redirectToNeutralOnUnknownHost(): Promise<void> {
  let host: string | null = null;
  try {
    host = headers().get("host");
  } catch {
    host = null;
  }
  const ctx = splitSubdomainHost(host);
  if (ctx.kind !== "subdomain") return;
  const hostIid = await instituteIdBySubdomain(ctx.slug);
  if (!hostIid) redirect("/unknown-daycare");
}

/** Login-time host gate (loginAction): credentials of a daycare account are
 *  only valid on that daycare's own subdomain. Returns the friendly error
 *  instead of a session, so a Sunshine account on the Maple subdomain is
 *  never signed in there — never silently, and never with a generic message.
 *  Operator accounts are platform-wide and exempt. */
export async function loginHostGate(
  accountId: string,
  role: string,
  host: string | null | undefined
): Promise<{ error: string } | null> {
  const ctx = splitSubdomainHost(host);
  if (ctx.kind !== "subdomain") return null;
  if (isPlatformOperatorRole(role)) return null;
  const hostIid = await instituteIdBySubdomain(ctx.slug);
  if (!hostIid) return null; // unknown host: the login layout already redirected
  const tenancy = await tenancyInstitutesForAccount(accountId);
  if (tenancy.some((i) => String(i.id) === hostIid)) return null;
  const ownName = tenancy[0]?.name ? String(tenancy[0].name) : "";
  const ownUrl = tenancy[0]?.subdomain ? subdomainUrl(String(tenancy[0].subdomain)) : "";
  // KID-368 (DEF-004): localized wording; the daycare's own name and URL are
  // proper nouns interpolated as data.
  const { t } = loginGateDict();
  if (ownName && ownUrl) {
    return { error: t("login.wrongTenantHome", { name: ownName, url: ownUrl }) };
  }
  if (ownName) {
    return { error: t("login.wrongTenantOwn", { name: ownName }) };
  }
  return { error: t("login.wrongTenant") };
}
