// KID-480: Chatwoot → Kiddy message push.
//
// Chatwoot fires its webhook (message_created) when a conversation message
// lands; the agent replies must reach the parent as an in-app notification
// AND a web push, mapped back through the Chatwoot contact the widget
// already created (identifier = Kiddy account id, lib/chatwoot-contacts.ts).
//
// Security: the webhook carries a shared secret configured in Chatwoot
// (CHATWOOT_WEBHOOK_SECRET env, served as ?token=…, `X-Chatwoot-Webhook-Secret`
// header or an `Authorization: Bearer` header). Comparison is timing-safe.
// Fail-closed: an unconfigured secret disables the webhook entirely (503) so a
// forgotten setup can never accept unsigned payloads.
//
// Delivery is best-effort: unsupported push setups and unmapped contacts
// return 200 with a reason — never a retry storm, never a broken mapping.

import crypto from "crypto";
import { queryGet, type Row } from "./db";

/** The configured webhook secret, or null when the webhook is disabled. */
export function chatwootWebhookSecret(env: Record<string, string | undefined> = process.env): string | null {
  const secret = (env.CHATWOOT_WEBHOOK_SECRET ?? "").trim();
  return secret ? secret : null;
}

export function presentedWebhookSecret(headers: Record<string, string>, url: string): string {
  const urlToken = new URL(url).searchParams.get("token") ?? "";
  const headerToken = headers["x-chatwoot-webhook-secret"] ?? "";
  const auth = headers["authorization"] ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  // Prefer the least visible first; any of the three may carry the secret.
  return headerToken || urlToken || bearer;
}

export function verifyChatwootWebhookSecret(presented: string, configured: string | null): boolean {
  if (!configured) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(configured, "utf8");
  if (a.length !== b.length) {
    // Burn the same time as the equal path so length never leaks.
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/** Only agent/authored replies should notify — the parent's own incoming
 *  messages (message_type 0 / contact sender) are the source, not the event. */
export function isNotifyWorthyChatwootMessage(payload: {
  event?: unknown;
  message_type?: unknown;
  sender?: unknown;
  sender_type?: unknown;
}): boolean {
  if (String(payload.event ?? "") !== "message_created") return false;
  const type = Number(payload.message_type ?? 0);
  const sender = (payload.sender ?? {}) as { type?: unknown };
  if (String(sender.type ?? "") === "contact") return false;
  return type !== 0 || String(payload.sender_type ?? "") === "agent";
}

export type ChatwootContactKeys = { identifier: string; email: string; name: string };

export function chatwootContactKeys(payload: unknown): ChatwootContactKeys | null {
  const root = payload as {
    contact?: { identifier?: unknown; email?: unknown; name?: unknown };
    conversation?: { meta?: { sender?: { identifier?: unknown; email?: unknown; name?: unknown } } };
    sender?: { identifier?: unknown; email?: unknown; name?: unknown };
  };
  const pick = (c?: { identifier?: unknown; email?: unknown; name?: unknown }) => {
    if (!c) return null;
    const identifier = String(c.identifier ?? "").trim();
    const email = String(c.email ?? "").trim();
    if (!identifier && !email) return null;
    return { identifier, email, name: String(c.name ?? "") };
  };
  return pick(root?.contact) ?? pick(root?.conversation?.meta?.sender) ?? pick(root?.sender);
}

/** Map the Chatwoot contact back to a Kiddy account (identifier first — it IS
 *  the account id the widget attaches — then the e-mail). */
export async function accountForChatwootContact(keys: ChatwootContactKeys): Promise<Row | undefined> {
  if (keys.identifier) {
    const byId = await queryGet("SELECT * FROM account WHERE id = ?", keys.identifier);
    if (byId) return byId;
  }
  if (keys.email) {
    return await queryGet("SELECT * FROM account WHERE lower(email) = lower(?)", keys.email);
  }
  return undefined;
}

/** Single-chatwoot debounce: one notification per (conversation, message). */
export function chatwootMessageRef(conversationId: string, messageId: string): string {
  return `chatwoot-${conversationId}-${messageId}`;
}
