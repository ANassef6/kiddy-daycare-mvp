// KID-2460: the authenticated app-language switch.
//
// The Account Settings card used to submit a server action whose redirect was
// a client-side navigation. The App Router keeps already-mounted layouts, so
// the page segment re-rendered with the new dictionary while the root
// `<html lang dir>` and the portal sidebar stayed on the old one — the
// mixed Arabic-content / English-sidebar screenshot in the issue. A native
// form POST answered with 303 is a full document navigation: every shell,
// direction and nav label re-resolves from the saved account language.
//
// The endpoint writes only the signed-in account's own language, accepts the
// two locales the app ships, and sends the user back to a validated internal
// path (or the old role-based fallback). It is a no-JS path too.
import { NextResponse, type NextRequest } from "next/server";
import { LANG_COOKIE } from "@/lib/i18n";
import {
  homeForRole,
  readSessionFromCookie,
  setAccountLanguage,
} from "@/lib/auth";
import { safeNextPath } from "@/lib/site-lang";

export const dynamic = "force-dynamic";

const COOKIE_OPTIONS = {
  path: "/",
  maxAge: 31536000,
  sameSite: "lax" as const,
};

// A cross-site form could otherwise change a signed-in user's language. The
// browser sends Origin on cross-origin POSTs; Sec-Fetch-Site is the modern
// fallback. Both may be absent on older same-origin form submissions, which is
// fine — the only mutation possible here is the caller's own preference.
function sameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function fallbackPath(role: string): string {
  return homeForRole(role) === "/child" ? "/child" : "/portal/account";
}

function redirectTo(path: string): NextResponse {
  // A relative Location keeps reverse-proxy/alternate hosts correct — the
  // browser resolves it against the URL it just posted to. /switch-lang uses
  // the same form.
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Cross-origin language switch refused." } },
      { status: 403 }
    );
  }

  const form = await request.formData();
  const session = readSessionFromCookie(request.headers.get("cookie"));
  if (!session) return redirectTo("/login");

  const next = safeNextPath(String(form.get("next") ?? "")) ?? fallbackPath(session.role);
  const locale = String(form.get("locale") ?? "");
  if (locale !== "en" && locale !== "ar") return redirectTo(next);

  await setAccountLanguage(session.accountId, locale);

  const response = redirectTo(next);
  response.cookies.set(LANG_COOKIE, locale, COOKIE_OPTIONS);
  return response;
}
