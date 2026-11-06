import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSessionFromCookieValue } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { sendPushToAccounts, vapidConfig } from "@/lib/push";
import { uid } from "@/lib/db";

// KID-480: send a test push through the exact production path (locale copy →
// subscription storage → VAPID send) so parents — and QA evidence — can prove
// the subscription works end-to-end without waiting for a real event.
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function POST() {
  const s = readSessionFromCookieValue(cookies().get("kiddy_sess")?.value ?? null);
  if (!s?.accountId) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to send a test push." } },
      { status: 401, headers: noStore }
    );
  }
  if (!vapidConfig()) {
    return NextResponse.json(
      { error: { code: "push_not_configured", message: "VAPID keys are not configured on this server." } },
      { status: 503, headers: noStore }
    );
  }
  try {
    await ensureSchema();
    const { locale, dict } = await i18nForAccount(s.accountId);
    void locale;
    const delivered = await sendPushToAccounts([String(s.accountId)], {
      activity: "messages",
      kind: "test",
      payload: {
        title: tr(dict, "parent.pushTestTitle"),
        body: tr(dict, "parent.pushTestBody"),
      },
      ref: `push-test-${uid()}`,
    });
    return NextResponse.json({ ok: true, delivered }, { headers: noStore });
  } catch (err) {
    console.error("KID-480 test push failed:", err);
    return NextResponse.json(
      { error: { code: "test_failed", message: "Could not send the test push." } },
      { status: 502, headers: noStore }
    );
  }
}
