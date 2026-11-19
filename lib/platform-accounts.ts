// KID-2442: the platform operator's one-click password reset.
//
// The founder asked for a self-service reset in the superadmin surface: type
// an account email, see the matched account with its daycare and role, then
// reset the password to the standing platform default and force a change at
// the next sign-in (the KID-2439 flow).
//
// This module owns the two pure-ish operations the page and the server action
// share:
//   - lookupAccountForPasswordReset() resolves the email to the account plus
//     its tenant name(s) for the confirmation step.
//   - resetAccountPasswordToDefault() performs the single atomic app-side
//     write (new hash + must_change_password = 1) and writes the audit event.
// GoTrue is synchronised separately by the action through
// syncGoTruePassword(), because the app-side hash is only the login fallback:
// leaving a stale GoTrue password would let the old credential keep working.

import type { SupabaseClient } from "@supabase/supabase-js";
import { findAccountByEmail, getAccount, hashPassword, mustChangePasswordFor } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import type { Row } from "@/lib/db";
import { queryRun } from "@/lib/db";
import { supabaseConfigured } from "@/lib/supabase";
import { tenancyInstitutesForAccount } from "@/lib/store";

/** The founder's standing default password (digits 1-8). */
export const DEFAULT_ACCOUNT_PASSWORD = "12345678";

export type PlatformAccountInstitute = { id: string; name: string };

export type PlatformPasswordResetTarget = {
  accountId: string;
  email: string;
  fullName: string;
  role: string;
  mustChangePassword: boolean;
  institutes: PlatformAccountInstitute[];
};

/** Normalise what the operator typed. Accounts are stored lower-case by every
 *  creation path, so the lookup is case- and whitespace-insensitive. */
export function normalizeAccountLookup(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

async function institutesFor(accountId: string): Promise<PlatformAccountInstitute[]> {
  const rows = await tenancyInstitutesForAccount(accountId);
  return rows.map((row) => ({ id: String(row.id), name: String(row.name ?? "") }));
}

/** The lookup step. Returns null for an empty or unknown email so the page
 *  can show the friendly localized "no account" message without writing
 *  anything. */
export async function lookupAccountForPasswordReset(
  value: string | null | undefined
): Promise<PlatformPasswordResetTarget | null> {
  const email = normalizeAccountLookup(value);
  if (!email) return null;
  const account = await findAccountByEmail(email);
  if (!account) return null;
  return {
    accountId: String(account.id),
    email: String(account.email ?? email),
    fullName: String(account.full_name ?? ""),
    role: String(account.role ?? ""),
    mustChangePassword: mustChangePasswordFor(account),
    institutes: await institutesFor(String(account.id)),
  };
}

/**
 * Reset the account to the platform default and force a change at next login.
 *
 * The hash and the flag are written together in ONE statement, so there is no
 * window where the new password is live without the forced-change flag (or
 * the reverse). Returns null when the account no longer exists; the caller
 * treats that exactly like an unknown email.
 */
export async function resetAccountPasswordToDefault(
  accountId: string,
  actorAccountId: string
): Promise<PlatformPasswordResetTarget | null> {
  const account = await getAccount(accountId);
  if (!account) return null;

  const institutes = await institutesFor(accountId);
  await queryRun(
    "UPDATE account SET password_hash = ?, must_change_password = 1 WHERE id = ?",
    hashPassword(DEFAULT_ACCOUNT_PASSWORD),
    accountId
  );

  await recordAuditEvent({
    // The audit trail is tenant-scoped by design; a parent may belong to more
    // than one centre, so the primary centre leads and the metadata carries
    // the full set. Platform accounts have no centre (null).
    instituteId: institutes[0]?.id ?? null,
    actorAccountId,
    action: "update",
    entityType: "account",
    entityId: accountId,
    summary: `Reset the password to the platform default for ${String(account.email)} (${String(account.role)}) and forced a change at next sign-in`,
    metadata: {
      targetAccountId: accountId,
      targetEmail: String(account.email ?? ""),
      targetRole: String(account.role ?? ""),
      instituteIds: institutes.map((i) => i.id),
      instituteNames: institutes.map((i) => i.name),
      mustChangePassword: true,
    },
  });

  return {
    accountId,
    email: String(account.email ?? ""),
    fullName: String(account.full_name ?? ""),
    role: String(account.role ?? ""),
    mustChangePassword: true,
    institutes,
  };
}

export type GoTrueSyncResult = { ok: boolean; reason?: string };

/** Find a GoTrue user by email through the admin API. Only used when the app
 *  account has no auth_user_id link (legacy rows), so the scan is bounded. */
async function findGoTrueUserIdByEmail(
  admin: SupabaseClient,
  email: string
): Promise<string | null> {
  const target = normalizeAccountLookup(email);
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    const users = data?.users ?? [];
    const match = users.find((u) => normalizeAccountLookup(u.email) === target);
    if (match) return match.id;
    if (users.length < 1000) return null;
  }
  return null;
}

/**
 * Project the reset onto Supabase GoTrue when the project is wired.
 *
 * The login path prefers GoTrue, so an app-side-only reset would leave the
 * old password valid through GoTrue. When the account is linked to a GoTrue
 * identity and the service-role admin channel is unavailable or refuses the
 * update, the reset is refused BEFORE the app-side write — the operator gets
 * a friendly failure instead of a half-reset that keeps the old credential.
 *
 * An unlinked account is app-side only (the seeded and daycare-created login
 * path), so no GoTrue user is involved. A stale, unlinked GoTrue user is
 * looked up by email when the admin channel exists; if none is found there is
 * nothing to invalidate.
 */
export async function syncGoTruePassword(
  account: Row,
  password: string
): Promise<GoTrueSyncResult> {
  if (!supabaseConfigured()) return { ok: true, reason: "not-configured" };

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!serviceKey || !url) {
    if (account.auth_user_id) {
      console.error(
        "KID-2442 reset: SUPABASE_SERVICE_ROLE_KEY is unset but the account has a GoTrue identity; refusing a partial reset."
      );
      return { ok: false, reason: "no-service-key" };
    }
    // No linked GoTrue identity: the app-side hash is the login path.
    return { ok: true, reason: "no-linked-identity" };
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let userId = String(account.auth_user_id ?? "");
    if (!userId) {
      userId = (await findGoTrueUserIdByEmail(admin, String(account.email ?? ""))) ?? "";
    }
    if (!userId) return { ok: true, reason: "no-gotrue-user" };

    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) {
      console.error(
        `KID-2442 reset: GoTrue password update failed for ${String(account.email)}:`,
        error.message
      );
      return { ok: false, reason: "gotrue-update-failed" };
    }
    return { ok: true };
  } catch (err) {
    console.error(
      `KID-2442 reset: GoTrue call threw for ${String(account.email)}:`,
      err instanceof Error ? err.message : err
    );
    return { ok: false, reason: "gotrue-error" };
  }
}
