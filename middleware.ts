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
//
// KID-2406: the marketing pages are now CDN-cacheable. A CDN cache key is the
// URL (cookies are deliberately excluded by Vercel), so the locale must be in
// the URL: Arabic rides ?lang=ar, English stays on the clean path, and a
// visitor whose cookie says Arabic is redirected (307) from the clean URL to
// the Arabic URL once per navigation. The response that actually renders HTML
// is marked cacheable for a short edge TTL; a first explicit ?lang request
// still writes the language cookie, and per the CDN rules a Set-Cookie
// response is simply not stored — the next request carries the cookie and
// takes the cacheable path. Internal links call withLang() so Arabic visitors
// do not pay that redirect on every click.
import { NextResponse, type NextRequest } from "next/server";
import { LANG_COOKIE } from "@/lib/i18n";
import { SITE_LANG_COOKIE, lastCookieValue, localeFromParam } from "@/lib/site-lang";

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

// KID-2406: short edge TTL, long stale-while-revalidate. Marketing copy rarely
// changes; a deploy purges the CDN cache automatically, and the 5-minute
// window bounds any other staleness. Browsers are asked to revalidate
// (max-age=0) so a deployment reaches them immediately.
export const MARKETING_CACHE_CONTROL =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=86400";

const LANG_COOKIE_OPTIONS = {
  path: "/",
  maxAge: 31536000,
  sameSite: "lax" as const,
};

function cookieLocale(request: NextRequest): "en" | "ar" | null {
  // LAST duplicate wins, same shadow-proof rule resolveSiteLocale uses.
  const raw = request.headers.get("cookie");
  return (
    localeFromParam(lastCookieValue(raw, SITE_LANG_COOKIE)) ??
    localeFromParam(lastCookieValue(raw, LANG_COOKIE))
  );
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  if (!PUBLIC_MARKETING_PATHS.includes(path)) {
    return NextResponse.next();
  }

  const searchParams = request.nextUrl.searchParams;
  const requestedLang = localeFromParam(searchParams.get("lang"));
  const isRead = request.method === "GET" || request.method === "HEAD";

  // KID-2406: normalize the Arabic URL so the CDN caches one variant per
  // language. An explicit valid ?lang always wins; otherwise the stored site
  // language decides. 307 keeps the method (GET/HEAD here) and the query.
  if (isRead && requestedLang !== "ar" && cookieLocale(request) === "ar") {
    const url = request.nextUrl.clone();
    url.searchParams.set("lang", "ar");
    return NextResponse.redirect(url, 307);
  }

  const headers = new Headers(request.headers);
  headers.set(PUBLIC_PAGE_HEADER, "1");

  if (searchParams.has("lang")) {
    searchParams.delete("lang");
  }
  const search = searchParams.toString();
  headers.set(
    PUBLIC_PATH_HEADER,
    search ? `${request.nextUrl.pathname}?${search}` : request.nextUrl.pathname
  );
  if (requestedLang) {
    headers.set(LANG_OVERRIDE_HEADER, requestedLang);
  }

  const response = NextResponse.next({ request: { headers } });

  const storedLang = cookieLocale(request);
  const langMatchesCookie = requestedLang !== null && requestedLang === storedLang;
  if (isRead && (!requestedLang || langMatchesCookie)) {
    // No cookie write below: this response is safe to share in the CDN cache
    // for this host + URL (the layout renders host branding, never session
    // branding, on the public pages).
    response.headers.set("Cache-Control", MARKETING_CACHE_CONTROL);
  }
  if (requestedLang && !langMatchesCookie) {
    // Best-effort persistence; the override header already covers this
    // request even when the browser refuses the cookies. The Set-Cookie
    // response is intentionally not CDN-cacheable.
    response.cookies.set(SITE_LANG_COOKIE, requestedLang, LANG_COOKIE_OPTIONS);
    response.cookies.set(LANG_COOKIE, requestedLang, LANG_COOKIE_OPTIONS);
  }
  return response;
}

export const config = {
  matcher: ["/", "/features", "/for-parents", "/for-centers", "/contact"],
};
