// KID-199.4r: the platform operator is NOT a daycare role.
//
// The board decision (KID-210): "The superadmin is not a role. It's just a
// separate page." So the daycare role system (`lib/role.ts`) now stops at the
// five real center/parent roles, and /platform access is decided by an
// env-based operator allowlist instead:
//
//   PLATFORM_ADMIN_EMAIL=ceo@example.test[,coo@example.test,...]
//
// The list is checked in the /platform page guard (app/platform/*) and
// re-checked inside every platform server action (`requirePlatformOperator`
// in lib/actions.ts). It can never be assigned to a daycare account by any
// UI or API, and no daycare role implies it — see docs/PLATFORM_BOOTSTRAP.md
// for how production obtains access.

/** Internal-only sentinel stored on the bootstrap operator's account row.
 *  Deliberately absent from `ROLES` — it is never offered to, or assignable
 *  by, any daycare surface; it exists so tenant resolution can tell platform
 *  sessions apart from daycare sessions. */
export const PLATFORM_OPERATOR_ROLE = "platform";

/** KID-199.3 rows carried this value; migration 0023 renames them. Kept only
 *  so `ensurePlatformOperator` can upgrade an existing dataset in place. */
export const PLATFORM_OPERATOR_LEGACY_ROLE = "superadmin";

/** The operator allowlist. Comma-separated emails are supported so a platform
 *  can have more than one operator without code changes. The first
 *  non-empty value of PLATFORM_ADMIN_EMAIL / SUPERADMIN_EMAIL wins; the demo
 *  address is the last resort so a mis-set empty env never locks /platform
 *  for everyone. */
export function platformAdminEmails(): string[] {
  const candidates = [process.env.PLATFORM_ADMIN_EMAIL, process.env.SUPERADMIN_EMAIL];
  const raw = candidates.map((v) => (v ?? "").trim()).find(Boolean) ?? "superadmin@kiddy.test";
  return raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformOperatorEmail(email: string | null | undefined): boolean {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return platformAdminEmails().includes(normalized);
}

/** True only for the internal platform-operator session value (never for any
 *  daycare role, and never surfaced as one). */
export function isPlatformOperatorRole(role: string): boolean {
  return role === PLATFORM_OPERATOR_ROLE;
}

// KID-199.4r: the "choose theme" presets for the create-daycare form. Each
// preset maps onto the existing branding tokens the daycare already stores
// (institute.primary_color / accent_color / font), so it flows through the
// same themeCss pipeline as every other tenant — no separate theme system.
export const PLATFORM_THEMES = {
  ocean: { primaryColor: "#3B82F6", accentColor: "#10B981", font: "Inter" },
  sunset: { primaryColor: "#F59E0B", accentColor: "#EF4444", font: "Poppins" },
  forest: { primaryColor: "#10B981", accentColor: "#84CC16", font: "Nunito" },
  midnight: { primaryColor: "#4F46E5", accentColor: "#7C3AED", font: "Inter" },
} as const;

export type PlatformThemeKey = keyof typeof PLATFORM_THEMES;

export const PLATFORM_THEME_KEYS = Object.keys(PLATFORM_THEMES) as PlatformThemeKey[];

export function defaultThemeTokens(theme: string): {
  primaryColor: string;
  accentColor: string;
  font: string;
} {
  return PLATFORM_THEMES[theme as PlatformThemeKey] ?? PLATFORM_THEMES.ocean;
}
