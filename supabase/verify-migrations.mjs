#!/usr/bin/env node
// Verifies supabase/migrations/*.sql against a real Postgres.
//
// Why this exists: the QA suite runs lib/sqlite-schema.ts, the *mirror* of
// these migrations, not the files themselves. Nothing in the test suite ever
// executed the Postgres SQL, so a migration could describe institute scoping in
// its header while its statement contained no institute predicate at all —
// which is exactly how KID-149 shipped. This script closes that gap: it applies
// the whole chain to a real Postgres in filename order, the same order
// ensurePgSchema() uses, and then asserts the tenant-isolation invariants the
// KID-149/152 rule requires.
//
// Usage:
//   DATABASE_URL=postgres://... node supabase/verify-migrations.mjs
//
// Everything runs in one transaction against a scratch schema that is rolled
// back before the script exits, so it leaves nothing behind. Set
// KIDDY_VERIFY_KEEP=1 to keep the schema for inspection instead.

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "migrations");
const { Client } = createRequire(join(here, "..", "package.json"))("pg");

const connectionString = process.env.DATABASE_URL || process.env.KIDDY_DATABASE_URL;
if (!connectionString || !/^postgres(ql)?:\/\//.test(connectionString)) {
  console.error(
    "verify-migrations: DATABASE_URL must be a real Postgres connection string.\n" +
      "  It refuses the SQLite URL the test suite uses, and any non-Postgres\n" +
      "  value, because there is nothing to verify in either case."
  );
  process.exit(2);
}

const SCHEMA = "kiddy_migration_verify";
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const failures = [];
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(
      `  FAIL ${label}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`
    );
    failures.push(label);
  }
}

const client = new Client({ connectionString });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path = ${SCHEMA}, public`);
  // Two things a plain Postgres does not have and Supabase does: 0001's account
  // table references GoTrue's table, and 0003 grants RLS policies to the auth
  // roles. Created here only so the chain can be applied unmodified — the
  // migrations themselves must not be edited to suit the harness.
  await client.query("CREATE SCHEMA IF NOT EXISTS auth");
  await client.query("CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)");
  for (const role of ["anon", "authenticated"]) {
    await client.query(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role}; END IF; END $$`
    );
  }

  console.log(`\n== applying ${files.length} migrations in filename order ==`);
  for (const file of files) {
    try {
      await client.query(readFileSync(join(migrationsDir, file), "utf8"));
      console.log(`  applied ${file}`);
    } catch (err) {
      console.log(`  FAIL  ${file}: ${err.message}`);
      failures.push(`apply ${file}`);
      break;
    }
  }
  if (failures.length === 0) {
    const ins = (table, cols, vals) =>
      client.query(
        `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
        vals
      );
    const links = async (accountId) =>
      (
        await client.query(
          `SELECT c.id || '@' || c.institute_id AS link
           FROM family_member fm JOIN child c ON c.id = fm.child_id
           WHERE fm.account_id = $1 ORDER BY c.id`,
          [accountId]
        )
      ).rows.map((r) => String(r.link));

    // The chain above applied to empty tables, which proves it *applies*. A
    // data migration like 0018 is about the rows that were already there, so
    // clear those tables and rebuild the situation it exists for: one centre
    // invited the parent, a second centre only shares the address.
    await client.query("TRUNCATE family_member, invite, contact, child, account, institute CASCADE");

    await ins("institute", ["id", "name"], ["inst-home", "Home Centre"]);
    await ins("institute", ["id", "name"], ["inst-other", "Other Centre"]);
    for (const [id, inst, name] of [
      ["c-a", "inst-home", "Becca"],
      ["c-b", "inst-home", "Mikael"],
      ["c-x", "inst-other", "Stranger"],
    ]) {
      await ins("child", ["id", "institute_id", "first_name", "last_name"], [id, inst, name, "Nassef"]);
    }
    const shared = "shared-parent@example.com";
    // The same guardian address on file at two different centres, and the SQL
    // is deliberately not normalised the way a hand-typed row often is.
    await ins("contact", ["id", "child_id", "full_name", "relationship", "email"], ["co-a", "c-a", "Nouran", "parent", shared]);
    await ins("contact", ["id", "child_id", "full_name", "relationship", "email"], ["co-b", "c-b", "Nouran", "parent", "  SHARED-PARENT@Example.com "]);
    await ins("contact", ["id", "child_id", "full_name", "relationship", "email"], ["co-x", "c-x", "Nouran", "parent", shared]);

    await ins("account", ["id", "email", "password_hash", "full_name", "role"], ["acc-p", shared, "x", "Nouran", "parent"]);
    await ins("account", ["id", "email", "password_hash", "full_name", "role"], ["acc-s", "carer@example.com", "x", "Carer", "staff"]);
    await ins("contact", ["id", "child_id", "full_name", "relationship", "email"], ["co-s", "c-a", "Carer", "parent", "carer@example.com"]);
    await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-1", "inst-home", "c-a", "  SHARED-PARENT@example.com ", "code-1", "accepted"]);

    const m18 = readFileSync(join(migrationsDir, "0018_sibling_family_link_backfill.sql"), "utf8");

    console.log("\n== KID-149/152 tenant isolation ==");
    await client.query(m18);
    check("the invited centre's siblings are linked", await links("acc-p"), ["c-a@inst-home", "c-b@inst-home"]);
    check("nothing leaks into the centre that only shares the address", (await links("acc-p")).filter((l) => l.endsWith("inst-other")), []);
    check("a staff account gains no family access", await links("acc-s"), []);

    // Idempotence: the statements must be re-runnable on their own. In
    // production ensurePgSchema() skips applied files, but a partially applied
    // chain or a manual re-run hits these statements again.
    await client.query(m18);
    await client.query(m18);
    check("re-running the backfill twice changes nothing", await links("acc-p"), ["c-a@inst-home", "c-b@inst-home"]);

    // A parent genuinely on file at two centres is linked at both — scoping
    // must follow the account's own records, not collapse to a single centre.
    // Once the second centre is in the account's set, every same-email child
    // there is a sibling, which is the runtime rule too.
    await ins("child", ["id", "institute_id", "first_name", "last_name"], ["c-y", "inst-other", "Salma", "Nassef"]);
    await ins("contact", ["id", "child_id", "full_name", "relationship", "email"], ["co-y", "c-y", "Nouran", "parent", shared]);
    await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-2", "inst-other", "c-y", shared, "code-2", "pending"]);
    await client.query(m18);
    check("a parent invited by two centres is linked at both", await links("acc-p"), [
      "c-a@inst-home",
      "c-b@inst-home",
      "c-x@inst-other",
      "c-y@inst-other",
    ]);

    // The index guard: 0018 must fail loudly rather than corrupt data if 0017
    // is missing. A raised exception aborts the whole transaction in Postgres,
    // so this runs inside a savepoint and is rolled back to it — otherwise the
    // abort would poison every statement after it and the rest of the file
    // would report failures that have nothing to do with the code under test.
    await client.query("SAVEPOINT guard_check");
    await client.query("DROP INDEX uq_family_member_account_child");
    let guardRaised = false;
    try {
      await client.query(m18);
    } catch (err) {
      guardRaised = String(err.message).includes("0017_family_member_unique.sql");
    }
    await client.query("ROLLBACK TO SAVEPOINT guard_check");
    check("a missing 0017 index raises the named guard error", guardRaised, true);

    // ---------------------------------------------------------------------
    // 0019's repair half — the statement production will actually run.
    //
    // Everything above exercises 0018, corrected in place. But production has
    // 0018 in its ledger already, so it will skip the corrected body and run
    // 0019 instead. 0019's first statement is a DELETE, and a DELETE that is
    // only ever tested on a database where there is nothing to delete proves
    // nothing: the risk is entirely in the rows it wrongly removes. So rebuild
    // the world as the *unscoped* 0018 left it, then run 0019 and check both
    // what it removed and, just as importantly, what it left alone.
    console.log("\n== 0019 repair of a database the unscoped 0018 already touched ==");
    await client.query("DROP INDEX uq_family_member_account_child");
    await client.query(`CREATE UNIQUE INDEX uq_family_member_account_child ON family_member (account_id, child_id)`);
    await client.query("DELETE FROM family_member");

    // The scenario has to be the single-institute parent, not the two-centre
    // one built above. The earlier section deliberately put an invite at
    // inst-other, which is exactly the evidence 0019's delete treats as
    // legitimate tenancy — reusing that account here would test the wrong
    // thing and the delete would (correctly) spare it. So give the repair its
    // own account that is on file at inst-home only, and a child + contact at
    // inst-other carrying the same address. That is the shape of the real
    // production leak: one centre knows the parent, another merely shares the
    // email.
    await ins("account", ["id", "email", "password_hash", "full_name", "role"], [
      "acc-r",
      "repair-parent@example.com",
      "x",
      "Nouran",
      "parent",
    ]);
    await ins("contact", ["id", "child_id", "full_name", "relationship", "email"], [
      "co-r-home",
      "c-a",
      "Nouran",
      "parent",
      "repair-parent@example.com",
    ]);
    await ins("contact", ["id", "child_id", "full_name", "relationship", "email"], [
      "co-r-other",
      "c-x",
      "Nouran",
      "parent",
      "repair-parent@example.com",
    ]);
    await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], [
      "inv-r",
      "inst-home",
      "c-a",
      "repair-parent@example.com",
      "code-r",
      "accepted",
    ]);

    // Re-create the two grants the unscoped 0018 would have made: the sibling
    // it should have made (c-b at the invited centre) and the cross-tenant one
    // it wrongly made (c-x, a stranger's child at the other centre). Ids are
    // 32-char hex because that is what 0018 mints, and 0019's eligibility test
    // keys on exactly that — a row written any other way is not a candidate.
    await client.query(
      `INSERT INTO family_member (id, account_id, child_id, role) VALUES
         (md5('0018-wrote-this'), 'acc-r', 'c-a', 'parent'),
         (md5('0018-wrote-this-too'), 'acc-r', 'c-b', 'parent'),
         (md5('0018-leaked-this'), 'acc-r', 'c-x', 'parent')`
    );
    // A link the *application* made, at the foreign centre, for a different
    // account. 0019 must not be able to reach it: it is not a migration row,
    // and an admin granting access by hand is a decision, not damage.
    await client.query(
      `INSERT INTO account (id, email, password_hash, full_name, role)
       VALUES ('acc-staff-parent', 'staff-parent@example.com', 'x', 'Staff Parent', 'parent')`
    );
    await client.query(
      `INSERT INTO family_member (id, account_id, child_id, role) VALUES
         ('app-made-uid-abc123', 'acc-staff-parent', 'c-x', 'parent')`
    );
    check("the leak is present before the repair", (await links("acc-r")).filter((l) => l.endsWith("inst-other")), ["c-x@inst-other"]);

    const m19 = readFileSync(join(migrationsDir, "0019_institute_scope_repair.sql"), "utf8");
    await client.query(m19);

    check(
      "the cross-tenant grant the unscoped 0018 wrote is removed",
      (await links("acc-r")).filter((l) => l.endsWith("inst-other")),
      []
    );
    check(
      "the sibling the unscoped 0018 correctly wrote is left in place",
      (await links("acc-r")),
      ["c-a@inst-home", "c-b@inst-home"]
    );
    check(
      "a link the application made by hand is never deleted",
      await links("acc-staff-parent"),
      ["c-x@inst-other"]
    );

    // Idempotence of the repair itself, and the role of a surviving row: the
    // delete is filtered on institute crossings only, so it must not rewrite
    // what it keeps.
    const roleBefore = (
      await client.query("SELECT role FROM family_member WHERE account_id = 'acc-r' AND child_id = 'c-b'")
    ).rows[0]?.role;
    await client.query(m19);
    check("re-running the repair changes nothing", (await links("acc-r")), ["c-a@inst-home", "c-b@inst-home"]);
    const roleAfter = (
      await client.query("SELECT role FROM family_member WHERE account_id = 'acc-r' AND child_id = 'c-b'")
    ).rows[0]?.role;
    check("the repair preserves the role of a row it keeps", roleAfter, roleBefore);
  }
} catch (err) {
  failures.push(`setup: ${err.message}`);
  console.log(`\n  ERROR ${err.message}`);
} finally {
  if (process.env.KIDDY_VERIFY_KEEP === "1") {
    console.log(`\nKIDDY_VERIFY_KEEP=1: leaving schema ${SCHEMA} in place for inspection.`);
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  await client.end();
}

console.log(failures.length === 0 ? "\nAll migration checks passed." : `\n${failures.length} migration check(s) FAILED.`);
process.exit(failures.length === 0 ? 0 : 1);
