// KID-2072: the public marketing site's server-side EN/AR switch endpoint.
// The site switcher used to be client-JS-only (write kiddy_lang, reload), so
// the switch silently did nothing when JavaScript was disabled, blocked, or
// not yet hydrated — and a duplicate kiddy_lang cookie could shadow the new
// choice (KID-215 report). This route handles the switch ON THE SERVER:
//
//   GET /switch-lang?lang=ar&next=%2Fcontact%3Fa%3D1
//     → Set-Cookie: kiddy_site_lang=ar (the site's own, shadow-proof cookie)
//     → Set-Cookie: kiddy_lang=ar (synced so app surfaces that still read it
//       — login gate, forgot-password, rate-limited — follow the visitor)
//     → 303 See Other back to `next` (validated same-origin absolute path;
//       anything else falls back to "/").
//
// A GET link/form is deliberate: it is the no-JavaScript path. The state
// change is a benign per-device language preference, and `next` is refused
// unless it is a same-origin path, so the endpoint cannot be abused as an
// open redirect.
import { NextResponse, type NextRequest } from "next/server";
import { LANG_COOKIE } from "@/lib/i18n";
import { SITE_LANG_COOKIE, localeFromParam, safeNextPath, withLang } from "@/lib/site-lang";

const COOKIE_OPTIONS = { path: "/", maxAge: 31536000, sameSite: "lax" as const };

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lang = localeFromParam(params.get("lang"));
  // Criterion 3: preserve the current path + query; reject external,
  // protocol-relative, and scheme URLs. "/" is the safe fallback.
  const next = safeNextPath(params.get("next")) ?? "/";
  if (!lang) {
    // No/unknown lang: a plain bounce back — the existing preference stands.
    return new NextResponse(null, { status: 303, headers: { Location: next } });
  }
  // KID-2406: land directly on the cacheable Arabic URL instead of bouncing
  // through the middleware redirect on the next request.
  const target = lang === "ar" ? withLang(next, "ar") : next;
  const response = new NextResponse(null, { status: 303, headers: { Location: target } });
  response.cookies.set(SITE_LANG_COOKIE, lang, COOKIE_OPTIONS);
  response.cookies.set(LANG_COOKIE, lang, COOKIE_OPTIONS);
  return response;
}
