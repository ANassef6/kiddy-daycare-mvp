import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSessionFromCookieValue } from "@/lib/auth";
import { chatwootIdentityForAccount } from "@/lib/chatwoot-contacts";

// The browser needs the signed-in account's Chatwoot identity (including the
// server-only HMAC identifier hash) to call `$chatwoot.setUser`. Never cache:
// login, logout and profile changes must be reflected on the next navigation.
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const session = readSessionFromCookieValue(cookies().get("kiddy_sess")?.value ?? null);
    if (!session?.accountId) return NextResponse.json({ identity: null }, { headers: noStore });
    return NextResponse.json(
      { identity: await chatwootIdentityForAccount(session.accountId) },
      { headers: noStore },
    );
  } catch (error) {
    console.error("Chatwoot identity lookup failed:", error);
    return NextResponse.json({ identity: null }, { headers: noStore });
  }
}
