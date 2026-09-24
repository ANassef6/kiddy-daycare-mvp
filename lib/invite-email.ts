// KID-111: parent-invite email service.
//
// Root cause of "parent activation email not received": `inviteParentAction`
// wrote an `invite` row but never sent (or logged) any email — the
// "Send invite" button only saved a code the parent had to receive
// out-of-band. The only real email in the parent path was the GoTrue
// confirmation sent by `registerAction` *after* the parent registered,
// which is rate-limited / SMTP-dependent and failed silently.
//
// This module is the single place that:
//   - validates invite input at the system boundary (fail fast),
//   - builds the canonical parent-activation email (template),
//   - attempts delivery through the configured provider and LOGS the outcome,
//   - records every attempt on the invite row (email_sent_at / email_error /
//     resend_count) so missing mail is visible in the DB, not silently lost.
//
// Delivery channels (in order):
//   1. Supabase Auth admin invite (needs SUPABASE_SERVICE_ROLE_KEY) — sends a
//      real activation email to a parent with no account yet.
//   2. GoTrue user emails (anon key): `resend(signup)` for a registered but
//      unconfirmed parent, or `resetPasswordForEmail` for an existing user.
//   3. Pending: no provider can reach this address yet. The invite stays
//      `pending`, the attempt is logged, and the caller must surface the
//      activation link/code to the admin so it can be forwarded manually.
//
// Invite codes are single-use (consumed by registerAction) and have no time
// expiry — no expiry sweep exists; a used code is rejected at register time.

import { queryAll, queryGet, queryRun } from "./db";
import type { Row } from "./db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const INVITE_CODE_MIN_LENGTH = 4;
export const INVITE_CODE_MAX_LENGTH = 64;

export function isValidInviteEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const v = email.trim();
  return v.length > 0 && v.length <= 200 && EMAIL_RE.test(v);
}

export function isValidInviteCode(code: unknown): boolean {
  if (typeof code !== "string") return false;
  const v = code.trim();
  return v.length >= INVITE_CODE_MIN_LENGTH && v.length <= INVITE_CODE_MAX_LENGTH;
}

export type ParentInviteEmail = {
  to: string;
  subject: string;
  text: string;
};

// Canonical parent-activation email. Used as the logged/forwardable message
// body when no SMTP provider is wired, and as the reference template when one
// is (GoTrue sends its own template for confirm/reset mails).
export function buildParentInviteEmail(args: {
  parentEmail: string;
  code: string;
  childName?: string;
  origin: string;
}): ParentInviteEmail {
  const to = args.parentEmail.trim().toLowerCase();
  const code = args.code.trim();
  const childBit = args.childName ? ` for ${args.childName}` : "";
  const registerUrl = `${args.origin.replace(/\/$/, "")}/register?code=${encodeURIComponent(code)}`;
  return {
    to,
    subject: "Activate your Kiddy parent account",
    text: [
      `You have been invited to Kiddy${childBit}.`,
      ``,
      `Activate your parent account here:`,
      registerUrl,
      ``,
      `Your invite code is: ${code}`,
      `(enter it on the activation page if the link does not fill it in)`,
      ``,
      `This code is single-use and stops working once your account is activated.`,
      `If you did not expect this invite, you can ignore this message.`,
    ].join("\n"),
  };
}

export function activationUrlForCode(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/register?code=${encodeURIComponent(code.trim())}`;
}

export type InviteDeliveryStatus = "sent" | "pending" | "failed";

export type InviteDeliveryResult = {
  status: InviteDeliveryStatus;
  // Human-readable detail for logs and admin UI (never includes secrets).
  detail: string;
  // When delivery was not possible, the activation link the admin can forward.
  activationUrl?: string;
};

// Record a delivery attempt on the invite row. Never throws: logging must not
// break invite creation. Missing columns (pre-migration DBs) are tolerated.
export async function recordInviteEmailAttempt(args: {
  inviteId: string;
  ok: boolean;
  error?: string;
  isResend?: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  try {
    if (args.ok) {
      await queryRun(
        "UPDATE invite SET email_sent_at = ?, email_error = NULL WHERE id = ?",
        now,
        args.inviteId
      );
    } else {
      await queryRun("UPDATE invite SET email_error = ? WHERE id = ?", String(args.error ?? "unknown error").slice(0, 500), args.inviteId);
    }
    if (args.isResend) {
      try {
        await queryRun("UPDATE invite SET resend_count = COALESCE(resend_count, 0) + 1 WHERE id = ?", args.inviteId);
      } catch (err) {
        console.error(`KID-111 invite ${args.inviteId}: could not bump resend_count:`, err);
      }
    }
  } catch (err) {
    console.error(`KID-111 invite ${args.inviteId}: could not record email attempt:`, err);
  }
}

// Pending (unaccepted) invites for an email address — the resend pool used to
// activate existing unactivated parents (e.g. Becca nassef's parents).
export async function getPendingInvitesByEmail(email: string): Promise<Row[]> {
  return queryAll(
    "SELECT * FROM invite WHERE email = ? AND status = 'pending' ORDER BY created_at DESC",
    email.trim().toLowerCase()
  );
}

// Batched pending-invite lookup for a list of emails. One query — no N+1.
// Returns the latest pending invite per email; emails without a pending
// invite are absent. The child-detail family tab uses this to render a
// "Resend invite" affordance for contacts that have no login account yet
// (where the GoTrue-based ResendActivationButton correctly stays hidden).
export async function pendingInviteByEmails(
  emails: Array<string | null | undefined>
): Promise<Map<string, Row>> {
  const unique = Array.from(
    new Set(
      emails
        .map((e) => String(e ?? "").trim().toLowerCase())
        .filter((e) => e.length > 0 && isValidInviteEmail(e))
    )
  );
  const out = new Map<string, Row>();
  if (unique.length === 0) return out;
  const placeholders = unique.map(() => "?").join(", ");
  const rows = await queryAll(
    `SELECT * FROM invite WHERE email IN (${placeholders}) AND status = 'pending' ORDER BY created_at DESC`,
    ...unique
  );
  for (const row of rows) {
    const email = String(row.email ?? "").trim().toLowerCase();
    if (email && !out.has(email)) out.set(email, row);
  }
  return out;
}

export async function getInviteById(id: string): Promise<Row | undefined> {
  return queryGet("SELECT * FROM invite WHERE id = ?", id);
}

// Attempt delivery for one invite row. `origin` is the request origin used to
// build the activation link for the pending fallback.
export async function sendParentInviteEmail(
  invite: Row,
  opts: { origin: string; isResend?: boolean }
): Promise<InviteDeliveryResult> {
  const email = String(invite.email ?? "").trim().toLowerCase();
  const code = String(invite.code ?? "").trim();
  const activationUrl = opts.origin ? activationUrlForCode(opts.origin, code) : undefined;

  if (!isValidInviteEmail(email) || !isValidInviteCode(code)) {
    const detail = `invalid invite data (email or code), not attempting delivery`;
    console.error(`KID-111 invite ${String(invite.id)}: ${detail}`);
    await recordInviteEmailAttempt({ inviteId: String(invite.id), ok: false, error: detail, isResend: opts.isResend });
    return { status: "failed", detail };
  }

  // Channel 1: Supabase Auth admin invite — the only channel that can email a
  // parent with no account yet. Needs the service-role key (server-only env).
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (serviceKey && supabaseUrl) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${opts.origin.replace(/\/$/, "")}/auth/confirm`,
      });
      if (error) throw error;
      console.log(`KID-111 invite ${String(invite.id)}: admin invite email sent to ${email}`);
      await recordInviteEmailAttempt({ inviteId: String(invite.id), ok: true, isResend: opts.isResend });
      return { status: "sent", detail: "activation email sent" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`KID-111 invite ${String(invite.id)}: admin invite failed for ${email}:`, msg);
      await recordInviteEmailAttempt({ inviteId: String(invite.id), ok: false, error: msg, isResend: opts.isResend });
      return { status: "failed", detail: msg, activationUrl };
    }
  }

  // Channel 2/3 without a service key: GoTrue cannot email an address with no
  // user yet, so record pending and hand the admin the activation link. This
  // is logged loudly so "no email received" is diagnosable instead of silent.
  const detail =
    "no mail provider configured for new invites (SUPABASE_SERVICE_ROLE_KEY unset); " +
    "invite saved as pending — forward the activation link manually";
  console.warn(`KID-111 invite ${String(invite.id)} to ${email}: ${detail} (${activationUrl ?? "no origin"})`);
  await recordInviteEmailAttempt({ inviteId: String(invite.id), ok: false, error: detail, isResend: opts.isResend });
  return { status: "pending", detail, activationUrl };
}
