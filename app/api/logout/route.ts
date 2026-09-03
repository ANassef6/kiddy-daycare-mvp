import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const res = NextResponse.redirect(new URL("/", process.env.NEXTAUTH_URL ?? "http://localhost:3000"));
  res.cookies.set("kiddy_sess", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

export function POST() {
  return GET();
}
