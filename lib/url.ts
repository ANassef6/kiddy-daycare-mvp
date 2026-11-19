import { headers } from "next/headers";

// Returns the origin of the current request, respecting reverse-proxy headers.
// Used for Supabase email-redirect URLs so confirmation/password-reset links
// point at the deployed host instead of localhost.
// Next 15: headers() is async, so this is a promise now — callers await it.
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (!host) return "";
  return `${proto}://${host}`;
}

// Public origin for parent-facing mail links (KID-119). Parent devices fetch
// the link, so it must be the deployed host — never the sender's localhost.
// Prefers NEXT_PUBLIC_SITE_URL (trimmed of trailing slashes); falls back to
// the request origin (or the explicitly passed fallback) when unset.
export async function publicOrigin(fallbackOrigin = ""): Promise<string> {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const fallback = fallbackOrigin.trim().replace(/\/+$/, "");
  if (fallback) return fallback;
  try {
    return (await requestOrigin()).replace(/\/+$/, "");
  } catch {
    return "";
  }
}

// KID-2441: password-reset links must return the visitor to the surface they
// started on. Production sets NEXT_PUBLIC_SITE_URL=https://kiddyapp.net, which
// is correct for general parent mail but wrong for a Sunshine parent who
// requested the reset on sunshine.kiddyapp.net: the apex link loses the tenant
// brand (and any host-specific sign-in context). Keep the request origin when
// it is the configured host or a subdomain of PUBLIC_APEX_DOMAIN; otherwise use
// the configured site URL so previews and localhost still get a valid link.
export function resetOriginFor(
  requestUrl: string,
  configuredSiteUrl: string,
  apexDomain: string
): string {
  const configured = configuredSiteUrl.trim().replace(/\/+$/, "");
  const fallback = configured || requestUrl.trim().replace(/\/+$/, "");
  try {
    const request = new URL(requestUrl);
    const host = request.hostname.toLowerCase().replace(/\.$/, "");
    const configuredHost = configured ? new URL(configured).hostname.toLowerCase().replace(/\.$/, "") : "";
    const apex = apexDomain.trim().toLowerCase().replace(/^\.+/, "").replace(/\.$/, "");
    const matchesApex = !!apex && (host === apex || host.endsWith(`.${apex}`));
    if (host && (host === configuredHost || matchesApex)) return request.origin;
  } catch {
    // Fall through to the configured/fallback origin.
  }
  return fallback;
}

export async function resetRedirectOrigin(fallbackOrigin = ""): Promise<string> {
  const requestUrl = fallbackOrigin || (await requestOrigin());
  return resetOriginFor(
    requestUrl,
    process.env.NEXT_PUBLIC_SITE_URL ?? "",
    process.env.PUBLIC_APEX_DOMAIN ?? ""
  );
}
