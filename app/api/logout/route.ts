import { NextResponse } from "next/server";
import { requestOrigin } from "@/lib/url";

export const dynamic = "force-dynamic";

// KID-178 item 7: sign-out must land on the login page — never on
// localhost:3000 and not the marketing home. The redirect reuses the current
// request origin (reverse-proxy aware) with /login appended; when no request
// scope exists, the bare "/login" path is sent and the browser keeps the
// host it is already on.
// NextResponse.redirect only accepts absolute URLs, so the fallback branch
// constructs one on a throwaway base and rewrites the Location header down
// to the bare path.
function logoutResponse(): NextResponse {
  const origin = requestOrigin();
  const res = NextResponse.redirect(origin ? origin : "http://localhost", { status: 302 });
  res.headers.set("location", origin ? `${origin}/login` : "/login");
  res.cookies.set("kiddy_sess", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

export function GET() {
  return logoutResponse();
}

export function POST() {
  return GET();
}
