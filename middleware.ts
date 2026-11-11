// KID-1826: public marketing routes mark their own requests so the root
// layout can skip the full-width brand banner (the tenant image moved inline
// into the site header lockup on those pages). The flag rides a request
// HEADER rather than a DOM attribute: the root layout is a server component,
// so the decision happens before any HTML ships — no flash, no CLS, and no
// dependence on client-side state that React hydration could strip. The
// matcher keeps middleware work to exactly the five public marketing paths;
// app/portal/auth surfaces never run it and keep the banner.
import { NextResponse, type NextRequest } from "next/server";

export const PUBLIC_MARKETING_PATHS = [
  "/",
  "/features",
  "/for-parents",
  "/for-centers",
  "/contact",
];

export const PUBLIC_PAGE_HEADER = "x-kiddy-public-page";

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  if (PUBLIC_MARKETING_PATHS.includes(path)) {
    const headers = new Headers(request.headers);
    headers.set(PUBLIC_PAGE_HEADER, "1");
    return NextResponse.next({ request: { headers } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/features", "/for-parents", "/for-centers", "/contact"],
};
