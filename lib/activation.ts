// KID-113: resend-activation domain service.
//
// Unactivated-state detection, rate-limit checks, and audit logging for the
// admin "Resend activation" action on parent (contact) and staff accounts.
// UI pages stay thin: they look up activation state in one batched query and
// render <ResendActivationButton/> only for unactivated accounts. The server
// action in lib/actions.ts enforces admin auth, validation, rate-limit, and
// the actual email send.

import { isPostgresMode, queryAll, queryRun, uid, type Row } from "./db";

// Rate limits: at most 3 resends per target email per hour (prevents inbox
// spam + provider throttling), and at most 30 resends per admin per hour
// (prevents bulk abuse while staying generous for real onboarding days).
export const RESEND_PER_EMAIL_PER_HOUR = 3;
export const RESEND_PER_ADMIN_PER_HOUR = 30;
export const RESEND_WINDOW_HOURS = 1;

export function normalizeEmail(email: unknown): string {
  return String(email ?? "").trim().toLowerCase();
}

export function isValidEmail(email: unknown): boolean {
  const v = normalizeEmail(email);
  return v.length > 0 && v.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// An account is "unactivated" when its email confirmation is still pending.
// Seeded / app-side accounts default to confirmed (1); only GoTrue signups
// that never clicked the confirmation link stay at 0.
export function isUnactivatedAccount(account: Row | undefined | null): boolean {
  if (!account) return false;
  return Number(account.email_confirmed) === 0;
}

export type RateLimitDecision = { limited: false } | { limited: true; reason: string };

// Pure decision helper — unit-tested without a database.
export function decideRateLimit(recentForEmail: number, recentForAdmin: number): RateLimitDecision {
  if (recentForEmail >= RESEND_PER_EMAIL_PER_HOUR) {
    return {
      limited: true,
      reason: `Resend limit reached for this address (${RESEND_PER_EMAIL_PER_HOUR}/hour). Try again later.`,
    };
  }
  if (recentForAdmin >= RESEND_PER_ADMIN_PER_HOUR) {
    return {
      limited: true,
      reason: `Hourly resend budget reached (${RESEND_PER_ADMIN_PER_HOUR}/hour). Try again later.`,
    };
  }
  return { limited: false };
}

export type ActivationEntry = {
  email: string;
  accountId: string;
  confirmed: boolean;
  unactivated: boolean;
};

// Batched unactivated-state lookup for a list of emails. One query — no N+1.
// Returns entries only for emails that have a matching login account; emails
// without an account (contact added but login never created) are absent, and
// the UI must NOT show a resend affordance for those.
export async function activationByEmails(emails: Array<string | null | undefined>): Promise<Map<string, ActivationEntry>> {
  const unique = Array.from(new Set(emails.map(normalizeEmail).filter(Boolean)));
  const out = new Map<string, ActivationEntry>();
  if (unique.length === 0) return out;
  const placeholders = unique.map(() => "?").join(", ");
  // lower(email): account rows are stored lowercased but the lookup keys come
  // from contact emails that may carry uppercase; keep it case-insensitive.
  const rows = await queryAll(
    `SELECT id, email, email_confirmed FROM account WHERE lower(email) IN (${placeholders})`,
    ...unique
  );
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    const confirmed = Number(row.email_confirmed) !== 0;
    out.set(email, {
      email,
      accountId: String(row.id),
      confirmed,
      unactivated: !confirmed,
    });
  }
  return out;
}

function windowPredicate(): string {
  return isPostgresMode()
    ? `created_at > now() - interval '${RESEND_WINDOW_HOURS} hour'`
    : `created_at > datetime('now', '-${RESEND_WINDOW_HOURS} hour')`;
}

export async function countRecentResendsForEmail(targetEmail: string): Promise<number> {
  const row = await queryAll(
    `SELECT COUNT(*) AS c FROM activation_resend_log WHERE target_email = ? AND status = 'sent' AND ${windowPredicate()}`,
    normalizeEmail(targetEmail)
  ).catch((err) => {
    // The audit table may not exist on databases created before this
    // migration runs; treat as zero rather than blocking the resend.
    console.error("countRecentResendsForEmail failed:", err);
    return [{ c: 0 }];
  });
  return Number(row[0]?.c ?? 0);
}

export async function countRecentResendsForAdmin(adminAccountId: string): Promise<number> {
  const row = await queryAll(
    `SELECT COUNT(*) AS c FROM activation_resend_log WHERE admin_account_id = ? AND status = 'sent' AND ${windowPredicate()}`,
    adminAccountId
  ).catch((err) => {
    console.error("countRecentResendsForAdmin failed:", err);
    return [{ c: 0 }];
  });
  return Number(row[0]?.c ?? 0);
}

export type ResendAuditStatus = "sent" | "rate_limited" | "failed" | "no_account" | "already_active";

export async function logResendAttempt(data: {
  targetEmail: string;
  adminAccountId?: string | null;
  channel: string;
  status: ResendAuditStatus;
  detail?: string | null;
}): Promise<void> {
  try {
    await queryRun(
      `INSERT INTO activation_resend_log (id, target_email, admin_account_id, channel, status, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      uid(),
      normalizeEmail(data.targetEmail),
      data.adminAccountId ?? null,
      data.channel,
      data.status,
      data.detail ?? null
    );
  } catch (err) {
    // Audit logging must never silently disappear — surface it, but don't
    // break the admin flow when the log table itself is unavailable.
    console.error("logResendAttempt failed:", err);
  }
}
