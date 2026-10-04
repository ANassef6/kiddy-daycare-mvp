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
//   node supabase/verify-migrations.mjs              # PGlite, in-memory Postgres 17
//   DATABASE_URL=postgres://... node supabase/verify-migrations.mjs
//
// KID-173: the checks run on PGlite by default so they need no server. PGlite is
// Postgres compiled to WebAssembly, so this is the real engine and the real
// parser — which is the only thing that makes "the SQL parses and the statement
// does what its header says" a check rather than a hope. SQLite is not an option
// at any point: it has no migration ledger, no `WITH ... UPDATE`, and no window
// functions, so "this file is skipped once it is applied" and "this statement
// runs in production" are both unrepresentable there.
//
// DATABASE_URL still selects a server when one is given, which is how the 0018 /
// 0019 checks were first run. Everything runs in one transaction against a
// scratch schema that is rolled back before the script exits, so it leaves
// nothing behind. Set KIDDY_VERIFY_KEEP=1 to keep the schema for inspection
// instead.

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "migrations");
const require_ = createRequire(join(here, "..", "package.json"));

const connectionString = process.env.DATABASE_URL || process.env.KIDDY_DATABASE_URL;

// One adapter over the two engines so no check below has to know which is in
// play. `run` takes a multi-statement script (a migration file, a DO block);
// `all` takes one parameterised statement and returns rows.
function engineFor(url) {
  if (url) {
    if (!/^postgres(ql)?:\/\//.test(url)) {
      console.error(
        "verify-migrations: DATABASE_URL must be a real Postgres connection string.\n" +
          "  It refuses the SQLite URL the test suite uses, and any non-Postgres\n" +
          "  value, because there is nothing to verify in either case."
      );
      process.exit(2);
    }
    const { Client } = require_("pg");
    const client = new Client({ connectionString: url });
    return {
      name: `postgres (${new URL(url).host})`,
      connect: () => client.connect(),
      // node-postgres uses the simple query protocol here, which accepts a
      // multi-statement script; that is also what lib/db.ts pgExec relies on.
      run: (sql) => client.query(sql),
      all: async (sql, params) => (await client.query(sql, params)).rows,
      exec1: async (sql) => (await client.query(sql)).rowCount ?? null,
      close: () => client.end(),
    };
  }

  let PGlite;
  try {
    ({ PGlite } = require_("@electric-sql/pglite"));
  } catch {
    console.error(
      "verify-migrations: no Postgres to verify against.\n" +
        "  Set DATABASE_URL to a real Postgres connection string, or install\n" +
        "  @electric-sql/pglite for the in-memory build. It deliberately does\n" +
        "  not fall back to SQLite: SQLite cannot represent this."
    );
    process.exit(2);
  }
  const db = new PGlite();
  return {
    name: "pglite (postgres 17, in-memory)",
    connect: () => db.waitReady,
    run: (sql) => db.exec(sql),
    all: async (sql, params) => (await db.query(sql, params)).rows,
    // Single-statement only, so the affected-row count survives. PGlite's exec()
    // does not report it, and an idempotence check that could not see "0 rows
    // changed" would not be an idempotence check.
    exec1: async (sql) => (await db.query(sql)).affectedRows ?? null,
    close: () => db.close(),
  };
}

const db = engineFor(connectionString);

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

// Reports a value rather than asserting it, for anything an operator has to
// read: a row count that is silently wrong is exactly the failure mode the 0020
// checks exist to rule out, and it has to be visible in the output, not inferred
// from a passing assertion somewhere else.
function report(label, value) {
  console.log(`  --   ${label}: ${JSON.stringify(value)}`);
}

try {
  await db.connect();
  await db.run("BEGIN");
  await db.run(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.run(`CREATE SCHEMA ${SCHEMA}`);
  await db.run(`SET search_path = ${SCHEMA}, public`);
  // Two things a plain Postgres does not have and Supabase does: 0001's account
  // table references GoTrue's table, and 0003 grants RLS policies to the auth
  // roles. Created here only so the chain can be applied unmodified — the
  // migrations themselves must not be edited to suit the harness.
  await db.run("CREATE SCHEMA IF NOT EXISTS auth");
  await db.run("CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)");
  for (const role of ["anon", "authenticated"]) {
    await db.run(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role}; END IF; END $$`
    );
  }

  console.log(`\n== engine: ${db.name} ==`);
  console.log(`\n== applying ${files.length} migrations in filename order ==`);
  for (const file of files) {
    try {
      await db.run(readFileSync(join(migrationsDir, file), "utf8"));
      console.log(`  applied ${file}`);
    } catch (err) {
      console.log(`  FAIL  ${file}: ${err.message}`);
      failures.push(`apply ${file}`);
      break;
    }
  }
  if (failures.length === 0) {
    const ins = (table, cols, vals) =>
      db.all(
        `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
        vals
      );
    const links = async (accountId) =>
      (
        await db.all(
          `SELECT c.id || '@' || c.institute_id AS link
           FROM family_member fm JOIN child c ON c.id = fm.child_id
           WHERE fm.account_id = $1 ORDER BY c.id`,
          [accountId]
        )
      ).map((r) => String(r.link));
    // account.id -> the staff id it points at, so a check reads as a link rather
    // than as a row count. Used by the 0020 section.
    const staffLink = async (accountId) =>
      (await db.all(`SELECT staff_id FROM account WHERE id = $1`, [accountId])).map((r) =>
        r.staff_id === null ? null : String(r.staff_id)
      )[0] ?? null;

    // The chain above applied to empty tables, which proves it *applies*. A
    // data migration like 0018 is about the rows that were already there, so
    // clear those tables and rebuild the situation it exists for: one centre
    // invited the parent, a second centre only shares the address.
    await db.run("TRUNCATE family_member, invite, contact, child, account, institute CASCADE");

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
    await db.run(m18);
    check("the invited centre's siblings are linked", await links("acc-p"), ["c-a@inst-home", "c-b@inst-home"]);
    check("nothing leaks into the centre that only shares the address", (await links("acc-p")).filter((l) => l.endsWith("inst-other")), []);
    check("a staff account gains no family access", await links("acc-s"), []);

    // Idempotence: the statements must be re-runnable on their own. In
    // production ensurePgSchema() skips applied files, but a partially applied
    // chain or a manual re-run hits these statements again.
    await db.run(m18);
    await db.run(m18);
    check("re-running the backfill twice changes nothing", await links("acc-p"), ["c-a@inst-home", "c-b@inst-home"]);

    // A parent genuinely on file at two centres is linked at both — scoping
    // must follow the account's own records, not collapse to a single centre.
    // Once the second centre is in the account's set, every same-email child
    // there is a sibling, which is the runtime rule too.
    await ins("child", ["id", "institute_id", "first_name", "last_name"], ["c-y", "inst-other", "Salma", "Nassef"]);
    await ins("contact", ["id", "child_id", "full_name", "relationship", "email"], ["co-y", "c-y", "Nouran", "parent", shared]);
    await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-2", "inst-other", "c-y", shared, "code-2", "pending"]);
    await db.run(m18);
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
    await db.run("SAVEPOINT guard_check");
    await db.run("DROP INDEX uq_family_member_account_child");
    let guardRaised = false;
    try {
      await db.run(m18);
    } catch (err) {
      guardRaised = String(err.message).includes("0017_family_member_unique.sql");
    }
    await db.run("ROLLBACK TO SAVEPOINT guard_check");
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
    await db.run("DROP INDEX uq_family_member_account_child");
    await db.run(`CREATE UNIQUE INDEX uq_family_member_account_child ON family_member (account_id, child_id)`);
    await db.run("DELETE FROM family_member");

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
    await db.run(
      `INSERT INTO family_member (id, account_id, child_id, role) VALUES
         (md5('0018-wrote-this'), 'acc-r', 'c-a', 'parent'),
         (md5('0018-wrote-this-too'), 'acc-r', 'c-b', 'parent'),
         (md5('0018-leaked-this'), 'acc-r', 'c-x', 'parent')`
    );
    // A link the *application* made, at the foreign centre, for a different
    // account. 0019 must not be able to reach it: it is not a migration row,
    // and an admin granting access by hand is a decision, not damage.
    await db.run(
      `INSERT INTO account (id, email, password_hash, full_name, role)
       VALUES ('acc-staff-parent', 'staff-parent@example.com', 'x', 'Staff Parent', 'parent')`
    );
    await db.run(
      `INSERT INTO family_member (id, account_id, child_id, role) VALUES
         ('app-made-uid-abc123', 'acc-staff-parent', 'c-x', 'parent')`
    );
    check("the leak is present before the repair", (await links("acc-r")).filter((l) => l.endsWith("inst-other")), ["c-x@inst-other"]);

    const m19 = readFileSync(join(migrationsDir, "0019_institute_scope_repair.sql"), "utf8");
    await db.run(m19);

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
      await db.all("SELECT role FROM family_member WHERE account_id = 'acc-r' AND child_id = 'c-b'")
    )[0]?.role;
    await db.run(m19);
    check("re-running the repair changes nothing", (await links("acc-r")), ["c-a@inst-home", "c-b@inst-home"]);
    const roleAfter = (
      await db.all("SELECT role FROM family_member WHERE account_id = 'acc-r' AND child_id = 'c-b'")
    )[0]?.role;
    check("the repair preserves the role of a row it keeps", roleAfter, roleBefore);

    // ---------------------------------------------------------------------
    // 0020 — the centre's owner login joined to the staff record that is
    // already its own.
    //
    // Its own world. Every assertion below is about *which pairing is chosen*,
    // and the world above is built to test family_member tenancy, not
    // account -> staff: reusing it would test the wrong shape, exactly as the
    // 0019 section's first fixture did before it was corrected.
    //
    // The fixture is the shape lib/seed.ts produces — one institute, one owner
    // login with no invite and no family link, one staff record of the same
    // name — plus one case per refusal the migration's header promises.
    console.log("\n== 0020 account -> staff link ==");
    await db.run(
      "TRUNCATE family_member, invite, contact, child, account, staff_room, staff, room, institute CASCADE"
    );

    await ins("institute", ["id", "name"], ["inst-home", "Home Centre"]);
    await ins("institute", ["id", "name"], ["inst-other", "Other Centre"]);
    for (const [id, inst, name] of [
      ["r-toddlers", "inst-home", "Toddlers"],
      // Kept distinct from Toddlers for the reason QA recorded on 2026-10-03:
      // classroom reachability is per child, not per centre, so a staff member
      // who "has a classroom" is not the same as one who serves these children.
      ["r-manual", "inst-home", "manual test"],
      ["r-far", "inst-other", "Far Room"],
    ]) {
      await ins("room", ["id", "institute_id", "name"], [id, inst, name]);
    }
    // One child, in the room Maria is assigned. This is what makes her a
    // recipient at all — the D2 gate below walks exactly this chain.
    await ins("child", ["id", "institute_id", "first_name", "last_name", "room_id"], [
      "c-ella",
      "inst-home",
      "Ella",
      "Nguyen",
      "r-toddlers",
    ]);

    const staffRow = (id, inst, fullName, role) =>
      ins("staff", ["id", "institute_id", "full_name", "role"], [id, inst, fullName, role]);
    // Every staff record. Which of these have a login is the fixture's whole
    // point; names are unique except where a duplicate is the case under test.
    await staffRow("s-maria", "inst-home", "Maria Lopez", "admin"); // no login: the repair
    await staffRow("s-blue", "inst-home", "Blue Staff", "carer"); // already claimed
    await staffRow("s-far", "inst-other", "Far Owner", "admin"); // no login, evidenced
    await staffRow("s-x1-far", "inst-other", "Cross Owner", "admin"); // foreign name match
    await staffRow("s-two-home", "inst-home", "Two Way", "admin"); // same name at both
    await staffRow("s-two-other", "inst-other", "Two Way", "admin");
    await staffRow("s-amb-home", "inst-home", "Twin Owner", "admin"); // ambiguous:
    await staffRow("s-amb-other", "inst-other", "Twin Owner", "admin");
    await staffRow("s-dup", "inst-home", "Dup Owner", "admin"); // two accounts, one staff
    await staffRow("s-taken", "inst-home", "Taken Owner", "admin"); // free, but the account is not
    await staffRow("s-taken-other", "inst-home", "Other Person", "carer"); // already linked
    await staffRow("s-orphan", "inst-home", "Orphan Staff", "carer"); // unattributed non-owner
    await staffRow("s-crosscare", "inst-other", "Cross Care", "carer"); // evidenced, staff role
    // A same-name staff record that only the parent below could match. Without
    // it the parent-exclusion cannot be observed at all: acc-parent-maria
    // competes with acc-maria for s-maria, so dropping the role filter would
    // make the *owner* lose the join (the ambiguity guard would refuse both)
    // while the parent still ended up null — green on both counts, with the
    // guard removed. Naming one staff record that only a parent can reach is
    // what makes "a parent is never joined" a claim rather than an accident.
    await staffRow("s-parentonly", "inst-home", "Parent Only", "carer");
    // A blank name on both sides. `lower(trim('')) = lower(trim(''))` matches,
    // so without the blank guard these two join each other.
    await staffRow("s-blank", "inst-home", "", "carer");

    const accountRow = (id, email, fullName, role, staffId = null) =>
      ins("account", ["id", "email", "password_hash", "full_name", "role", "staff_id"], [
        id,
        email,
        "x",
        fullName,
        role,
        staffId,
      ]);

    // The seed's owner: no invite, no family link, so no tenancy evidence at
    // all. This is the row production actually carries.
    await accountRow("acc-maria", "admin@sunshinedaycare.test", "Maria Lopez", "owner");
    await accountRow("acc-blue", "blue@example.test", "Blue Staff", "staff", "s-blue");
    // Same name as the owner, same institute, and a child in Toddlers — a
    // parent account that looks like the staff member from every angle except
    // the one that matters.
    await accountRow("acc-parent-maria", "grace@example.test", "Maria Lopez", "parent");
    await ins("family_member", ["id", "account_id", "child_id", "role"], [
      "fm-parent",
      "acc-parent-maria",
      "c-ella",
      "parent",
    ]);
    await accountRow("acc-far", "far-owner@example.test", "Far Owner", "owner");
    await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], [
      "inv-far",
      "inst-other",
      null,
      "far-owner@example.test",
      "code-far",
      "accepted",
    ]);
    await accountRow("acc-x1", "x1@example.test", "Cross Owner", "owner");
    await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], [
      "inv-x1",
      "inst-home",
      null,
      "x1@example.test",
      "code-x1",
      "accepted",
    ]);
    await accountRow("acc-x2", "x2@example.test", "Two Way", "owner");
    await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], [
      "inv-x2",
      "inst-home",
      null,
      "x2@example.test",
      "code-x2",
      "accepted",
    ]);
    await accountRow("acc-amb", "amb@example.test", "Twin Owner", "owner");
    await accountRow("acc-dup1", "dup1@example.test", "Dup Owner", "owner");
    await accountRow("acc-dup2", "dup2@example.test", "Dup Owner", "owner");
    await accountRow("acc-taken", "taken@example.test", "Taken Owner", "owner", "s-taken-other");
    await accountRow("acc-claim", "blue2@example.test", "Blue Staff", "owner");
    await accountRow("acc-orphan", "orphan@example.test", "Orphan Staff", "staff");
    await accountRow("acc-crosscare", "crosscare@example.test", "Cross Care", "staff");
    // Evidenced at inst-home through its own family link only — no invite.
    await accountRow("acc-parentonly", "parentonly@example.test", "Parent Only", "parent");
    await ins("family_member", ["id", "account_id", "child_id", "role"], [
      "fm-parentonly",
      "acc-parentonly",
      "c-ella",
      "parent",
    ]);
    await accountRow("acc-blank", "blank@example.test", "", "owner");
    await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], [
      "inv-crosscare",
      "inst-other",
      null,
      "crosscare@example.test",
      "code-crosscare",
      "accepted",
    ]);

    // Classrooms, exactly as they were before the statement ran. The migration
    // writes one column on one table and must not move a single assignment.
    const staffRooms = async (staffId) =>
      (
        await db.all(
          `SELECT r.name FROM staff_room sr JOIN room r ON r.id = sr.room_id
            WHERE sr.staff_id = $1 ORDER BY r.name`,
          [staffId]
        )
      ).map((r) => String(r.name));
    const roomRows = async () =>
      (
        await db.all(
          `SELECT sr.staff_id || '@' || r.name AS pair
             FROM staff_room sr JOIN room r ON r.id = sr.room_id ORDER BY 1`
        )
      ).map((r) => String(r.pair));
    await ins("staff_room", ["staff_id", "room_id"], ["s-maria", "r-toddlers"]);
    await ins("staff_room", ["staff_id", "room_id"], ["s-blue", "r-manual"]);
    const roomsBefore = await roomRows();

    check("no login exists before the repair", await staffLink("acc-maria"), null);
    const recipientsBefore = await db.all(
      `SELECT a.id FROM account a
         JOIN staff s ON s.id = a.staff_id
         JOIN staff_room sr ON sr.staff_id = s.id
         JOIN child c ON c.room_id = sr.room_id
         JOIN family_member fm ON fm.child_id = c.id
        WHERE fm.account_id = $1 AND a.role IN ('staff','carer','admin','owner')`,
      ["acc-parent-maria"]
    );
    check("the parent has no recipient before the repair", recipientsBefore.length, 0);

    const m20 = readFileSync(join(migrationsDir, "0020_staff_login_link.sql"), "utf8");
    const rowsChanged = await db.exec1(m20);
    report("0020 rows changed on the seeded shape", rowsChanged);

    // The repair itself, and the seed's own invariant.
    check("the seeded owner login is joined to its staff record", await staffLink("acc-maria"), "s-maria");

    // Property 1 — institute scoping. acc-x1's only evidence places it at
    // inst-home and the only same-name staff record is at inst-other, so the
    // correct answer is to join nothing. Delete the institute predicate and this
    // becomes a cross-tenant attach.
    check("an account is never joined to a same-name staff record at another centre", await staffLink("acc-x1"), null);
    // acc-x2 is evidenced at inst-home and has a same-name staff record at BOTH
    // centres, so it must take the home one and leave the foreign one alone.
    check("an evidenced account takes the staff record at its own centre", await staffLink("acc-x2"), "s-two-home");
    check("an evidenced non-owner login is joined at its own centre", await staffLink("acc-crosscare"), "s-crosscare");
    check("an evidenced account at the other centre is joined there", await staffLink("acc-far"), "s-far");

    // Property 3 — never a parent. Two cases: one that shares a name with the
    // real owner, and one whose name only a parent could match.
    check("a parent account is never given a staff record", await staffLink("acc-parent-maria"), null);
    check("a parent is not joined even when it is the only name match", await staffLink("acc-parentonly"), null);

    // Property 2 — never steal, both directions.
    check("an already-linked account is never re-pointed", await staffLink("acc-taken"), "s-taken-other");
    check("a staff record that already has a login is never taken", await staffLink("acc-claim"), null);
    check("an already-linked account keeps its own link", await staffLink("acc-blue"), "s-blue");

    // Property 4 — do not guess. No name match, an ambiguous name, two accounts
    // for one staff record, and an unattributed login that is not owner/admin.
    check("an ambiguous name across centres joins nothing", await staffLink("acc-amb"), null);
    check("two accounts naming one free staff record join neither", [await staffLink("acc-dup1"), await staffLink("acc-dup2")], [null, null]);
    check("an unattributed non-owner login is not joined", await staffLink("acc-orphan"), null);
    // A blank name on both sides is a match, so the blank guard is load-bearing.
    check("a blank-named login is not matched to a blank-named staff record", await staffLink("acc-blank"), null);
    check("a free staff record nobody was matched to is left free", await staffLink("acc-taken"), "s-taken-other");

    // Property 5 — idempotence, measured in rows rather than in assertions.
    check("re-running the join changes 0 rows", await db.exec1(m20), 0);
    check("re-running leaves the seeded owner's link alone", await staffLink("acc-maria"), "s-maria");

    // Property 6 — leave correct data alone. The existing bluestaff-style login
    // keeps both its link and its one classroom, and not a single room
    // assignment moved anywhere.
    check("the existing staff login is untouched", await staffLink("acc-blue"), "s-blue");
    check("the existing staff login keeps its classroom", await staffRooms("s-blue"), ["manual test"]);
    check("no classroom assignment changed", await roomRows(), roomsBefore);

    // The data check that actually matters: the exact recipient query
    // `classroomStaffForParent` runs (lib/store.ts:2106), over the exact chain
    // the D2 gate needs — account -> staff -> staff_room -> child -> family_member.
    // Before the join this returns nothing, which is the reported symptom.
    const recipients = await db.all(
      `SELECT DISTINCT a.id, a.full_name
         FROM account a
         JOIN staff s ON s.id = a.staff_id
         JOIN staff_room sr ON sr.staff_id = s.id
         JOIN child c ON c.room_id = sr.room_id
         JOIN family_member fm ON fm.child_id = c.id
        WHERE fm.account_id = $1 AND a.role IN ('staff','carer','admin','owner')
        ORDER BY a.full_name`,
      ["acc-parent-maria"]
    );
    check(
      "the parent now sees the centre owner as a recipient",
      recipients.map((r) => `${r.id}:${r.full_name}`),
      ["acc-maria:Maria Lopez"]
    );
  }
} catch (err) {
  failures.push(`setup: ${err.message}`);
  console.log(`\n  ERROR ${err.message}`);
} finally {
  if (process.env.KIDDY_VERIFY_KEEP === "1") {
    console.log(`\nKIDDY_VERIFY_KEEP=1: leaving schema ${SCHEMA} in place for inspection.`);
    await db.run("COMMIT");
  } else {
    await db.run("ROLLBACK");
  }
  await db.close();
}

console.log(failures.length === 0 ? "\nAll migration checks passed." : `\n${failures.length} migration check(s) FAILED.`);
process.exit(failures.length === 0 ? 0 : 1);
