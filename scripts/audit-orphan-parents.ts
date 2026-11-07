#!/usr/bin/env node
// KID-733: read-only audit of parent accounts with no family_member link.
//
//   npx tsx scripts/audit-orphan-parents.ts
//
// Reads ONLY (no writes) the live data layer configured through
// KIDDY_DATABASE_URL — local SQLite for dev, the real Postgres URL for
// production — and prints one row per orphan: the account id, email, full
// name, confirmed flag, creation date, and any contact rows that carry the
// same email (the natural child to link). Exit code 0 always; the JSON is
// for the issue thread, never for automated deletion.

import { ensureSchema, queryAll } from "../lib/db";

async function main(): Promise<number> {
  await ensureSchema();
  const rows = await queryAll(
    `SELECT a.id, a.email, a.full_name, a.email_confirmed, a.created_at,
            (SELECT count(*) FROM family_member f WHERE f.account_id = a.id) AS link_count
     FROM account a
     WHERE a.role = 'parent'
     ORDER BY a.created_at ASC`
  );
  const allParents = rows.length;
  const orphans = rows.filter((r) => Number(r.link_count) === 0);
  const withContacts = [];
  for (const o of orphans) {
    const contacts = await queryAll(
      `SELECT c.first_name, c.last_name, co.institute_id, co.child_id
       FROM contact co JOIN child c ON c.id = co.child_id
       WHERE lower(trim(co.email)) = lower(trim(?))`,
      String(o.email)
    );
    withContacts.push({
      id: String(o.id),
      email: String(o.email),
      fullName: String(o.full_name ?? ""),
      emailConfirmed: Number(o.email_confirmed ?? 0) === 1,
      createdAt: String(o.created_at ?? ""),
      suggestedChildLinks: contacts.map((c) => ({
        childId: String(c.child_id),
        childName: `${String(c.first_name ?? "")} ${String(c.last_name ?? "")}`.trim(),
        instituteId: String(c.institute_id ?? ""),
      })),
    });
  }
  const summary = {
    totalParentAccounts: allParents,
    orphans: orphans.length,
    sitesAudited: process.env.KIDDY_DATABASE_URL
      ? process.env.KIDDY_DATABASE_URL.startsWith("file:")
        ? "local SQLite (dev)"
        : "Postgres"
      : "default SQLite (dev)",
    orphanDetail: withContacts,
  };
  console.log(JSON.stringify(summary, null, 2));
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error("audit-orphan-parents failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
);
