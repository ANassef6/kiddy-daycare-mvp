// Client-safe role helpers. Do not import server-only modules here.
// KID-199.4r: there is no platform/superadmin role in this union any more.
// The /platform surface is gated by an env-based operator allowlist instead
// (lib/platform.ts). `isAdminRole` keeps its exact owner|admin semantics.
export const ROLES = ["owner", "admin", "staff", "carer", "parent"] as const;

export type Role = (typeof ROLES)[number];

export function isAdminRole(role: string): boolean {
  return role === "owner" || role === "admin";
}

// KID-246: the "Account billing" surface is the daycare owner's own — the
// plain admin (a staff-level manager) must not see or reach the daycare's
// subscription plan, rates or invoices. Ownership is the ACCOUNT role
// ("owner", lib/auth), not the staff row, so an admin-role staff account is
// excluded even at the same daycare.
export function isOwnerRole(role: string): boolean {
  return role === "owner";
}
