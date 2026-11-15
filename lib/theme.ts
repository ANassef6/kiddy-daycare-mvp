/* eslint-disable @typescript-eslint/no-explicit-any */
import { queryGet } from "./db";
import { getInstitute as storeGetInstitute } from "./store";
import { readSessionFromCookie } from "./auth";
import { isPlatformOperatorRole } from "./platform";
import { primaryInstituteIdForAccount } from "./store";
import { splitSubdomainHost } from "./subdomain";
import type { Row } from "./db";

export async function getFirstInstitute(): Promise<Row | undefined> {
  const row = await queryGet("SELECT id FROM institute ORDER BY created_at LIMIT 1");
  return row ? storeGetInstitute(String(row.id)) : undefined;
}

export async function getInstitute(instituteId: string): Promise<Row | undefined> {
  return storeGetInstitute(instituteId);
}

export type Branding = {
  name: string;
  logoUrl: string | null;
  brandImageUrl: string | null;
  primaryColor: string;
  accentColor: string;
  font: string;
};

export function brandingFromInstitute(institute: Row | undefined): Branding {
  return {
    name: (institute?.name as string) ?? "Kiddy",
    logoUrl: (institute?.logo_url as string) ?? null,
    brandImageUrl: (institute?.brand_image_url as string) ?? null,
    primaryColor: (institute?.primary_color as string) ?? "#3B82F6",
    accentColor: (institute?.accent_color as string) ?? "#10B981",
    font: (institute?.font as string) ?? "Inter",
  };
}

// Cache the resolved branding for a few seconds so warm serverless requests
// skip the DB round trip. Branding config updates (the white-label swap test)
// still reflect within this window — no redeploy required.
const BRANDING_TTL_MS = 30_000;
let _brandingCache: { at: number; value: Branding } | null = null;
// KID-683: the generic-host slot now holds only the anonymous platform
// default (no tenant). Per-daycare subdomain branding is per HOST in the map
// below — a second daycare's subdomain would otherwise render the first
// cached brand for the TTL window.
const _hostBrandingCache = new Map<string, { at: number; value: Branding }>();

export async function getBranding(): Promise<Branding> {
  const now = Date.now();
  // KID-199.3r: on a daycare subdomain the HOST decides the brand — Sunshine's
  // address renders Sunshine, Maple's renders Maple, for signed-in and
  // anonymous visitors alike (the anonymous case is what fixes the "first
  // daycare renders everywhere" leak). An unknown subdomain gets neutral
  // Kiddy defaults — never a tenant, never the first institute.
  try {
    const h = await (await import("next/headers")).headers();
    const ctx = splitSubdomainHost(h.get("host"));
    if (ctx.kind === "subdomain") {
      const { instituteIdBySubdomain } = await import("./store");
      const hostIid = await instituteIdBySubdomain(ctx.slug);
      if (!hostIid) return brandingFromInstitute(undefined);
      const cached = _hostBrandingCache.get(hostIid);
      if (cached && now - cached.at < BRANDING_TTL_MS) return cached.value;
      const b = brandingFromInstitute(await storeGetInstitute(hostIid));
      _hostBrandingCache.set(hostIid, { at: now, value: b });
      return b;
    }
  } catch {
    // no request scope (tests/scripts): the anonymous/session path below
  }
  // Signed-in on a generic host: branding follows the session's own daycare.
  // Signed-in staff/parents resolve per request — no cache, or the second
  // daycare would render the first daycare's brand for 30s.
  let institute: Row | undefined;
  let sessionResolved = false;
  try {
    const headers = (await import("next/headers")).headers;
    const session = readSessionFromCookie((await headers()).get("cookie"));
    if (session) {
      sessionResolved = true;
      if (isPlatformOperatorRole(session.role)) {
        institute = undefined;
      } else {
        const iid = await primaryInstituteIdForAccount(session.accountId);
        institute = iid ? await storeGetInstitute(iid) : undefined;
      }
    }
  } catch {
    // no request scope (tests/scripts): nothing to resolve
  }
  // KID-683: anonymous visitors on generic hosts (kiddyapp.net landing pages,
  // /login, /register, password reset) see ONLY the platform brand. The
  // legacy first-institute fallback leaked the first-created daycare's name,
  // logo and brand image onto the public portal. A daycare's brand reaches an
  // anonymous caller solely through its own subdomain (handled above).
  if (!sessionResolved) {
    const b = brandingFromInstitute(undefined);
    _brandingCache = { at: now, value: b };
    return b;
  }
  // Signed-in: own daycare's branding (trust the tenancy resolver, which
  // handles the no-tenancy fallback itself; platform operator = no tenant =
  // defaults, KID-199.4r).
  return brandingFromInstitute(institute);
}

// KID-2406: the public marketing pages are CDN-cacheable, so their branding
// must depend ONLY on the Host header (which is part of the CDN cache key) and
// never on the visitor's session. A signed-in visitor on the apex therefore
// sees the same generic Kiddy chrome the anonymous audience sees, and a
// daycare subdomain's page keeps naming that daycare. Generic hosts do no DB
// work at all, which is what lets an anonymous landing request render without
// a database round trip.
export async function getHostBranding(host?: string | null): Promise<Branding> {
  let hostname = host;
  if (hostname === undefined) {
    try {
      hostname = (await (await import("next/headers")).headers()).get("host");
    } catch {
      hostname = null;
    }
  }
  try {
    const ctx = splitSubdomainHost(hostname);
    if (ctx.kind === "subdomain") {
      const now = Date.now();
      const { instituteIdBySubdomain } = await import("./store");
      const hostIid = await instituteIdBySubdomain(ctx.slug);
      if (!hostIid) return brandingFromInstitute(undefined);
      const cached = _hostBrandingCache.get(hostIid);
      if (cached && now - cached.at < BRANDING_TTL_MS) return cached.value;
      const b = brandingFromInstitute(await storeGetInstitute(hostIid));
      _hostBrandingCache.set(hostIid, { at: now, value: b });
      return b;
    }
  } catch (err) {
    console.error("Host branding resolution failed:", err);
  }
  return brandingFromInstitute(undefined);
}

// KID-2406: host-only document title brand for the CDN-cached marketing
// pages — same rule as getHostBranding, no session lookup (a per-user title
// would otherwise be stored in the shared cache).
export async function brandNameForHostTitle(host?: string | null): Promise<string> {
  try {
    return (await getHostBranding(host)).name;
  } catch (err) {
    console.error("Host title brand resolution failed:", err);
    return "Kiddy";
  }
}

// KID-435: the document title brand. The white-label wiring (KID-256) makes
// the install meta (theme-color / manifest / apple-touch-icon) follow the
// host's brand, but the title metadata stayed hardcoded "Kiddy" — so the
// Sunshine install kept browser tabs and PWA shells naming a different
// brand than its own theme. Rule mirrors the manifest's host rule and never
// leaks a daycare brand onto a host that did not ask for it:
//   - a KNOWN daycare subdomain names that tenant (anonymous and signed-in
//     alike, same precedence as getBranding);
//   - a signed-in non-operator account on a generic host names its own
//     daycare (same as getBranding's signed-in path);
//   - everything else — apex/legacy/unknown hosts, anonymous or no-tenancy —
//     stays generic Kiddy: no first-institute fallback here, because the
//     title brand must not follow whichever demo daycare is created first.
export async function brandNameForTitle(): Promise<string> {
  try {
    const h = await (await import("next/headers")).headers();
    const ctx = splitSubdomainHost(h.get("host"));
    if (ctx.kind === "subdomain") {
      const { instituteIdBySubdomain } = await import("./store");
      const hostIid = await instituteIdBySubdomain(ctx.slug);
      if (!hostIid) return "Kiddy";
      return brandingFromInstitute(await storeGetInstitute(hostIid)).name;
    }
  } catch (err) {
    console.error("brandNameForTitle host resolution failed:", err);
    return "Kiddy";
  }
  try {
    const headers = (await import("next/headers")).headers;
    const session = readSessionFromCookie((await headers()).get("cookie"));
    if (session && !isPlatformOperatorRole(session.role)) {
      const iid = await primaryInstituteIdForAccount(session.accountId);
      if (iid) {
        return brandingFromInstitute(await storeGetInstitute(iid)).name;
      }
    }
  } catch (err) {
    console.error("brandNameForTitle session resolution failed:", err);
  }
  return "Kiddy";
}

// KID-493: the branding upload / save actions purge this short-lived cache so
// a new logo or brand-image banner shows on the very next navigation instead
// of after the 30s TTL window (the banner renders in the root layout, which
// also serves anonymous login pages fed by the cacheable path above).
export function clearBrandingCache(): void {
  _brandingCache = null;
  _hostBrandingCache.clear();
}

// Builds the CSS custom-property theme block from branding so every surface
// consumes tokens only — swapping daycare branding is config, not code.
export function themeCss(b: Branding): string {
  return [
    `--brand-primary: ${b.primaryColor};`,
    `--brand-accent: ${b.accentColor};`,
    `--brand-font: '${b.font}', system-ui, sans-serif;`,
  ].join("\n");
}