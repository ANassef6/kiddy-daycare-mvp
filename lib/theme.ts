export type Row = Record<string, unknown>;

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

// Builds the CSS custom-property theme block from branding so every surface
// consumes tokens only — swapping daycare branding is config, not code.
export function themeCss(b: Branding): string {
  return [
    `--brand-primary: ${b.primaryColor};`,
    `--brand-accent: ${b.accentColor};`,
    `--brand-font: '${b.font}', system-ui, sans-serif;`,
  ].join("\n");
}
