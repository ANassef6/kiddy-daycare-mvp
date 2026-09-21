// Client-safe role helpers. Do not import server-only modules here.
export function isAdminRole(role: string): boolean {
  return role === "owner" || role === "admin";
}
