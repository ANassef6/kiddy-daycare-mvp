// KID-199.3r (KID-212): white-label wildcard subdomains. Pure host/slug logic —
// no DB, no next/headers — so both the tenant resolver (lib/tenant.ts) and the
// unit tests can drive it directly.
//
// The board (KID-210): every daycare account is separate, served on its own
// wildcard subdomain — sunshine.domain.com, mapletree.domain.com, and so on.
// The apex domain is deployment configuration, never code:
//
//   PUBLIC_APEX_DOMAIN=domain.test
//
// With the apex unset, no hostname can be a daycare subdomain and every host
// keeps the pre-existing generic behavior — so previews (kiddy-one.vercel.app,
// vercel preview URLs, localhost, /platform) are untouched by default.

/** DNS label ceiling; 50 leaves headroom for a `-2`-style uniqueness suffix. */
const SLUG_MAX = 50;

/** First labels that stay platform infrastructure even under the apex.
 *  `www.<apex>` is marketing, `app.`/`platform.`/`admin.` are operator
 *  surfaces — a daycare named "Admin" must never capture them. `kiddy-one`
 *  keeps the historical Vercel deployment name off the tenant namespace. */
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "platform",
  "mail",
  "ftp",
  "kiddy-one",
]);

/** The configured apex domain (lowercase, no trailing dot, no port). Empty
 *  string when unset — which disables subdomain resolution entirely. */
export function apexDomain(): string {
  return (process.env.PUBLIC_APEX_DOMAIN ?? "")
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/\.$/, "");
}

/** URL-safe slug from a free-text daycare name (or a hand-typed subdomain
 *  field): diacritics folded, lowercase, `[a-z0-9-]`, single hyphens, no
 *  leading/trailing hyphen, DNS-length capped. Empty when nothing usable
 *  survives (e.g. a name written only in a non-Latin script) — the caller
 *  decides what that means (leave NULL, or ask the operator). */
export function normalizeSubdomainSlug(raw: string): string {
  const folded = String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const slug = folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return slug;
}

export type HostContext =
  | { kind: "apex"; slug: null } // the apex itself: generic behavior
  | { kind: "subdomain"; slug: string } // a candidate daycare subdomain
  | { kind: "generic"; slug: null }; // everything else (legacy hosts, localhost, previews)

/** Classify a request hostname against the configured apex. Port and trailing
 *  dot are stripped; only a single-label strict subdomain of the apex is a
 *  tenant candidate (`sunshine.<apex>`), so `evil.attacker.com`, deep nesting
 *  (`a.b.<apex>`) and reserved labels all stay generic. With no apex
 *  configured, every host is generic — the pre-KID-212 behavior. */
export function splitSubdomainHost(host: string | null | undefined): HostContext {
  const apex = apexDomain();
  if (!apex) return { kind: "generic", slug: null };
  const normalized = String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  if (!normalized || !normalized.includes(".")) return { kind: "generic", slug: null };
  // Never trust an IP-literal or a foreign domain as tenant evidence.
  if (/^[\d.]+$/.test(normalized) || normalized.includes(":")) return { kind: "generic", slug: null };
  if (normalized === apex) return { kind: "apex", slug: null };
  const suffix = `.${apex}`;
  if (!normalized.endsWith(suffix)) return { kind: "generic", slug: null };
  const label = normalized.slice(0, -suffix.length);
  // Only one label deep: `sunshine.<apex>` yes, `a.b.<apex>` no.
  if (!label || label.includes(".")) return { kind: "generic", slug: null };
  if (RESERVED_SUBDOMAINS.has(label)) return { kind: "apex", slug: null };
  if (normalizeSubdomainSlug(label) !== label) return { kind: "generic", slug: null };
  return { kind: "subdomain", slug: label };
}

/** `https://sunshine.<apex>` for a slug, for messages and operator hints. */
export function subdomainUrl(slug: string, proto = "https"): string {
  const apex = apexDomain();
  return apex ? `${proto}://${slug}.${apex}` : "";
}

/** KID-230: the URL an /platform "Open daycare" link is allowed to point at.
 *  Empty unless the apex is configured AND the stored slug is a usable,
 *  non-reserved tenant label — a reserved label (`kiddy-one`, `www`, …)
 *  resolves as generic platform behavior, never as that daycare's tenant
 *  (splitSubdomainHost), so it must never be linked. Empty means the caller
 *  renders a hint instead of a dead link. */
export function daycarePublicUrl(rawSlug: string | null | undefined, proto = "https"): string {
  const slug = normalizeSubdomainSlug(String(rawSlug ?? ""));
  if (!slug || RESERVED_SUBDOMAINS.has(slug)) return "";
  return subdomainUrl(slug, proto);
}

/** KID-227: where a failed inline subdomain edit lands — the error keyed to
 *  the edited row (`edit`) plus the exact typed prefix (`prefix`), so the row
 *  can show the message in place and re-fill the input with what the operator
 *  typed instead of silently reverting to the stored value. Pure so the
 *  server action and the unit tests drive the same encoding. */
export function subdomainEditErrorPath(
  instituteId: string,
  typed: string,
  reason: string
): string {
  const params = new URLSearchParams({
    error: reason,
    edit: instituteId,
    prefix: typed,
  });
  return `/platform?${params.toString()}`;
}
