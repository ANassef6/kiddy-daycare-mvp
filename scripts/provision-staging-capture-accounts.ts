/**
 * KID-2474: provision the staging capture accounts Wren uses for the handbook
 * screenshots (KID-2471). The accounts belong to the existing "Founder Test
 * Daycare" staging fixture, next to the teacher login Wren already captures.
 *
 *   admin  wren.admin@example.test   role admin   (linked admin staff row)
 *   parent wren.parent@example.test  role parent  (linked to Layla + Omar Founder)
 *
 * Idempotent: rerunning updates the same two accounts, never duplicates them.
 * Passwords come from WREN_ADMIN_PASSWORD / WREN_PARENT_PASSWORD so no
 * credential is committed. Both accounts are email-confirmed and never carry
 * the temporary-password flag, and neither has a GoTrue identity — exactly
 * like the existing staging fixtures, login falls back to the app-side hash.
 *
 * SAFETY: refuses anything except an explicit local SQLite `file:` URL or a
 * Postgres URL matching KIDDY_SEED_STAGING_PROJECT (same guard as
 * scripts/seed-staging-founder.ts). Production is never a valid target.
 *
 * Usage:
 *   KIDDY_SEED_STAGING_PROJECT=<ref> \
 *   KIDDY_DATABASE_URL=postgres://... \
 *   WREN_ADMIN_PASSWORD=... WREN_PARENT_PASSWORD=... \
 *   npx tsx scripts/provision-staging-capture-accounts.ts
 */

import crypto from "node:crypto";

const CENTER_NAME = "Founder Test Daycare";
const ADMIN_EMAIL = "wren.admin@example.test";
const PARENT_EMAIL = "wren.parent@example.test";
const ADMIN_NAME = "Wren Capture Admin";
const PARENT_NAME = "Wren Capture Parent";
const CHILD_NAMES = [
  { first: "Layla", last: "Founder" },
  { first: "Omar", last: "Founder" },
];

function guardNotProduction() {
  const url = (process.env.KIDDY_DATABASE_URL ?? "").trim();
  if (/^file:/.test(url)) return;
  const ref = (process.env.KIDDY_SEED_STAGING_PROJECT ?? "").trim();
  if (/^[a-z0-9]{20}$/.test(ref) && isSupabaseProjectUrl(url, ref)) return;
  throw new Error(
    "KID-2474 capture-account provisioning refused: set KIDDY_SEED_STAGING_PROJECT=<staging project ref> " +
      "and KIDDY_DATABASE_URL to the connection for exactly that project, or use a local file: SQLite URL. " +
      "The production database is never a valid target."
  );
}

function isSupabaseProjectUrl(raw: string, ref: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return false;
    const host = u.hostname.toLowerCase();
    const user = decodeURIComponent(u.username).toLowerCase();
    if (host === `db.${ref}.supabase.co`) return true;
    if (host.endsWith(".pooler.supabase.com") && user === `postgres.${ref}`) return true;
    return false;
  } catch {
    return false;
  }
}

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function requirePassword(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value.length < 12) {
    throw new Error(`${name} must be set to a password of at least 12 characters.`);
  }
  return value;
}

async function ensureAccount(account: {
  email: string;
  fullName: string;
  password: string;
  role: string;
}): Promise<{ id: string; staffId: string | null }> {
  const { queryGet, queryRun } = await import("../lib/db");
  const existing = await queryGet("SELECT id, staff_id FROM account WHERE lower(email) = ?", account.email);
  const passwordHash = hashPassword(account.password);
  if (existing) {
    await queryRun(
      `UPDATE account
         SET password_hash = ?, full_name = ?, role = ?, email_confirmed = 1,
             must_change_password = 0, auth_user_id = NULL
       WHERE id = ?`,
      passwordHash,
      account.fullName,
      account.role,
      String(existing.id)
    );
    return { id: String(existing.id), staffId: existing.staff_id ? String(existing.staff_id) : null };
  }
  const id = crypto.randomUUID();
  await queryRun(
    `INSERT INTO account
       (id, email, password_hash, full_name, role, language, auth_user_id, email_confirmed, must_change_password)
     VALUES (?, ?, ?, ?, ?, 'en', NULL, 1, 0)`,
    id,
    account.email,
    passwordHash,
    account.fullName,
    account.role
  );
  return { id, staffId: null };
}

async function main() {
  guardNotProduction();
  const adminPassword = requirePassword("WREN_ADMIN_PASSWORD");
  const parentPassword = requirePassword("WREN_PARENT_PASSWORD");
  const { queryAll, queryGet, queryRun } = await import("../lib/db");

  const institute = await queryGet("SELECT id, name FROM institute WHERE name = ?", CENTER_NAME);
  if (!institute) throw new Error(`Staging fixture "${CENTER_NAME}" was not found.`);
  const instituteId = String(institute.id);

  const children = await queryAll(
    "SELECT id, first_name, last_name FROM child WHERE institute_id = ? AND active = 1",
    instituteId
  );
  const captureChildren = CHILD_NAMES.map((name) => {
    const row = children.find(
      (c) => String(c.first_name) === name.first && String(c.last_name) === name.last
    );
    if (!row) throw new Error(`Child ${name.first} ${name.last} was not found in ${CENTER_NAME}.`);
    return String(row.id);
  });

  const admin = await ensureAccount({
    email: ADMIN_EMAIL,
    fullName: ADMIN_NAME,
    password: adminPassword,
    role: "admin",
  });
  let staffId = admin.staffId;
  if (!staffId) {
    const existingStaff = await queryGet(
      "SELECT id FROM staff WHERE institute_id = ? AND lower(full_name) = lower(?)",
      instituteId,
      ADMIN_NAME
    );
    staffId = existingStaff ? String(existingStaff.id) : crypto.randomUUID();
    if (!existingStaff) {
      await queryRun(
        "INSERT INTO staff (id, institute_id, full_name, role) VALUES (?, ?, ?, 'admin')",
        staffId,
        instituteId,
        ADMIN_NAME
      );
    }
  }
  await queryRun(
    "UPDATE staff SET full_name = ?, role = 'admin', email = ? WHERE id = ?",
    ADMIN_NAME,
    ADMIN_EMAIL,
    staffId
  );
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", staffId, admin.id);

  const parent = await ensureAccount({
    email: PARENT_EMAIL,
    fullName: PARENT_NAME,
    password: parentPassword,
    role: "parent",
  });
  const { linkFamily } = await import("../lib/store");
  for (const childId of captureChildren) {
    await linkFamily(parent.id, childId, "parent");
  }

  console.log(`KID-2474 staging capture accounts ready in ${CENTER_NAME} (${instituteId}):`);
  console.log(`  admin  ${ADMIN_EMAIL} (account ${admin.id}, staff ${staffId})`);
  console.log(`  parent ${PARENT_EMAIL} (account ${parent.id}, children ${captureChildren.join(", ")})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("KID-2474 capture-account provisioning failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });

export {};
