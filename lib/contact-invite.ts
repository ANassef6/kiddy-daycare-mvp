// KID-180: one delivery path for "invite this parent" — the Add-contact form
// (which now auto-sends) and the one-click Send invite button must not drift
// into two copies of the create/resend/send orchestration.
//
// States, decided here once:
// - confirmed account exists → nothing to send (KID-135: re-inviting a working
//   login fails delivery with "already registered"; KID-171 stopped offering it).
// - unconfirmed account exists → resend the signup confirmation email when a
//   provider is wired (same rate-limit budget as the admin resend action,
//   KID-113); otherwise there is nothing the server can deliver.
// - pending invite row exists → resend it instead of stacking duplicates.
// - no account and no invite → create the invite row and send it.
//
// Non-redirect and never-throwing for delivery outcomes: the caller always
// redirects with the contact saved, and a failed send is a non-blocking
// warning, not an error page.

import { queryGet } from "@/lib/db";
import { createInvite, getInviteByCode } from "@/lib/store";
import { supabaseConfigured } from "@/lib/supabase";
import { requestOrigin, publicOrigin } from "@/lib/url";
import { firstInstituteId } from "@/lib/helpers";
import {
  buildParentInviteEmail,
  getPendingInvitesByEmail,
  isValidInviteEmail,
  sendParentInviteEmail,
} from "@/lib/invite-email";
import { emailConfirmedFor, findAccountByEmail } from "@/lib/auth";
import {
  countRecentResendsForAdmin,
  countRecentResendsForEmail,
  decideRateLimit,
  logResendAttempt,
} from "@/lib/activation";

export type ContactInviteOutcome =
  /** Delivery succeeded (creation path or resend path). */
  | { status: "sent"; detail: string }
  /** No account and no invite existed; the invite row is saved but no mail
   *  provider is configured, so the admin must forward the link manually. */
  | { status: "pending"; detail: string; activationUrl?: string }
  /** The email belongs to a confirmed account — it can already sign in. */
  | { status: "activated"; detail: string }
  /** Send was attempted and failed (detail is safe to show: no secrets). */
  | { status: "failed"; detail: string; activationUrl?: string }
  /** Nothing was attempted: no email, an unusable email, or no way to send.
   *  Not an error — the contact row itself is already saved. */
  | { status: "skipped"; detail: string };

/** Best-effort contact display name for invite prefill. Never throws. */
export async function contactNameForInvite(
  childId: string | null,
  email: string
): Promise<string | undefined> {
  try {
    if (!childId) return undefined;
    const row = await queryGet(
      "SELECT full_name FROM contact WHERE child_id = ? AND lower(email) = lower(?) LIMIT 1",
      childId,
      email
    );
    const name = String(row?.full_name ?? "").trim().slice(0, 120);
    return name || undefined;
  } catch (err) {
    console.error(`contactNameForInvite failed for ${email}:`, err);
    return undefined;
  }
}

/** Create-or-resend the parent invite for one contact email. Shared by
 *  `addContactAction` (auto-send after Add contact, KID-180) and
 *  `sendInviteForContactAction` (the Send invite button, KID-115).
 *  Returns a structured outcome; redirects and UI copy stay with the caller.
 */
export async function sendContactInvite(input: {
  childId: string;
  email: string;
  relationship: string;
  adminAccountId: string;
  /** Audit-log label prefix, so a resend trail names the flow that sent it. */
  logTag?: string;
}): Promise<ContactInviteOutcome> {
  const logTag = input.logTag ?? "contact invite";
  const email = String(input.email ?? "").trim().toLowerCase();
  const childId = String(input.childId ?? "").trim();
  if (!childId) return { status: "failed", detail: "Missing child." };

  // KID-135 / KID-171: decide on the account row first. A confirmed login
  // makes every invite state pointless; re-inviting used to fail delivery
  // with "already registered" and read as a 500 to the admin.
  if (email) {
    const account = await findAccountByEmail(email);
    if (account && emailConfirmedFor(account)) {
      console.log(`${logTag}: ${email} already has a confirmed account — nothing to send.`);
      return { status: "activated", detail: `${email} already has an account` };
    }
    if (account) {
      // Registered but never confirmed the address. With a provider wired,
      // resend the signup confirmation on the shared resend budget (KID-113).
      if (supabaseConfigured()) {
        const { getSupabase } = await import("@/lib/supabase");
        const [recentForEmail, recentForAdmin] = await Promise.all([
          countRecentResendsForEmail(email),
          countRecentResendsForAdmin(input.adminAccountId),
        ]);
        const decision = decideRateLimit(recentForEmail, recentForAdmin);
        if (decision.limited) {
          await logResendAttempt({
            targetEmail: email,
            adminAccountId: input.adminAccountId,
            channel: "supabase",
            status: "rate_limited",
            detail: `${logTag}: ${decision.reason}`,
          });
          console.warn(`${logTag}: confirmation resend for ${email} rate limited: ${decision.reason}`);
          return { status: "skipped", detail: decision.reason };
        }
        const { error } = await getSupabase().auth.resend({ type: "signup", email });
        if (!error) {
          console.log(`${logTag}: signup confirmation resent to ${email}`);
          await logResendAttempt({
            targetEmail: email,
            adminAccountId: input.adminAccountId,
            channel: "supabase",
            status: "sent",
            detail: `${logTag}: signup confirmation resent.`,
          });
          return { status: "sent", detail: "confirmation email resent" };
        }
        console.error(`${logTag}: signup confirmation resend failed for ${email}:`, error.message);
        return { status: "failed", detail: error.message };
      }
      // No provider: the server cannot deliver anything for an account that
      // already exists. Not an error — the admin's Resend-activation button
      // is the surface for this state (KID-171).
      console.warn(`${logTag}: ${email} has an unconfirmed account and no mail provider is configured`);
      return { status: "skipped", detail: "account exists but is not confirmed, and no mail provider is configured" };
    }
  }

  if (!isValidInviteEmail(email)) {
    return { status: "skipped", detail: `${email || "(empty)"} is not a valid invite email` };
  }

  const instituteId = await firstInstituteId();
  if (!instituteId) return { status: "failed", detail: "No center configured yet." };

  // KID-119: parent devices follow this link, so use the public host.
  const origin = publicOrigin(requestOrigin());
  // Resend an existing pending invite instead of stacking duplicates.
  const existing = await getPendingInvitesByEmail(email);
  if (existing.length > 0) {
    const parentName = await contactNameForInvite(childId, email);
    const result = await sendParentInviteEmail(existing[0], {
      origin,
      isResend: true,
      prefill: { email, name: parentName },
    });
    await logResendAttempt({
      targetEmail: email,
      adminAccountId: input.adminAccountId,
      channel: result.status === "sent" ? "supabase-admin-invite" : "invite",
      status: result.status === "sent" ? "sent" : "failed",
      detail: `${logTag} reused invite ${String(existing[0].id)}: ${result.detail}`,
    });
    return result.status === "sent"
      ? { status: "sent", detail: result.detail }
      : { status: result.status === "pending" ? "pending" : "failed", detail: result.detail, activationUrl: result.activationUrl };
  }

  const { generateInviteCode } = await import("@/lib/invite-email");
  let code = "";
  for (let i = 0; i < 5 && !code; i++) {
    const candidate = generateInviteCode();
    if (!(await getInviteByCode(candidate))) code = candidate;
  }
  if (!code) return { status: "failed", detail: "Could not create an invite code. Try again." };

  try {
    await createInvite(instituteId, childId, email, code, input.relationship);
  } catch (err) {
    console.error(`${logTag}: createInvite failed for ${email}:`, err);
    return { status: "failed", detail: err instanceof Error ? err.message : "Could not create the invite." };
  }
  const created = await getInviteByCode(code);
  const parentName = await contactNameForInvite(childId, email);
  const preview = buildParentInviteEmail({ parentEmail: email, code, parentName, origin: origin || "(unknown origin)" });
  console.log(`${logTag}: invite created for ${email} (code ${code}):\n${preview.text}`);
  const result = created
    ? await sendParentInviteEmail(created, { origin, prefill: { email, name: parentName } })
    : { status: "failed" as const, detail: "invite row not found after create" };
  await logResendAttempt({
    targetEmail: email,
    adminAccountId: input.adminAccountId,
    channel: result.status === "sent" ? "supabase-admin-invite" : "invite",
    status: result.status === "sent" ? "sent" : "failed",
    detail: `${logTag}, invite ${created ? String(created.id) : "?"}: ${result.detail}`,
  });
  return result.status === "sent"
    ? { status: "sent", detail: result.detail }
    : { status: result.status === "pending" ? "pending" : "failed", detail: result.detail, activationUrl: result.activationUrl };
}
