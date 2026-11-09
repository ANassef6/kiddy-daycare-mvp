import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSessionFromCookieValue } from "@/lib/auth";
import { ensureSchema, uid } from "@/lib/db";
import { unreadNotificationCount } from "@/lib/store";

// KID-480: tiny polling endpoint the in-app sound watcher uses to notice new
// in-app notifications while the parent keeps the app open.
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const s = readSessionFromCookieValue((await cookies()).get("kiddy_sess")?.value ?? null);
  if (!s?.accountId) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to check notifications." } },
      { status: 401, headers: noStore }
    );
  }
  try {
    await ensureSchema();
    const count = await unreadNotificationCount(s.accountId);
    return NextResponse.json({ count, at: uid() }, { headers: noStore });
  } catch (err) {
    console.error("KID-480 unread poll failed:", err);
    return NextResponse.json(
      { error: { code: "unread_failed", message: "Could not read the notification count." } },
      { status: 502, headers: noStore }
    );
  }
}
