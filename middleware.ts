// KID-1826: public marketing routes mark their own requests so the root
// layout can skip the full-width brand banner (the tenant image moved inline
// into the site header lockup on those pages). The flag rides a request
// HEADER rather than a DOM attribute: the root layout is a server component,
// so the decision happens before any HTML ships — no flash, no CLS, and no
// dependence on client-side state that React hydration could strip. The
// matcher keeps middleware work to exactly the five public marketing paths;
// app/portal/auth surfaces never run it and keep the banner.
//
// KID-2072: the middleware also carries the public site's language plumbing:
//   - x-kiddy-lang-override: a valid ?lang= query param is promoted to a
//     REQUEST header so the page renders in that language for THIS request
//     even when cookies are unavailable (criterion 5; persistence stays
//     best-effort via the Set-Cookie below).
//   - x-kiddy-public-path: the current path + query (with any ?lang stripped)
//     so the no-JS switcher's hidden `next` returns the visitor to exactly
//     where they were. Stripping ?lang matters: a cookie-less browser that
//     pinned /contact?lang=ar would otherwise come back to a ?lang=ar URL
//     after switching to English and the override would fight the switch.
//   - Set-Cookie for the ?lang value (kiddy_site_lang + the legacy
//     kiddy_lang, same value) — best-effort persistence for app surfaces
//     that still read kiddy_lang.
import { NextResponse, type NextRequest } from "next/server";
import { LANG_COOKIE } from "@/lib/i18n";
import { SITE_LANG_COOKIE, localeFromParam } from "@/lib/site-lang";

export const PUBLIC_MARKETING_PATHS = [
  "/",
  "/features",
  "/for-parents",
  "/for-centers",
  "/contact",
];

export const PUBLIC_PAGE_HEADER = "x-kiddy-public-page";

// KID-2072: per-request ?lang override + the switcher's return path.
export const LANG_OVERRIDE_HEADER = "x-kiddy-lang-override";
export const PUBLIC_PATH_HEADER = "x-kiddy-public-path";

const LANG_COOKIE_OPTIONS = {
  path: "/",
  maxAge: 31536000,
  sameSite: "lax" as const,
};

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  if (!PUBLIC_MARKETING_PATHS.includes(path)) {
    return NextResponse.next();
  }

  const headers = new Headers(request.headers);
  headers.set(PUBLIC_PAGE_HEADER, "1");

  const searchParams = request.nextUrl.searchParams;
  const lang = localeFromParam(searchParams.get("lang"));
  if (searchParams.has("lang")) {
    searchParams.delete("lang");
  }
  const search = searchParams.toString();
  headers.set(
    PUBLIC_PATH_HEADER,
    search ? `${request.nextUrl.pathname}?${search}` : request.nextUrl.pathname
  );
  if (lang) {
    headers.set(LANG_OVERRIDE_HEADER, lang);
  }

  const response = NextResponse.next({ request: { headers } });
  if (lang) {
    // Best-effort persistence; the override header already covers this
    // request even when the browser refuses the cookies.
    response.cookies.set(SITE_LANG_COOKIE, lang, LANG_COOKIE_OPTIONS);
    response.cookies.set(LANG_COOKIE, lang, LANG_COOKIE_OPTIONS);
  }
  return response;
}

export const config = {
  matcher: ["/", "/features", "/for-parents", "/for-centers", "/contact"],
};
