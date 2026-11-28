import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { readSessionFromCookieValue } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { notificationForAccount, markNotificationRead, type NotificationPayload } from "@/lib/store";
import { parentNotificationHref } from "@/lib/notification-routes";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const session = readSessionFromCookieValue((await cookies()).get("kiddy_sess")?.value ?? null);
  if (!session?.accountId) {
    return NextResponse.redirect(new URL("/login", request.url), { headers: noStore });
  }

  const id = request.nextUrl.searchParams.get("id") ?? "";
  try {
    await ensureSchema();
    const row = id ? await notificationForAccount(session.accountId, id) : undefined;
    if (!row) {
      return NextResponse.redirect(new URL("/child/notifications", request.url), { headers: noStore });
    }
    let payload: NotificationPayload = {};
    try {
      payload = JSON.parse(String(row.payload ?? "{}"));
    } catch (err) {
      console.error("KID-2525 malformed notification payload:", err, String(row.id ?? ""));
    }
    const target = parentNotificationHref(String(row.kind ?? ""), payload);
    await markNotificationRead(session.accountId, id);
    const safe = target.startsWith("/") && !target.startsWith("//");
    const destination = new URL(safe ? target : "/child/notifications", request.url);
    return NextResponse.redirect(destination, { headers: noStore });
  } catch (err) {
    console.error("KID-2525 notification open failed:", err, String(id));
    return NextResponse.redirect(new URL("/child/notifications", request.url), { headers: noStore });
  }
}
