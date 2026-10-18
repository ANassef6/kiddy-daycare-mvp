/* eslint-disable @typescript-eslint/no-explicit-any */
import { queryGet } from "./db";
import { getInstitute as storeGetInstitute } from "./store";
import { readSessionFromCookie } from "./auth";
import { isSuperadminRole } from "./role";
import { primaryInstituteIdForAccount } from "./store";
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

export async function getBranding(): Promise<Branding> {
  // KID-199.3: branding follows the session's own daycare. Anonymous visitors
  // (login/landing) keep the legacy first-institute branding and the TTL cache.
  // Signed-in staff/parents resolve per request — no cache, or the second
  // daycare would render the first daycare's brand for 30s.
  const now = Date.now();
  let institute: Row | undefined;
  let cacheable = false;
  try {
    const headers = (await import("next/headers")).headers;
    const session = readSessionFromCookie(headers().get("cookie"));
    if (session) {
      if (isSuperadminRole(session.role)) {
        institute = undefined;
      } else {
        const iid = await primaryInstituteIdForAccount(session.accountId);
        institute = iid ? await storeGetInstitute(iid) : undefined;
      }
    } else {
      cacheable = true;
    }
  } catch {
    // no request scope (tests/scripts): use the legacy fallback path
    cacheable = true;
  }
  if (cacheable) {
    if (_brandingCache && now - _brandingCache.at < BRANDING_TTL_MS) {
      return _brandingCache.value;
    }
    institute = await getFirstInstitute();
    const b = brandingFromInstitute(institute);
    _brandingCache = { at: now, value: b };
    return b;
  }
  // Signed-in: own daycare's branding (trust the tenancy resolver, which
  // handles the no-tenancy fallback itself; superadmin = no tenant = defaults).
  return brandingFromInstitute(institute);
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