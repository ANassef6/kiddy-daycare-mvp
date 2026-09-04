/* eslint-disable @typescript-eslint/no-explicit-any */
import { queryGet } from "./db";
import { getInstitute as storeGetInstitute } from "./store";
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
  const now = Date.now();
  if (_brandingCache && now - _brandingCache.at < BRANDING_TTL_MS) {
    return _brandingCache.value;
  }
  const first = await getFirstInstitute();
  const b = brandingFromInstitute(first);
  _brandingCache = { at: now, value: b };
  return b;
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