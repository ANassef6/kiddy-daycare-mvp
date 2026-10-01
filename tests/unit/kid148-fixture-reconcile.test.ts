// KID-148: the QA fixture's reconcile semantics, pinned before the browser pass.
//
// The production QA fixture built on KID-151 is two children at one centre
// sharing one parent address, with the sibling `family_member` link deleted so
// the pass would exercise the real reconcile path. On 2026-09-30T00:57:13Z
// migration 0019 applied on production and its step 2 re-asserted that link, so
// the fixture reconciled without a human step and the primary criterion ("the
// parent sees all siblings") became passable on seeded data.
//
// This file pins what the pass can and cannot conclude from each state, so the
// browser run is not a green check on data the migration wrote:
//
//   1. the repair body re-asserts a deleted in-institute link (why C1 went
//      vacuous, and why a reset has to be followed by a deliberate action),
//   2. with the link missing, familiesForAccount — what /child renders — shows
//      exactly one child. That is the observable precondition the pass needs,
//      and it is the negative control for every "both children" observation,
//   3. the staff contact path is the writer that restores the link, which is the
//      only non-vacuous way to make the criterion pass,
//   4. reconciling twice does not duplicate the link (criterion C2),
//   5. the shipped cross-tenant measurement stays empty on the fixture, so a
//      pass that widens access is caught by the same function the deploy gate
//      used rather than by a hand-written count,
//   6. the local mirror re-runs the repair on every ensureSchema() call, which
//      production does not. Read this before writing a test that "proves"
//      production behaviour through ensureSchema().

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { createAccount } from "@/lib/auth";
import { ensureSchema, queryAll, queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let iid: string;
let roomA: string;

const PARENT_EMAIL = "qa.kid147.parent@example.test";

/** The KID-151 production fixture, rebuilt deterministically. */
interface Fixture {
  accountId: string;
  /** The child the account already holds a link to. */
  linkedChildId: string;
  /** The sibling whose link the fixture deletes. */
  siblingChildId: string;
  siblingContactId: string;
}

async function buildPreFixFixture(): Promise<Fixture> {
  // Arrange: two children at the one institute, both in the same classroom, the
  // same parent address typed on both contacts, and a parent account holding
  // exactly one link. This is the shape the board reported: the parent sees one
  // child where two share the address.
  const kian = await store.createChild({ instituteId: iid, firstName: "Kian", lastName: "QA", roomId: roomA });
  const lina = await store.createChild({ instituteId: iid, firstName: "Lina", lastName: "QA", roomId: roomA });
  await store.addContact({
    childId: String(kian.id),
    fullName: "QA Parent",
    relationship: "parent",
    email: PARENT_EMAIL,
    isPickup: false,
    isEmergency: false
  });
  const linaContact = await store.addContact({
    childId: String(lina.id),
    fullName: "QA Parent",
    relationship: "parent",
    email: PARENT_EMAIL,
    isPickup: false,
    isEmergency: false
  });
  const parent = await createAccount({
    email: PARENT_EMAIL,
    password: "not-a-real-password",
    fullName: "QA Parent",
    role: "parent"
  });
  await store.linkFamily(String(parent.id), String(kian.id), "parent");

  // The reset KID-151 recorded: drop the sibling link and leave both contact
  // rows in place.
  await queryRun("DELETE FROM family_member WHERE account_id = ? AND child_id = ?", String(parent.id), String(lina.id));

  return {
    accountId: String(parent.id),
    linkedChildId: String(kian.id),
    siblingChildId: String(lina.id),
    siblingContactId: String(linaContact.id)
  };
}

/** What /child renders for this account: the children it can see. */
async function visibleChildNames(accountId: string): Promise<string[]> {
  const rows = await store.familiesForAccount(accountId);
  return rows.map((r) => `${String(r.first_name)} ${String(r.last_name)}`).sort();
}

async function linkRows(accountId: string): Promise<{ child_id: string; role: string }[]> {
  const rows = await queryAll("SELECT child_id, role FROM family_member WHERE account_id = ? ORDER BY child_id", accountId);
  return rows.map((r) => ({ child_id: String(r.child_id), role: String(r.role) }));
}

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
});

describe("KID-148 QA fixture reconcile semantics", () => {
  it("re-asserts a deleted in-institute sibling link when the repair body runs", async () => {
    // Arrange: the fixture in its reset state.
    const fx = await buildPreFixFixture();
    expect(await linkRows(fx.accountId)).toEqual([{ child_id: fx.linkedChildId, role: "parent" }]);

    // Act: the repair body, which is what ran on production at 00:57:13Z when
    // 0019 was applied with step 2 (the corrected backfill) in it.
    await ensureSchema();

    // Assert: the link is back. This is the mechanism that made the KID-151
    // fixture reconcile with no human step, and the reason a "parent sees both
    // children" observation taken after that moment proves nothing on its own.
    expect(await linkRows(fx.accountId)).toEqual([
      { child_id: fx.linkedChildId, role: "parent" },
      { child_id: fx.siblingChildId, role: "parent" }
    ]);
  });

  it("shows exactly one child while the sibling link is missing", async () => {
    // Arrange: the fixture in its reset state, with nothing run to heal it.
    const fx = await buildPreFixFixture();

    // Act: the read /child performs, and no reconcile action.
    const visible = await visibleChildNames(fx.accountId);

    // Assert: the pre-fix state is observable, so a later "both children" result
    // can only come from something the pass did. If this ever returns two, the
    // fixture is already healed and the pass has no precondition to violate.
    expect(visible).toEqual(["Kian QA"]);
    expect(await linkRows(fx.accountId)).toEqual([{ child_id: fx.linkedChildId, role: "parent" }]);
  });

  it("restores the sibling link through the staff contact path, and only there", async () => {
    // Arrange: the reset state, which on production is stable because 0019 is in
    // the ledger and ensureSchema() skips ledgered files. The account is on file
    // at the centre by the link it still holds, which is the only tenancy
    // evidence it has — there is no invite row, so this also covers the
    // "enrolled before the invite flow" account the gate is told to leave alone.
    const fx = await buildPreFixFixture();
    // Assert the precondition before acting, so this test cannot pass on a
    // fixture that was already healed by something else.
    expect(await visibleChildNames(fx.accountId)).toEqual(["Kian QA"]);
    expect(await store.instituteIdsForAccount(fx.accountId)).toEqual([iid]);

    // Act: a staff member re-saving the sibling's contact — the ordinary action
    // that fires autoLinkSiblingsForContact. Not reachable from a parent session.
    await store.addContact({
      childId: fx.siblingChildId,
      fullName: "QA Parent",
      relationship: "parent",
      email: PARENT_EMAIL,
      isPickup: false,
      isEmergency: false
    });

    // Assert: both children, no duplicates, and the gate still reads clean.
    expect(await visibleChildNames(fx.accountId)).toEqual(["Kian QA", "Lina QA"]);
    expect(await linkRows(fx.accountId)).toEqual([
      { child_id: fx.linkedChildId, role: "parent" },
      { child_id: fx.siblingChildId, role: "parent" }
    ]);
    expect(await store.crossInstituteFamilyMemberRows()).toEqual([]);
  });

  it("does not duplicate the sibling link when the contact is saved again", async () => {
    // Arrange: reconciled once.
    const fx = await buildPreFixFixture();
    expect(await visibleChildNames(fx.accountId)).toEqual(["Kian QA"]);
    await store.addContact({
      childId: fx.siblingChildId,
      fullName: "QA Parent",
      relationship: "parent",
      email: PARENT_EMAIL,
      isPickup: false,
      isEmergency: false
    });

    // Act: staff re-save the same contact twice more. 0017's unique index is
    // what has to hold, because linkFamily() is an upsert and addContact fires
    // the auto-link on every write.
    for (let i = 0; i < 2; i += 1) {
      await store.addContact({
        childId: fx.siblingChildId,
        fullName: "QA Parent",
        relationship: "parent",
        email: PARENT_EMAIL,
        isPickup: false,
        isEmergency: false
      });
    }

    // Assert: criterion C2. Two rows, two cards — the duplicate fan-out that
    // 0017 was written for.
    expect(await linkRows(fx.accountId)).toHaveLength(2);
    expect(await visibleChildNames(fx.accountId)).toEqual(["Kian QA", "Lina QA"]);
  });

  it("ignores a sibling contact with no usable email, leaving the parent at one child", async () => {
    // Arrange: the reset state.
    const fx = await buildPreFixFixture();

    // Act: every shape an importer or a staff form can hand the reconcile path.
    for (const value of [null, "", "   "]) {
      await store.addContact({
        childId: fx.siblingChildId,
        fullName: "QA Parent",
        relationship: "parent",
        email: value as string,
        isPickup: false,
        isEmergency: false
      });
    }

    // Assert: no invented link. A blank address is not evidence of anything, so
    // the pass must not be able to manufacture the sibling out of one.
    expect(await linkRows(fx.accountId)).toEqual([{ child_id: fx.linkedChildId, role: "parent" }]);
    expect(await visibleChildNames(fx.accountId)).toEqual(["Kian QA"]);

    // And the same address with different case still reconciles — staff type the
    // same mailbox differently and the parent must not stay locked out.
    await store.addContact({
      childId: fx.siblingChildId,
      fullName: "QA Parent",
      relationship: "parent",
      email: PARENT_EMAIL.toUpperCase(),
      isPickup: false,
      isEmergency: false
    });
    expect(await visibleChildNames(fx.accountId)).toEqual(["Kian QA", "Lina QA"]);
  });

  it("fidelity: the local mirror re-runs the repair on every ensureSchema(), which production does not", async () => {
    // Arrange: the fixture healed once.
    const fx = await buildPreFixFixture();
    await ensureSchema();
    expect(await linkRows(fx.accountId)).toHaveLength(2);

    // Act: the KID-151 reset, then a page load.
    await queryRun("DELETE FROM family_member WHERE account_id = ? AND child_id = ?", fx.accountId, fx.siblingChildId);
    expect(await linkRows(fx.accountId)).toHaveLength(1);
    await ensureSchema();

    // Assert: the link returns. On SQLite that is expected, and it is the reason
    // no local test may use ensureSchema() to reason about production after
    // 0019 is in the ledger: ensurePgSchema() skips every file in
    // schema_migrations (lib/db.ts), so on production this second call writes
    // nothing and the reset stays reset. A test written the other way round
    // would go green locally and prove nothing about the deployed system.
    expect(await linkRows(fx.accountId)).toHaveLength(2);
  });
});
