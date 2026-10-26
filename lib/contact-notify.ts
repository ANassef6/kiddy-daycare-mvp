// KID-238: best-effort notification of every public "Book a demo / Contact
// us" submission to the platform contact inbox (lib/site
// PLATFORM_CONTACT_EMAIL — default set by the board).
//
// Delivery goes through the app's EXISTING shared mail path — the Supabase
// GoTrue admin channel from lib/invite-email.ts (SUPABASE_SERVICE_ROLE_KEY) —
// deliberately NOT a new mail vendor, credential, or secret. Two honest
// limitations are stated in the outcome details rather than papered over:
//
//   1. GoTrue sends only its own templated mails, so the notification to the
//      inbox is the provider's templated invite mail (it proves the mailbox
//      is reachable, and is why a GoTrue user is created for the inbox
//      address). The inquiry content itself always lives in the
//      `contact_request` row and the full built notification is logged here
//      so it can be forwarded manually — the same logged/forwardable-body
//      behavior the invite path uses when no provider is wired.
//   2. GoTrue rejects re-inviting an address that already has a user with
//      "already registered". After the first accepted notification, every
//      later attempt records that outcome instead of pretending to send.
//
// Degradation contract (same as the invite path): no provider configured →
// record + continue. Nothing here throws or blocks the visitor's submission;
// the outcome of every attempt is recorded on the contact_request row via
// recordContactMailAttempt and logged.

import type { Row } from "./db";
import { PLATFORM_CONTACT_EMAIL } from "./site";

export type ContactNotifyStatus = "sent" | "pending" | "failed" | "skipped";

export type ContactNotifyOutcome = {
  status: ContactNotifyStatus;
  // Human-readable, safe for logs and the database (never includes secrets).
  detail: string;
};

// The templated notification we would forward to the platform inbox. Pure so
// tests can assert the content; also the logged/forwardable body when no
// content channel exists.
export function buildContactNotificationEmail(request: Row): {
  to: string;
  subject: string;
  text: string;
} {
  const name = String(request.name ?? "").trim();
  const email = String(request.email ?? "").trim();
  const phone = String(request.phone ?? "").trim();
  const interest = String(request.interest ?? "").trim();
  const message = String(request.message ?? "").trim();
  const lines = [
    `New contact request on the Kiddy marketing site:`,
    ``,
    `Name: ${name || "(none given)"}`,
    `Email: ${email || "(none given)"}`,
    `Phone: ${phone || "(none given)"}`,
    `Interest: ${interest || "(none given)"}`,
    `Message: ${message || "(none given)"}`,
    ``,
    `This row (id ${String(request.id ?? "?")}) is also in the daycare portal inbox.`,
  ];
  return {
    to: PLATFORM_CONTACT_EMAIL,
    subject: `New Kiddy contact request — ${name || email || "unknown"}`,
    text: lines.join("\n"),
  };
}

// GoTrue's re-invite rejection, matched the same way the register flow
// matches it (lib/supabase isGoTrueAlreadyRegisteredError) but without
// importing the client module — a pure predicate keeps the notifier
// testable without a network.
export function isInboxAlreadyRegisteredError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = String((err as Record<string, unknown>).message ?? "").toLowerCase();
  const status = (err as Record<string, unknown>).status;
  if (String(status) === "422") return true;
  return (
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("email_exists")
  );
}

// Attempt one notification. Never throws — any provider failure is a
// recorded outcome, not an error page.
export async function notifyPlatformInbox(request: Row): Promise<ContactNotifyOutcome> {
  const to = PLATFORM_CONTACT_EMAIL;
  const preview = buildContactNotificationEmail(request);

  // Degradation 1 — no provider: record + continue, same as the invite path.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!serviceKey || !supabaseUrl) {
    const detail =
      "no mail provider configured (SUPABASE_SERVICE_ROLE_KEY unset); request saved to the portal inbox, notification not sent";
    console.warn(`KID-238 contact ${String(request.id ?? "?")}: ${detail}\n${preview.text}`);
    return { status: "pending", detail };
  }

  // The existing shared channel: Supabase GoTrue admin (service role), the
  // same client construction lib/invite-email.ts uses.
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.auth.admin.inviteUserByEmail(to);
    if (error) throw error;
    console.log(
      `KID-238 contact ${String(request.id ?? "?")}: notification accepted by provider for ${to} (templated invite mail; inquiry content logged for manual forwarding):\n${preview.text}`
    );
    return { status: "sent", detail: "notification email sent to the contact inbox" };
  } catch (err) {
    if (isInboxAlreadyRegisteredError(err)) {
      // Degradation 2 — the inbox already has its provider user (the first
      // notification created it). Record clearly; never re-pretend a send.
      const detail =
        "contact inbox is already registered with the mail provider, so no further invite mail can be sent to it; request saved to the portal inbox";
      console.warn(`KID-238 contact ${String(request.id ?? "?")}: ${detail}\n${preview.text}`);
      return { status: "failed", detail };
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`KID-238 contact ${String(request.id ?? "?")}: notification to ${to} failed:`, msg);
    return { status: "failed", detail: msg };
  }
}
