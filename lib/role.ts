// Client-safe role helpers. Do not import server-only modules here.
// KID-199.4r: there is no platform/superadmin role in this union any more.
// The /platform surface is gated by an env-based operator allowlist instead
// (lib/platform.ts). `isAdminRole` keeps its exact owner|admin semantics.
export const ROLES = ["owner", "admin", "staff", "carer", "parent"] as const;

export type Role = (typeof ROLES)[number];

export function isAdminRole(role: string): boolean {
  return role === "owner" || role === "admin";
}
