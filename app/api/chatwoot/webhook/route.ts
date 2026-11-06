import { NextResponse } from "next/server";
import {
  accountForChatwootContact,
  chatwootContactKeys,
  chatwootMessageRef,
  chatwootWebhookSecret,
  isNotifyWorthyChatwootMessage,
  presentedWebhookSecret,
  verifyChatwootWebhookSecret,
} from "@/lib/chatwoot-webhook";
import { ensureSchema } from "@/lib/db";
import { emitNotifications } from "@/lib/store";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { institutesForAccount } from "@/lib/chatwoot-contacts";

// KID-480: inbound Chatwoot webhook. See lib/chatwoot-webhook.ts for the
// security/sequencing contract; setup steps live in docs/PUSH_NOTIFICATIONS.md.
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const configured = chatwootWebhookSecret();
  if (!configured) {
    // Fail closed: no secret configured means no webhook, loudly logged.
    console.error("KID-480 Chatwoot webhook disabled: CHATWOOT_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: { code: "webhook_disabled", message: "Webhook secret is not configured." } },
      { status: 503, headers: noStore }
    );
  }
  const heads = Object.fromEntries(Array.from(request.headers.entries(), ([k, v]) => [k.toLowerCase(), v]));
  if (!verifyChatwootWebhookSecret(presentedWebhookSecret(heads, request.url), configured)) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Invalid webhook secret." } },
      { status: 401, headers: noStore }
    );
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Body must be a JSON object." } },
      { status: 400, headers: noStore }
    );
  }
  try {
    await ensureSchema();
    // Unknown/unmapped contacts and non-message events are clean 200 skips so
    // Chatwoot does not retry forever over an event we intentionally ignore.
    if (!isNotifyWorthyChatwootMessage(payload as Record<string, unknown>)) {
      return NextResponse.json({ handled: false, reason: "not-an-agent-message" }, { headers: noStore });
    }
    const keys = chatwootContactKeys(payload);
    if (!keys) {
      return NextResponse.json({ handled: false, reason: "no-contact" }, { headers: noStore });
    }
    const account = await accountForChatwootContact(keys);
    if (!account) {
      return NextResponse.json({ handled: false, reason: "contact-not-mapped" }, { headers: noStore });
    }
    const { dict } = await i18nForAccount(String(account.id));
    const p = payload as {
      id?: unknown;
      conversation?: { id?: unknown };
      content?: unknown;
    };
    // Tenant scope for the notification row: the account's widest institute
    // list (same resolver as the Chatwoot contact attributes).
    const institutes = await institutesForAccount(String(account.id));
    await emitNotifications({
      instituteId: institutes[0]?.id ? String(institutes[0].id) : null,
      accountIds: [String(account.id)],
      activity: "messages",
      kind: "message",
      payload: {
        // Localized at emit time under the account's locale; the notification
        // center renders message rows with messageTitle(senderName).
        senderName: tr(dict, "parent.chatwootSenderName"),
        body: String(p.content ?? "").slice(0, 280),
      },
      ref: chatwootMessageRef(String(p.conversation?.id ?? "0"), String(p.id ?? "0")),
    });
    return NextResponse.json({ handled: true }, { headers: noStore });
  } catch (err) {
    console.error("KID-480 Chatwoot webhook mapping failed:", err);
    return NextResponse.json(
      { error: { code: "webhook_failed", message: "Could not process the webhook event." } },
      { status: 502, headers: noStore }
    );
  }
}
