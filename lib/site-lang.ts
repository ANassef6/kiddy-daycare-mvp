// KID-2072: pure helpers for the public marketing site's language switch.
// No request-scope imports — every function is driven by its arguments, so
// middleware (edge runtime), the /switch-lang route handler, page resolvers
// and unit tests can all share the exact same validation and parsing rules.
import { LOCALES, type Locale } from "./i18n";

// The public site's own language cookie. It is deliberately SEPARATE from the
// app's kiddy_lang device cookie: the app writes kiddy_lang too (Account
// Settings, the auth toggle), and a same-name duplicate (host-only +
// Domain=.kiddyapp.net, or different paths) shadows the newest value because
// the server reads the first duplicate. The site choice lives here and is
// always read last-duplicate-wins, so the visitor's most recent explicit
// choice on the site can never be shadowed.
export const SITE_LANG_COOKIE = "kiddy_site_lang";

/** A raw value as one of the supported locales, else null. Exact tokens
 *  only ("en" | "ar") — no locale-suffix guessing on cookie/query input. */
export function localeFromParam(value: string | null | undefined): Locale | null {
  const v = (value ?? "").trim().toLowerCase();
  return (LOCALES as readonly string[]).includes(v) ? (v as Locale) : null;
}

/** KID-2072 criterion 3: the switcher's `next` must be a same-origin absolute
 *  path. Everything else — external URLs, protocol-relative "//host", scheme
 *  URLs, backslash variants (browsers normalize "/\\evil.com" to a host),
 *  control characters, malformed encodings — is rejected so the redirect can
 *  never become an open redirect. Returns null when nothing usable remains. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  const v = next.trim();
  if (v.length === 0 || v.length > 2048) return null;
  if (!v.startsWith("/")) return null; // absolute same-origin path only
  if (v.startsWith("//")) return null; // protocol-relative → external origin
  if (v.includes("\\")) return null; // "\/evil.com" normalizes to a host
  if (v.includes("://")) return null; // scheme URL smuggled behind the slash
  if (/[\u0000-\u001f\u007f\s]/.test(v)) return null; // header-breaking chars
  try {
    const decoded = decodeURIComponent(v);
    if (decoded.startsWith("//") || decoded.includes("\\") || decoded.includes("://")) return null;
  } catch {
    return null; // malformed percent-encoding: refuse rather than guess
  }
  return v;
}

/** The LAST value of a cookie from a raw Cookie header. Duplicate names are
 *  legal in Cookie headers (host-only + Domain cookies, different paths) and
 *  the server's first-value reading is exactly what let a stale kiddy_lang
 *  shadow a fresh choice (KID-215 report). The site reads last-wins, so the
 *  most recent explicit write decides. Handles the RFC-quoted value form. */
export function lastCookieValue(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  let out: string | null = null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    out = value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  }
  return out;
}
