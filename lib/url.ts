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

// Public origin for parent-facing mail links (KID-119). Parent devices fetch
// the link, so it must be the deployed host — never the sender's localhost.
// Prefers NEXT_PUBLIC_SITE_URL (trimmed of trailing slashes); falls back to
// the request origin (or the explicitly passed fallback) when unset.
export function publicOrigin(fallbackOrigin = ""): string {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const fallback = fallbackOrigin.trim().replace(/\/+$/, "");
  if (fallback) return fallback;
  try {
    return requestOrigin().replace(/\/+$/, "");
  } catch {
    return "";
  }
}
