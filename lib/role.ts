// Client-safe role helpers. Do not import server-only modules here.
// KID-199.4r: there is no platform/superadmin role in this union any more.
// The /platform surface is gated by an env-based operator allowlist instead
// (lib/platform.ts). `isAdminRole` keeps its exact owner|admin semantics.
// KID-485: the staff-facing floor roles are Teacher (a full staff member with
// classroom-scoped access) and Caregiver (login + children area only, read
// only). The old `staff`/`carer` values are replaced by them; migration
// 0033 renames existing records and accounts.
export const ROLES = ["owner", "admin", "teacher", "caregiver", "parent"] as const;

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

// KID-485: the classroom-scoped staff floor. Both teacher and caregiver are
// non-admin staff members whose reach is limited to their assigned classrooms
// (lib/store.ts scopedRoomIds).
export function isTeacherRole(role: string): boolean {
  return role === "teacher";
}

export function isCaregiverRole(role: string): boolean {
  return role === "caregiver";
}

// KID-485: a floor staff member (teacher or caregiver) — used where the old
// checks read `me.role === "staff" || me.role === "carer"`.
export function isFloorStaffRole(role: string): boolean {
  return role === "teacher" || role === "caregiver";
}
