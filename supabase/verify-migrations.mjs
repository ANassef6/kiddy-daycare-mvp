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
    await staffRow("s-maria", "inst-home", "Nassef", "admin"); // no login: the repair
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
    await accountRow("acc-maria", "trois4ever+admin@gmail.com", "Nassef", "owner");
    await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], [
      "inv-maria",
      "inst-home",
      null,
      "trois4ever+admin@gmail.com",
      "code-maria",
      "accepted",
    ]);
    await accountRow("acc-blue", "blue@example.test", "Blue Staff", "staff", "s-blue");
    // Same name as the owner, same institute, and a child in Toddlers — a
    // parent account that looks like the staff member from every angle except
    // the one that matters.
    await accountRow("acc-parent-maria", "grace@example.test", "Nassef", "parent");
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
        WHERE fm.account_id = $1 AND a.role IN ('teacher','caregiver','admin','owner')`,
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
        WHERE fm.account_id = $1 AND a.role IN ('teacher','caregiver','admin','owner')
        ORDER BY a.full_name`,
      ["acc-parent-maria"]
    );
    check(
      "the parent now sees the centre owner as a recipient",
      recipients.map((r) => `${r.id}:${r.full_name}`),
      ["acc-maria:Nassef"]
    );

    // ---------------------------------------------------------------------
    // 0033 — KID-485 role model. Legacy 'staff'/'carer' staff rows and login
    // accounts become 'teacher'; an admin-labeled staff record promotes its
    // linked login to 'admin'; owner rows and accounts stay untouched; the
    // default becomes 'teacher'. Replaying the file must be a no-op.
    {
      console.log("\n== 0033 kid485 role model ==");
      await db.run("TRUNCATE family_member, invite, contact, child, account, staff_room, staff, institute CASCADE");
      await ins("institute", ["id", "name"], ["inst-roles", "Role Centre"]);
      await staffRow("st-carer", "inst-roles", "Legacy Carer", "carer");
      await staffRow("st-staff", "inst-roles", "Legacy Staff", "staff");
      await staffRow("st-admin", "inst-roles", "Legacy Admin", "admin");
      await staffRow("st-owner", "inst-roles", "Owner Profile", "owner");
      // Seed the login accounts directly (the accountRow helper keeps its own
      // SELECT contract).
      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role, staff_id) VALUES
        ('ac-carer', 'legacy-carer@x.test', 'x', 'Legacy Carer', 'carer', 'st-carer'),
        ('ac-staff', 'legacy-staff@x.test', 'x', 'Legacy Staff', 'staff', 'st-staff'),
        ('ac-adminlink', 'legacy-admin@x.test', 'x', 'Legacy Admin', 'staff', 'st-admin'),
        ('ac-admin-true', 'already-admin@x.test', 'x', 'Already Admin', 'admin', 'st-admin2'),
        ('ac-owner', 'owner-staff@x.test', 'x', 'Owner Profile', 'owner', 'st-owner')`);
      await staffRow("st-admin2", "inst-roles", "Already Admin Staff", "admin");

      const rolesSnapshot = async () =>
        (await db.all(
          `SELECT id, role FROM account WHERE id IN ('ac-carer','ac-staff','ac-adminlink','ac-admin-true','ac-owner')
           UNION ALL SELECT id, role FROM staff WHERE id IN ('st-carer','st-staff','st-admin','st-owner','st-admin2')
           ORDER BY id`
        )).map((r) => `${r.id}=${r.role}`);

      await db.run(readFileSync(join(migrationsDir, "0033_kid485_role_model.sql"), "utf8"));
      check(
        "legacy carer/staff rows and accounts rename to teacher",
        await rolesSnapshot(),
        [
          "ac-admin-true=admin",
          "ac-adminlink=admin",
          "ac-carer=teacher",
          "ac-owner=owner",
          "ac-staff=teacher",
          "st-admin=admin",
          "st-admin2=admin",
          "st-carer=teacher",
          "st-owner=owner",
          "st-staff=teacher",
        ]
      );
      check("new staff rows default to teacher", (await db.all(
        `INSERT INTO staff (id, institute_id, full_name) VALUES ('st-default','inst-roles','Default Dolly') RETURNING role`
      )).map((r) => String(r.role)), ["teacher"]);

      // Idempotence: replay changes nothing anywhere.
      await db.run(readFileSync(join(migrationsDir, "0033_kid485_role_model.sql"), "utf8"));
      check(
        "replaying 0033 changes nothing",
        (await rolesSnapshot()).concat((await db.all(`SELECT role FROM staff WHERE id = 'st-default'`)).map((r) => `st-default=${r.role}`)),
        [
          "ac-admin-true=admin",
          "ac-adminlink=admin",
          "ac-carer=teacher",
          "ac-owner=owner",
          "ac-staff=teacher",
          "st-admin=admin",
          "st-admin2=admin",
          "st-carer=teacher",
          "st-owner=owner",
          "st-staff=teacher",
          "st-default=teacher",
        ]
      );
    }

    // ---------------------------------------------------------------------
    // 0034 — KID-498 parent activation repair. Orphan parent accounts (created
    // by a registration whose child-link step never ran) get their missing
    // family_member row from the newest still-pending, child-naming invite,
    // and that invite is accepted. The invite's own institute anchors the
    // tenant; a same-email child at ANOTHER centre is never consulted.
    {
      const m34 = readFileSync(join(migrationsDir, "0034_kid498_parent_activation_repair.sql"), "utf8");
      console.log("\n== 0034 kid498 parent activation repair ==");
      await db.run("TRUNCATE family_member, invite, contact, child, account, staff_room, staff, institute CASCADE");
      await ins("institute", ["id", "name"], ["inst-home", "Home Centre"]);
      await ins("institute", ["id", "name"], ["inst-other", "Other Centre"]);
      for (const [id, inst, name] of [
        ["c-home", "inst-home", "Zein"],
        ["c-far", "inst-other", "Stranger"],
        ["c-gone", "inst-home", "Withdrawn Kid"],
      ]) {
        await ins("child", ["id", "institute_id", "first_name", "last_name"], [id, inst, name, "Refaat"]);
      }
      await db.run(`UPDATE child SET status = 'withdrawn', active = 0 WHERE id = 'c-gone'`);

      // The incident shape: account created, link step failed, invite pending.
      // The contact table carries a same-email row at BOTH centres — shared
      // addresses are how the KID-152/149 leaks happened, so the repair must
      // match on the INVITE alone and never on the contact.
      const shared = "ahmed@example.com";
      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role) VALUES ('ac-orphan', $1, 'x', 'Ahmed Refaat', 'parent')`, [shared]);
      await ins("contact", ["id", "child_id", "full_name", "relationship", "email"], ["co-home", "c-home", "Ahmed", "parent", shared]);
      await ins("contact", ["id", "child_id", "full_name", "relationship", "email"], ["co-far", "c-far", "Ahmed", "parent", shared]);
      await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-heal", "inst-home", "c-home", shared, "KID-STBQGS", "pending"]);

      // Decoys: an already-linked parent with a stale second-child invite, a
      // parent whose invite names a withdrawn child, a parent whose invite
      // disagrees with its child's institute, and a staff-linked account.
      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role) VALUES ('ac-linked', 'linked@example.com', 'x', 'Linked Parent', 'parent')`);
      await ins("family_member", ["id", "account_id", "child_id", "role"], ["fm-linked", "ac-linked", "c-home", "parent"]);
      await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-second", "inst-home", "c-far", "linked@example.com", "code-second", "pending"]);
      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role) VALUES ('ac-withdrawn', 'withdrawn@example.com', 'x', 'Withdrawn Parent', 'parent')`);
      await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-gone", "inst-home", "c-gone", "withdrawn@example.com", "code-gone", "pending"]);
      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role) VALUES ('ac-mismatch', 'mismatch@example.com', 'x', 'Mismatch Parent', 'parent')`);
      // invite institute deliberately disagrees with the child's institute.
      await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-mismatch", "inst-other", "c-home", "mismatch@example.com", "code-mismatch", "pending"]);
      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role, staff_id) VALUES ('ac-staff', 'staffer@example.com', 'x', 'Staff Parent', 'parent', 'st-fake')`);
      await ins("staff", ["id", "institute_id", "full_name", "role"], ["st-fake", "inst-home", "Staff Parent", "teacher"]);
      await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-staff", "inst-home", "c-home", "staffer@example.com", "code-staff", "pending"]);

      const links = async (accountId) =>
        (await db.all(`SELECT child_id FROM family_member WHERE account_id = $1 ORDER BY child_id`, [accountId])).map((r) => String(r.child_id));
      const inviteStatus = async (id) =>
        ((await db.all(`SELECT status FROM invite WHERE id = $1`, [id]))[0]?.status ?? null);

      await db.run(m34);
      check("the orphan is healed with exactly the invite's child", await links("ac-orphan"), ["c-home"]);
      check("the healed invite is accepted", await inviteStatus("inv-heal"), "accepted");
      check("the link carries the invite's default parent role",
        (await db.all(`SELECT role FROM family_member WHERE account_id = 'ac-orphan'`)).map((r) => String(r.role)), ["parent"]);
      check("a same-email contact at the second centre never leaks a link",
        await db.all(`SELECT child_id FROM family_member WHERE child_id = 'c-far'`), []);
      check("an already-linked parent gains no second child", await links("ac-linked"), ["c-home"]);
      check("a stale pending invite of a linked parent is not this repair's business",
        await inviteStatus("inv-second"), "pending");
      check("a withdrawn child is never linked", await links("ac-withdrawn"), []);
      check("the withdrawn child's invite stays pending", await inviteStatus("inv-gone"), "pending");
      check("an invite/institute mismatch is refused", await links("ac-mismatch"), []);
      check("the mismatched invite stays pending (not deleted)", await inviteStatus("inv-mismatch"), "pending");
      check("a staff-linked account gains no family access", await links("ac-staff"), []);

      // Idempotence: run the repair again on the healed data. Every healable
      // account now holds a link and every healed invite is accepted, so the
      // whole file must be a no-op — proven in rows, the 0020 way.
      const before = await db.all(`SELECT account_id, child_id, role FROM family_member ORDER BY id`);
      const beforeInvites = await db.all(`SELECT id, status FROM invite ORDER BY id`);
      await db.run(m34);
      const after = await db.all(`SELECT account_id, child_id, role FROM family_member ORDER BY id`);
      const afterInvites = await db.all(`SELECT id, status FROM invite ORDER BY id`);
      check("re-running the repair changes nothing", [before, beforeInvites], [after, afterInvites]);

      // The same-email contact at the foreign centre gains NO link even after
      // a replay, and no account besides the healed ones gains one.
      check("cross-tenant regression: the stranger's child stays linkless",
        await db.all(`SELECT account_id FROM family_member WHERE child_id = 'c-far'`), []);
    }

    // 0035 — KID-500 invite-activation email_confirmed repair. Accounts whose
    // activation COMPLETED through an invite (GoTrue sign-up rate-limited or
    // the app-side adoption, so no confirmation email ever went out and the
    // login-time GoTrue sync never ran) keep email_confirmed = 0 forever: the
    // admin "Resend activation" affordance and the /welcome banner contradict
    // a login that already works (the mayoda0@gmail.com report). The redeemed
    // single-use invite issued to the exact address IS the email-ownership
    // proof, so the flag moves 0 → 1 — staff mirrors, all-withdrawn parents,
    // and accounts with no accepted invite stay untouched.
    {
      const m35 = readFileSync(join(migrationsDir, "0035_kid500_invite_activation_email_confirmed.sql"), "utf8");
      console.log("\n== 0035 kid500 invite-activation email_confirmed repair ==");
      await db.run("TRUNCATE family_member, invite, contact, child, account, staff_room, staff, institute CASCADE");
      await ins("institute", ["id", "name"], ["inst-home", "Home Centre"]);
      for (const [id, name] of [
        ["c-live", "Live Kid"],
        ["c-gone", "Withdrawn Kid"],
      ]) {
        await ins("child", ["id", "institute_id", "first_name", "last_name"], [id, "inst-home", name, "Refaat"]);
      }
      await db.run(`UPDATE child SET status = 'withdrawn', active = 0 WHERE id = 'c-gone'`);

      // The incident shape: alive family link + an ACCEPTED invite to the
      // exact address, but the mirror flag still 0 (rate-limited sign-up /
      // app-side activation — no confirmation email ever went out). Case and
      // whitespace must not defeat the ownership match: issue the invite in
      // the mixed-case form staff typed, exactly like a real invite row.
      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role, email_confirmed) VALUES ('ac-stuck', 'mayoda0@gmail.com', 'x', 'Mayo Refaat', 'parent', 0)`, []);
      await ins("family_member", ["id", "account_id", "child_id", "role"], ["fm-stuck", "ac-stuck", "c-live", "parent"]);
      await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-accepted", "inst-home", "c-live", "Mayoda0@Gmail.com ", "code-stuck", "accepted"]);
      // Already-confirmed row: the repair must be a no-op here by definition.
      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role, email_confirmed) VALUES ('ac-confirmed', 'confirmed@gmail.com', 'x', 'Confirmed Parent', 'parent', 1)`, []);
      await ins("family_member", ["id", "account_id", "child_id", "role"], ["fm-confirmed", "ac-confirmed", "c-live", "parent"]);
      await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-confirmed", "inst-home", "c-live", "confirmed@gmail.com", "code-confirmed", "accepted"]);

      // Decoys that must ALL stay at 0:
      // - a staff-linked mirror (staff_id) even with an active link + accepted invite;
      // - an admin-role account (never a parent mirror);
      // - a parent whose ONLY link is a withdrawn child (genuine enrollment end);
      // - a parent with a live link but NO accepted invite (a pending one is not proof);
      // - a parent whose accepted invite was issued to a DIFFERENT address.
      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role, email_confirmed, staff_id) VALUES ('ac-staffmirror', 'staffer@gmail.com', 'x', 'Staff Mirror', 'parent', 0, 'st-fake')`, []);
      await ins("staff", ["id", "institute_id", "full_name", "role"], ["st-fake", "inst-home", "Staff Mirror", "teacher"]);
      await ins("family_member", ["id", "account_id", "child_id", "role"], ["fm-staffmirror", "ac-staffmirror", "c-live", "parent"]);
      await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-staffmirror", "inst-home", "c-live", "staffer@gmail.com", "code-staffmirror", "accepted"]);
      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role, email_confirmed) VALUES ('ac-admin', 'adm@gmail.com', 'x', 'Admin Mirror', 'admin', 0)`, []);
      await ins("family_member", ["id", "account_id", "child_id", "role"], ["fm-admin", "ac-admin", "c-live", "parent"]);
      await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-admin", "inst-home", "c-live", "adm@gmail.com", "code-admin", "accepted"]);
      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role, email_confirmed) VALUES ('ac-goneonly', 'goneonly@gmail.com', 'x', 'Gone Only', 'parent', 0)`, []);
      await ins("family_member", ["id", "account_id", "child_id", "role"], ["fm-goneonly", "ac-goneonly", "c-gone", "parent"]);
      await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-goneonly", "inst-home", "c-gone", "goneonly@gmail.com", "code-goneonly", "accepted"]);
      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role, email_confirmed) VALUES ('ac-noinvite', 'noinvite@gmail.com', 'x', 'No Invite', 'parent', 0)`, []);
      await ins("family_member", ["id", "account_id", "child_id", "role"], ["fm-noinvite", "ac-noinvite", "c-live", "parent"]);
      await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-noinvite", "inst-home", "c-live", "noinvite@gmail.com", "code-noinvite", "pending"]);
      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role, email_confirmed) VALUES ('ac-otheraddr', 'mine@gmail.com', 'x', 'Other Address', 'parent', 0)`, []);
      await ins("family_member", ["id", "account_id", "child_id", "role"], ["fm-otheraddr", "ac-otheraddr", "c-live", "parent"]);
      await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-otheraddr", "inst-home", "c-live", "someone-else@gmail.com", "code-otheraddr", "accepted"]);

      const flag = async (id) => Number((await db.all(`SELECT email_confirmed FROM account WHERE id = $1`, [id]))[0].email_confirmed);

      await db.run(m35);
      check("the rate-limited/app-side activated parent is confirmed (case-insensitive invite match)", await flag("ac-stuck"), 1);
      check("an already-confirmed row stays confirmed", await flag("ac-confirmed"), 1);
      check("a staff-linked account is never confirmed by the repair", await flag("ac-staffmirror"), 0);
      check("a non-parent account is never confirmed by the repair", await flag("ac-admin"), 0);
      check("an all-withdrawn parent stays unconfirmed", await flag("ac-goneonly"), 0);
      check("a live-linked parent with NO accepted invite stays unconfirmed", await flag("ac-noinvite"), 0);
      check("an accepted invite for a DIFFERENT address proves nothing", await flag("ac-otheraddr"), 0);

      // Idempotence: replay the repair, then prove a fresh incident-shaped
      // row is picked up on the next pass — production keeps running with
      // the old mirror attached, so this must stay healable.
      await db.run(m35);
      check("re-running the repair changes nothing", await flag("ac-stuck"), 1);
      check("replay keeps the decoys untouched", [
        await flag("ac-staffmirror"),
        await flag("ac-admin"),
        await flag("ac-goneonly"),
        await flag("ac-noinvite"),
        await flag("ac-otheraddr"),
      ], [0, 0, 0, 0, 0]);

      await db.all(`INSERT INTO account (id, email, password_hash, full_name, role, email_confirmed) VALUES ('ac-late', 'late@gmail.com', 'x', 'Late Arrivals', 'parent', 0)`, []);
      await ins("family_member", ["id", "account_id", "child_id", "role"], ["fm-late", "ac-late", "c-live", "parent"]);
      await ins("invite", ["id", "institute_id", "child_id", "email", "code", "status"], ["inv-late", "inst-home", "c-live", "late@gmail.com", "code-late", "accepted"]);
      await db.run(m35);
      check("a late unconfirmed activated parent is healed on the next pass", await flag("ac-late"), 1);

      // The invites that made the repairs possible stay exactly as they were.
      const inviteStatuses = (await db.all(`SELECT id, status FROM invite ORDER BY id`))
        .map((r) => [String(r.id), String(r.status)]);
      check("no invite row was touched", [
        ...inviteStatuses,
      ].sort((a, b) => a[0].localeCompare(b[0])), [
        ["inv-accepted", "accepted"],
        ["inv-admin", "accepted"],
        ["inv-confirmed", "accepted"],
        ["inv-goneonly", "accepted"],
        ["inv-late", "accepted"],
        ["inv-noinvite", "pending"],
        ["inv-otheraddr", "accepted"],
        ["inv-staffmirror", "accepted"],
      ]);
    }

    // ---------------------------------------------------------------------
    // 0036 — KID-486: parent check-in/out toggle + same-day planned pickup
    // time. The toggle defaults ON for legacy institutes (parents are never
    // silently locked out of check-in by a deploy), and the pickup_time table
    // enforces one entry per child per day structurally (a second same-day
    // write must fail inside Postgres, not just in lib/store) plus a HH:MM
    // shape guard, because a malformed layout-corrupted write would render
    // on the attendance surfaces.
    {
      const m36 = readFileSync(join(migrationsDir, "0036_kid486_parent_checkin_pickup_time.sql"), "utf8");
      console.log("\n== 0036 kid486 parent check-in toggle + pickup_time ==");
      await db.run("TRUNCATE family_member, invite, contact, child, account, staff_room, staff, room, institute CASCADE");
      await db.run(`INSERT INTO institute (id, name, created_at) VALUES ('inst-legacy', 'Legacy Centre', now())`);
      await db.run(`INSERT INTO institute (id, name, created_at) VALUES ('inst-fresh', 'Fresh Centre', now())`);
      await db.run(`INSERT INTO account (id, email, password_hash, full_name, role) VALUES ('ac-serif', 'serif@gmail.com', 'x', 'Serif', 'parent')`);
      await db.run(`INSERT INTO child (id, institute_id, first_name, last_name) VALUES ('c-serif', 'inst-legacy', 'Serif', 'Kid')`);

      await db.run(m36);
      check("legacy institutes default the parent check-in toggle ON",
        (await db.all(`SELECT parent_checkin_enabled FROM institute WHERE id = 'inst-legacy'`)).map((r) => Number(r.parent_checkin_enabled)), [1]);
      check("fresh institutes get no override row (empty table assertion flies)",
        (await db.all(`SELECT id FROM pickup_time WHERE institute_id = 'inst-fresh'`)), []);

      await db.all(`INSERT INTO pickup_time (id, institute_id, child_id, account_id, pickup_date, pickup_time) VALUES ('pt-1', 'inst-legacy', 'c-serif', 'ac-serif', '2026-01-05', '15:30')`);
      const rowsFor = async (date) => (await db.all(`SELECT id FROM pickup_time WHERE child_id = 'c-serif' AND pickup_date = $1`, [date])).map((r) => String(r.id));
      // A refused duplicate must not poison the surrounding transaction, so
      // the write runs inside a savepoint (same pattern as the subdomain
      // check below).
      let dupeRefused = false;
      await db.run("SAVEPOINT pt_dupe");
      try {
        await db.all(`INSERT INTO pickup_time (id, institute_id, child_id, account_id, pickup_date, pickup_time) VALUES ('pt-2', 'inst-legacy', 'c-serif', 'ac-serif', '2026-01-05', '16:00')`);
      } catch {
        dupeRefused = true;
      }
      await db.run("ROLLBACK TO SAVEPOINT pt_dupe");
      check("one pickup entry per child per day (unique pair refused the write)", dupeRefused && (await rowsFor("2026-01-05")) , ["pt-1"]);
      // A different day is a different entry — the rule is per-day, not total.
      await db.all(`INSERT INTO pickup_time (id, institute_id, child_id, account_id, pickup_date, pickup_time) VALUES ('pt-3', 'inst-legacy', 'c-serif', 'ac-serif', '2026-01-06', '15:30')`);
      check("the next day schedules freely", rowsFor("2026-01-06"), ["pt-3"]);

      const malformed = async () => {
        await db.run("SAVEPOINT pt_bad");
        try {
          await db.all(`INSERT INTO pickup_time (id, institute_id, child_id, account_id, pickup_date, pickup_time) VALUES ('pt-bad', 'inst-legacy', 'c-serif', 'ac-serif', '2026-01-07', '25:99')`);
          await db.run("RELEASE SAVEPOINT pt_bad");
          return false;
        } catch {
          await db.run("ROLLBACK TO SAVEPOINT pt_bad");
          return true;
        }
      };
      check("malformed times never land (HH:MM shape guard)", await malformed(), true);

      // Idempotence: re-running the migration keeps the data and the default.
      await db.run(m36);
      check("replay is a no-op on data",
        (await db.all(`SELECT COUNT(*) AS c FROM pickup_time`)).map((r) => Number(r.c)), [2]);
      check("replay keeps the toggle default ON", (await db.all(`SELECT parent_checkin_enabled FROM institute WHERE id = 'inst-legacy'`)).map((r) => Number(r.parent_checkin_enabled)), [1]);
      const toggled = await db.all(`UPDATE institute SET parent_checkin_enabled = 0 WHERE id = 'inst-legacy' RETURNING parent_checkin_enabled`);
      check("an admin can turn the toggle OFF", toggled.map((r) => Number(r.parent_checkin_enabled)), [0]);
      check("cascade clean: children deleted => entries deleted",
        (await db.all(`DELETE FROM child WHERE id = 'c-serif' RETURNING id`)).length === 1
          && (await db.all(`SELECT COUNT(*) AS c FROM pickup_time`)).map((r) => Number(r.c)), [0]);
    }

    // ---------------------------------------------------------------------
    // 0024 — one daycare per wildcard subdomain. The column plus its partial
    // unique index are the SQL-level enforcement behind lib/subdomain.ts; a
    // unique index that did not exist would let two daycares silently share
    // (and therefore both serve on) one hostname.
    console.log("\n== 0024 institute subdomain ==");
    await db.run("TRUNCATE family_member, invite, contact, child, account, staff_room, staff, room, institute CASCADE");
    await ins("institute", ["id", "name"], ["inst-sun", "Sunshine Daycare"]);
    await ins("institute", ["id", "name"], ["inst-maple", "Maple Tree Daycare"]);
    await db.run(`UPDATE institute SET subdomain = 'sunshine' WHERE id = 'inst-sun'`);
    await db.run(`UPDATE institute SET subdomain = 'mapletree' WHERE id = 'inst-maple'`);
    check("both daycares keep their own subdomain", (await db.all(`SELECT id FROM institute WHERE subdomain = 'sunshine'`)).map((r) => String(r.id)), ["inst-sun"]);
    // A second daycare claiming a taken subdomain must be refused loudly.
    // Like the 0018 guard above: the abort would poison the transaction, so
    // run it inside a savepoint.
    await db.run("SAVEPOINT subdomain_check");
    let dupRaised = false;
    try {
      await db.run(`UPDATE institute SET subdomain = 'sunshine' WHERE id = 'inst-maple'`);
    } catch (err) {
      dupRaised = true;
    }
    await db.run("ROLLBACK TO SAVEPOINT subdomain_check");
    check("two daycares cannot claim one subdomain", dupRaised, true);
    // Several daycares with no subdomain yet is the normal legacy state — the
    // partial index must not make NULLs collide.
    await db.run(`UPDATE institute SET subdomain = NULL`);
    const nullCount = Number((await db.all("SELECT COUNT(*) AS c FROM institute"))[0].c);
    check("NULL subdomains coexist (pre-backfill legacy rows)", nullCount, 2);
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
