// Client-safe role helpers. Do not import server-only modules here.
// KID-199.3: `superadmin` is the platform operator role (KID-199.4 builds its
// /platform surface). It is deliberately NOT an admin/center role: center
// admin gates (`isAdminRole`) keep their exact owner|admin semantics.
export const ROLES = ["owner", "admin", "staff", "carer", "parent", "superadmin"] as const;

export type Role = (typeof ROLES)[number];

export function isSuperadminRole(role: string): boolean {
  return role === "superadmin";
}

export function isAdminRole(role: string): boolean {
  return role === "owner" || role === "admin";
}
