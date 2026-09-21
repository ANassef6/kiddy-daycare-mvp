import { headers } from "next/headers";

// Returns the origin of the current request, respecting reverse-proxy headers.
// Used for Supabase email-redirect URLs so confirmation/password-reset links
// point at the deployed host instead of localhost.
export function requestOrigin(): string {
  const h = headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (!host) return "";
  return `${proto}://${host}`;
}
