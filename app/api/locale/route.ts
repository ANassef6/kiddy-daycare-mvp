// KID-2460: the current account locale for the client-side LocaleGuard. This
// reads only the signed-in account's `account.language`; it never returns a
// dictionary or any other account data. `no-store` keeps a CDN/proxy from
// answering for another account or from hiding a just-saved switch.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionFromCookieValue } from "@/lib/auth";
import { i18nForAccount } from "@/lib/i18n-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const session = readSessionFromCookieValue(
    cookieStore.get("kiddy_sess")?.value ?? null
  );
  if (!session) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "No active session." } },
      { status: 401, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  const { locale } = await i18nForAccount(session.accountId);
  return NextResponse.json(
    { locale },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
