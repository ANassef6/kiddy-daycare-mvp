#!/usr/bin/env node
// KID-472 item 7: production migration for the Sunshine demo admin account.
//
//   npx tsx scripts/update-sunshine-admin.ts
//
// What it does (idempotent — safe to run repeatedly, second pass is a no-op):
//   1. Updates the public.account row for the Sunshine admin: new email,
//      display name, and the password hash when a password is supplied.
//      The account id, staff link, role, tenant and authored records stay.
//   2. In Postgres mode, moves the attached Supabase GoTrue identity to the
//      new email (+ bcrypt password when supplied) and refreshes identity_data
//      / raw_user_meta_data. The identity is never created if it does not exist.
//   3. Verifies: the retired email matches no row; the new email exists with
//      the expected display name and an acceptable password hash.
//
// Inputs (never hardcoded, never printed):
//   KIDDY_DATABASE_URL              production Postgres URL (required)
//   SUNSHINE_DEMO_ADMIN_PASSWORD    the board-supplied password (optional;
//                                   when absent the run only fixes email/name)
//
// No password value is ever written to disk, logs or comments. Rollback SQL
// lives in docs/evidence/kid472-sunshine-admin-account/rollback.sql.

import fs from "node:fs";
import path from "node:path";
import { updateSunshineAdmin, verifySunshineAdmin } from "../lib/sunshine-admin";
import { ensureSchema } from "../lib/db";

function loadDotEnv(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^"+|"+$/g, "");
    }
  }
}

async function main(): Promise<number> {
  loadDotEnv();
  if (!process.env.KIDDY_DATABASE_URL) {
    console.error("Missing KIDDY_DATABASE_URL — refusing to guess where production data lives.");
    return 1;
  }
  const password = process.env.SUNSHINE_DEMO_ADMIN_PASSWORD || undefined;
  if (!password) {
    console.log("SUNSHINE_DEMO_ADMIN_PASSWORD not set — running email/name pass only; re-run with the variable to set the password.");
  }
  await ensureSchema();
  const result = await updateSunshineAdmin({ password });
  for (const m of result.messages) console.log(`- ${m}`);
  const check = await verifySunshineAdmin();
  if (check.ok) {
    console.log(`VERIFY OK: retired email unmatched; new email exists; display name set; password ${password ? "accepted" : "kept"}`);
    return 0;
  }
  for (const p of check.problems) console.error(`VERIFY FAIL: ${p}`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
