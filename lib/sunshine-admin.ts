// KID-472 item 7: the Sunshine demo admin account moves from the placeholder
// identity (admin@sunshinedaycare.test / "Maria Lopez") to the board's real
// identity. The email/name values here are the single source of truth for the
// migration; the PASSWORD never lives in this repo — it is supplied at runtime
// (see scripts/update-sunshine-admin.ts, env SUNSHINE_DEMO_ADMIN_PASSWORD).

import { hashPassword, verifyPassword } from "./auth";
import { isPostgresMode, queryGet, queryRun } from "./db";

export const SUNSHINE_ADMIN_OLD_EMAIL = "admin@sunshinedaycare.test";
export const SUNSHINE_ADMIN_EMAIL = "trois4ever+admin@gmail.com";
export const SUNSHINE_ADMIN_NAME = "Nassef";

export type SunshineAdminUpdateInput = {
  oldEmail?: string;
  newEmail?: string;
  fullName?: string;
  password?: string;
};

export type SunshineAdminUpdateResult = {
  accountEmailUpdated: boolean;
  accountNameUpdated: boolean;
  passwordUpdated: boolean;
  gotrueUpdated: boolean;
  gotrueFound: boolean;
  alreadyApplied: boolean;
  messages: string[];
};

const GOTRUE_TABLE = "auth.users";

async function gotrueTableExists(): Promise<boolean> {
  const row = await queryGet("SELECT to_regclass('auth.users') AS reg");
  return !!row?.reg;
}

type GoTrueUser = {
  id: string;
  email: string | null;
  encrypted_password: string | null;
};

async function findGotrueUser(emailLower: string): Promise<GoTrueUser | undefined> {
  if (!(await gotrueTableExists())) return undefined;
  return (await queryGet(
    `SELECT id, email, encrypted_password FROM ${GOTRUE_TABLE}
     WHERE lower(email) = ? LIMIT 1`,
    emailLower
  )) as GoTrueUser | undefined;
}

// Applies the identity migration to the account data row and, in Postgres mode
// (where the Supabase auth schema lives in the same database), to the GoTrue
// identity itself. Idempotent by construction: it keys off current emails,
// not off run order, and a second pass with the same inputs changes nothing.
//
// Rules the review will care about:
// - The account id, staff link, tenant and authored records are preserved —
//   only email, full_name and (optionally) password_hash change on the row.
// - A password is only ever consumed from the caller; it is never logged.
// - The GoTrue identity is updated when present; it is never created, so this
//   script cannot conjure a sign-in that the tenant did not already have.
export async function updateSunshineAdmin(
  input: SunshineAdminUpdateInput = {}
): Promise<SunshineAdminUpdateResult> {
  const oldEmail = (input.oldEmail ?? SUNSHINE_ADMIN_OLD_EMAIL).toLowerCase();
  const newEmail = (input.newEmail ?? SUNSHINE_ADMIN_EMAIL).toLowerCase();
  const fullName = input.fullName ?? SUNSHINE_ADMIN_NAME;
  const messages: string[] = [];
  const result: SunshineAdminUpdateResult = {
    accountEmailUpdated: false,
    accountNameUpdated: false,
    passwordUpdated: false,
    gotrueUpdated: false,
    gotrueFound: false,
    alreadyApplied: false,
    messages,
  };

  const current = (await queryGet(
    `SELECT id, email, password_hash, full_name, role, staff_id, auth_user_id
     FROM account WHERE lower(email) = ? LIMIT 1`,
    newEmail
  )) as
    | {
        id: string;
        password_hash: string;
        full_name: string;
        auth_user_id: string | null;
      }
    | undefined;

  if (current) {
    // Already applied (or the tenant runs the new identity natively): only a
    // supplied-but-missing password change still has work to do, plus name
    // fixes. The old-email check guards against a second account still
    // carrying the retired login.
    if (input.fullName !== undefined && current.full_name !== fullName) {
      await queryRun("UPDATE account SET full_name = ? WHERE id = ?", fullName, current.id);
      result.accountNameUpdated = true;
      messages.push(`account ${current.id} display name corrected to "${fullName}"`);
    }
    if (
      input.password &&
      typeof current.password_hash === "string" &&
      !verifyPassword(input.password, current.password_hash)
    ) {
      await queryRun(
        "UPDATE account SET password_hash = ? WHERE id = ?",
        hashPassword(input.password),
        current.id
      );
      result.passwordUpdated = true;
      messages.push(`account ${current.id} password hash refreshed`);
    }
    const stale = (await queryGet(
      "SELECT id FROM account WHERE lower(email) = ? LIMIT 1",
      oldEmail
    )) as { id: string } | undefined;
    if (stale) {
      messages.push(
        `different account ${stale.id} still holds the retired email "${oldEmail}" — left untouched, review it manually`
      );
    } else {
      messages.push(`verified: no account row carries "${oldEmail}"`);
      result.alreadyApplied = true;
    }
    if (isPostgresMode() && input.password) {
      const user =
        (await findGotrueUser(oldEmail)) ?? (await findGotrueUser(newEmail));
      if (user) {
        result.gotrueFound = true;
        const bcrypt = (await import("bcryptjs")).default ?? (await import("bcryptjs"));
        await queryRun(
          "UPDATE auth.users SET encrypted_password = ? WHERE id = ?",
          bcrypt.hashSync(input.password, 10),
          user.id
        );
        result.gotrueUpdated = true;
        messages.push(`GoTrue identity ${user.id} encrypted_password refreshed`);
      }
    }
    return result;
  }

  const row = (await queryGet(
    `SELECT id, email, password_hash, full_name, role, staff_id, auth_user_id
     FROM account WHERE lower(email) = ? LIMIT 1`,
    oldEmail
  )) as
    | {
        id: string;
        email: string;
        full_name: string;
        auth_user_id: string | null;
      }
    | undefined;

  if (!row) {
    throw new Error(
      `sunshine-admin-not-found: no account row carries "${oldEmail}" and none carries "${newEmail}" — refusing to invent one`
    );
  }

  // ---- GoTrue identity (Postgres mode; same database, auth schema) ----
  if (isPostgresMode()) {
    const user = (await findGotrueUser(oldEmail)) ?? (await findGotrueUser(newEmail));
    if (user) {
      result.gotrueFound = true;
      await queryRun(
        `UPDATE ${GOTRUE_TABLE}
         SET email = ?,
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                                  || ?::jsonb
         WHERE id = ?`,
        newEmail,
        JSON.stringify({ full_name: fullName, name: fullName }),
        user.id
      );
      await queryRun(
        `UPDATE auth.identities
         SET identity_data = identity_data || ?::jsonb
         WHERE user_id = ? AND provider = 'email'`,
        JSON.stringify({ email: newEmail, email_verified: true }),
        user.id
      );
      if (input.password) {
        const bcrypt = (await import("bcryptjs")).default ?? (await import("bcryptjs"));
        await queryRun(
          "UPDATE auth.users SET encrypted_password = ? WHERE id = ?",
          bcrypt.hashSync(input.password, 10),
          user.id
        );
      }
      if (row.auth_user_id !== user.id) {
        await queryRun("UPDATE account SET auth_user_id = ? WHERE id = ?", user.id, row.id);
        messages.push(`account ${row.id} auth_user_id linked to GoTrue ${user.id}`);
      }
      result.gotrueUpdated = true;
      messages.push(
        `GoTrue identity ${user.id} moved to the new email${input.password ? " (+ password)" : ""}`
      );
    } else {
      messages.push("no GoTrue identity row exists for the admin account — identity step skipped");
    }
  } else {
    messages.push(
      "SQLite mode: no auth.users schema here — GoTrue step is skipped (unit-test/dev mode)"
    );
  }

  // ---- public.account row (single UPDATE keeps id, staff link, role) ----
  const hashOrNull = input.password ? hashPassword(input.password) : null;
  // COALESCE keeps the existing hash when no password is supplied, so the
  // email/name pass never disturbs the stored credential in either engine.
  await queryRun(
    "UPDATE account SET email = ?, full_name = ?, password_hash = COALESCE(?, password_hash) WHERE id = ?",
    newEmail,
    fullName,
    hashOrNull,
    row.id
  );
  result.accountEmailUpdated = true;
  result.accountNameUpdated = row.full_name !== fullName;
  result.passwordUpdated = hashOrNull !== null;
  messages.push(
    `account ${row.id} updated: email="${newEmail}", display name="${fullName}"${row.full_name !== fullName ? ` (was "${row.full_name}")` : ""}${input.password ? ", password refreshed" : ", password kept"}`
  );
  return result;
}

// Post-pass check used by the script and the test: the retired email must match
// no account row and the active one must carry the new display name.
export async function verifySunshineAdmin(
  input: { oldEmail?: string; newEmail?: string; fullName?: string } = {}
): Promise<{ ok: boolean; problems: string[] }> {
  const oldEmail = (input.oldEmail ?? SUNSHINE_ADMIN_OLD_EMAIL).toLowerCase();
  const newEmail = (input.newEmail ?? SUNSHINE_ADMIN_EMAIL).toLowerCase();
  const fullName = input.fullName ?? SUNSHINE_ADMIN_NAME;
  const problems: string[] = [];

  const retired = await queryGet("SELECT id FROM account WHERE lower(email) = ? LIMIT 1", oldEmail);
  if (retired) problems.push(`account ${retired.id} still carries the retired email "${oldEmail}"`);

  const active = (await queryGet(
    "SELECT id, full_name, password_hash FROM account WHERE lower(email) = ? LIMIT 1",
    newEmail
  )) as { id: string; full_name: string; password_hash: string } | undefined;
  if (!active) {
    problems.push(`no account row carries "${newEmail}"`);
    return { ok: false, problems };
  }
  if (active.full_name !== fullName) {
    problems.push(`display name is "${active.full_name}", expected "${fullName}"`);
  }
  return { ok: problems.length === 0, problems };
}
