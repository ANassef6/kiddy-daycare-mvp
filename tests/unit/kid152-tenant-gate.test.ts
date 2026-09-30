// KID-152: the runtime tenant gate on sibling auto-link.
//
// kid149-backfill-isolation.test.ts pins the migration and the single
// cross-institute repro. This file covers the gate's *boundaries* — the cases
// where a stricter gate either over-tightens (a real parent loses legitimate
// access, which is the same user-visible bug as the leak) or under-tightens.
// The gate is only correct if both directions are tested.
//
// The gate: lib/store.ts instituteIdsForAccount() derives an account's
// institutes from invite rows addressed to its email plus family_member links it
// already holds. linkSiblingsByParentEmail() refuses when the contact's
// institute is not in that set.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { createAccount } from "@/lib/auth";
import { queryAll, queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";

let iid: string;
let roomA: string;
let roomB: string;

/** A second centre with one room, i.e. a foreign tenant. */
async function foreignInstitute(): Promise<{ instituteId: string; roomId: string }> {
  const other = await store.seedInstitute({ name: "Other Center" });
  const room = await store.createRoom(other.id as string, "Other Room", 10);
  return { instituteId: String(other.id), roomId: String(room.id) };
}

async function contactFor(childId: string, fullName: string, email: string | null): Promise<void> {
  await store.addContact({
    childId,
    fullName,
    relationship: "parent",
    email: email as string,
    isPickup: false,
    isEmergency: false
  });
}

async function linksFor(accountId: string): Promise<string[]> {
  const rows = await queryAll(
    "SELECT child_id FROM family_member WHERE account_id = ? ORDER BY child_id",
    accountId
  );
  return rows.map((r) => String(r.child_id));
}

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  roomB = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool'"))!.id);
});

describe("KID-152 sibling auto-link tenant gate", () => {
  it("still links a parent's first child from an invite alone (no family_member row yet)", async () => {
    // Arrange: the daycare invited this address at Sunshine, the parent
    // registered, but no link row exists yet. This is the bootstrap case for
    // every real parent. If the gate required an existing family_member row the
    // gate would be circular and KID-142 would be dead on arrival.
    const email = "bootstrap@example.test";
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    await store.createInvite(iid, String(childA.id), email, "SUNSHINE-A1", "parent");
    await contactFor(String(childA.id), "Nouran Hisham", email);
    await contactFor(String(childB.id), "Nouran Hisham", email);
    const parent = await createAccount({ email, password: "x", fullName: "Nouran Hisham", role: "parent" });
    expect(await linksFor(String(parent.id))).toEqual([]);

    // Act: staff record a second child at the same centre under that address.
    const childC = await store.createChild({ instituteId: iid, firstName: "Sara", lastName: "Nassef", roomId: roomA });
    await contactFor(String(childC.id), "Nouran Hisham", email);

    // Assert: the invite alone is enough. All three same-centre children link.
    expect((await linksFor(String(parent.id))).sort()).toEqual(
      [String(childA.id), String(childB.id), String(childC.id)].sort()
    );
  });

  it("still links a genuinely multi-centre parent at every centre it is on file at", async () => {
    // Arrange: this parent is on file at BOTH centres — two invites, same
    // address. The docstring in lib/store.ts promises "a genuinely multi-centre
    // account is still linked at each centre it is on file at". Over-tightening
    // here is the silent regression the leak fix risks.
    const foreign = await foreignInstitute();
    const email = "multi-centre@example.test";
    const childAtA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    await store.createInvite(iid, String(childAtA.id), email, "SUNSHINE-B1", "parent");
    await contactFor(String(childAtA.id), "Nouran Hisham", email);
    const childAtB = await store.createChild({ instituteId: foreign.instituteId, firstName: "Mikael", lastName: "Nassef", roomId: foreign.roomId });
    await store.createInvite(foreign.instituteId, String(childAtB.id), email, "OTHER-B1", "parent");
    await contactFor(String(childAtB.id), "Nouran Hisham", email);
    const parent = await createAccount({ email, password: "x", fullName: "Nouran Hisham", role: "parent" });

    // Act: a new child at the second centre under that address. The auto-link
    // is scoped to the contact's own institute, so this pass covers that centre.
    const childAtB2 = await store.createChild({ instituteId: foreign.instituteId, firstName: "Sara", lastName: "Nassef", roomId: foreign.roomId });
    await contactFor(String(childAtB2.id), "Nouran Hisham", email);
    expect((await linksFor(String(parent.id))).sort()).toEqual(
      [String(childAtB.id), String(childAtB2.id)].sort()
    );

    // Act: and a new child at the first centre, which must link too. An
    // over-tightened gate refuses here and strands the parent at one site.
    const childAtA2 = await store.createChild({ instituteId: iid, firstName: "Sara", lastName: "Nassef", roomId: roomA });
    await contactFor(String(childAtA2.id), "Nouran Hisham", email);

    // Assert: linked at both centres, because the daycare onboarded them at both.
    expect((await linksFor(String(parent.id))).sort()).toEqual(
      [String(childAtA.id), String(childAtA2.id), String(childAtB.id), String(childAtB2.id)].sort()
    );
    expect((await store.instituteIdsForAccount(String(parent.id))).sort()).toEqual(
      [iid, foreign.instituteId].sort()
    );
    expect(await store.crossInstituteFamilyMemberRows()).toEqual([]);
  });

  it("grants nothing to a parent the daycare never onboarded (no invite, no link)", async () => {
    // Arrange: an account row exists for this address — self-registered or
    // imported — but no centre has ever issued an invite to it and it holds no
    // family link. It belongs to no centre, so a contact carrying its address
    // must not hand it a child.
    const email = "not-onboarded@example.test";
    const child = await store.createChild({ instituteId: iid, firstName: "Private", lastName: "Child", roomId: roomA });
    const parent = await createAccount({ email, password: "x", fullName: "Imported Parent", role: "parent" });

    // Act
    await contactFor(String(child.id), "Imported Parent", email);

    // Assert: no access. This is the documented zero-link edge case, and the
    // remedy is the daycare issuing the invite — not a guess from the address.
    expect(await linksFor(String(parent.id))).toEqual([]);
    expect(await store.instituteIdsForAccount(String(parent.id))).toEqual([]);
    expect((await store.familiesForAccount(String(parent.id))).length).toBe(0);
  });

  it("refuses a second centre's child but keeps the same-centre sibling the account already owns", async () => {
    // Arrange: parent is on file at Sunshine (invite) and linked to childA.
    const foreign = await foreignInstitute();
    const email = "boundary@example.test";
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    await store.createInvite(iid, String(childA.id), email, "SUNSHINE-C1", "parent");
    await contactFor(String(childA.id), "Nouran Hisham", email);
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    await contactFor(String(childB.id), "Nouran Hisham", email);
    const parent = await createAccount({ email, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(String(parent.id), String(childA.id), "parent");
    const foreignChild = await store.createChild({ instituteId: foreign.instituteId, firstName: "Foreign", lastName: "Child", roomId: foreign.roomId });

    // Act: one contact at the foreign centre only. The owned centre gets no new
    // contact, so the same-centre sibling is not touched either way — the gate
    // must not have widened or narrowed the account's existing access.
    await contactFor(String(foreignChild.id), "Nouran Hisham", email);

    // Assert: exactly the owned child, nothing from the other centre.
    expect(await linksFor(String(parent.id))).toEqual([String(childA.id)]);
    expect(await store.instituteIdsForAccount(String(parent.id))).toEqual([iid]);
  });

  it("does not report a refused account as linked", async () => {
    // Arrange: a parent on file at Sunshine. account.email is UNIQUE, so the
    // account-by-email lookup returns exactly one candidate, and it is not on
    // file at the centre whose contact is being written.
    const foreign = await foreignInstitute();
    const email = "refused@example.test";
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    await store.createInvite(iid, String(childA.id), email, "SUNSHINE-D1", "parent");
    await contactFor(String(childA.id), "Nouran Hisham", email);
    const parent = await createAccount({ email, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(String(parent.id), String(childA.id), "parent");
    const foreignChild = await store.createChild({ instituteId: foreign.instituteId, firstName: "Foreign", lastName: "Child", roomId: foreign.roomId });

    // Act
    const result = await store.autoLinkSiblingsForContact({
      childId: String(foreignChild.id),
      email
    });

    // Assert: nothing granted, and nothing reported. A refused account must not
    // appear in linkedAccountIds, or a caller's "parent was linked" log lies.
    expect(result).toEqual({ linkedAccountIds: [], linkedChildIds: [] });
    expect(await linksFor(String(parent.id))).toEqual([String(childA.id)]);
  });

  it("reports the account it did link, with the children it gained", async () => {
    // Arrange: same shape as above, but the contact is at the centre the
    // account is on file at. The gate must pass and the report must be honest.
    // The candidate set is built from contact rows, so both children need a
    // contact carrying the address before the call — the account is created
    // after them so the addContact triggers cannot pre-empt the assertion.
    const email = "reported@example.test";
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    await store.createInvite(iid, String(childA.id), email, "SUNSHINE-D2", "parent");
    await contactFor(String(childA.id), "Nouran Hisham", email);
    await contactFor(String(childB.id), "Nouran Hisham", email);
    const parent = await createAccount({ email, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(String(parent.id), String(childA.id), "parent");
    expect(await linksFor(String(parent.id))).toEqual([String(childA.id)]);

    // Act
    const result = await store.autoLinkSiblingsForContact({
      childId: String(childB.id),
      email
    });

    // Assert: the account is reported, and every same-email child at the centre
    // it is on file at is named — including the one it was already linked to.
    expect(result.linkedAccountIds).toEqual([String(parent.id)]);
    expect([...result.linkedChildIds].sort()).toEqual([String(childA.id), String(childB.id)].sort());
    expect((await linksFor(String(parent.id))).sort()).toEqual(
      [String(childA.id), String(childB.id)].sort()
    );
  });

  it("crossInstituteFamilyMemberRows() flags a family_member row that is its own only justification", async () => {
    // This is the QA-facing measurement the deploy gate reads to decide on a
    // repair migration. Its owned-institute set must exclude the row under
    // test: a leaked row IS a family_member row, so a self-referential check
    // would let a leak justify itself and read 0 on a database that is leaking.
    const foreign = await foreignInstitute();
    const email = "self-justifying@example.test";
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    await store.createInvite(iid, String(childA.id), email, "SUNSHINE-H1", "parent");
    await contactFor(String(childA.id), "Nouran Hisham", email);
    const parent = await createAccount({ email, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(String(parent.id), String(childA.id), "parent");
    const foreignChild = await store.createChild({ instituteId: foreign.instituteId, firstName: "Foreign", lastName: "Child", roomId: foreign.roomId });

    // Arrange: the state shipped to production — a link at a centre the account
    // has no invite for. Nothing else places the account at that centre.
    await store.linkFamily(String(parent.id), String(foreignChild.id), "parent");
    expect(await store.instituteIdsForAccount(String(parent.id))).toContain(foreign.instituteId);

    // Act
    const leaked = await store.crossInstituteFamilyMemberRows();

    // Assert: the row is named, with enough context to repair it. The Sunshine
    // row is not reported — the invite justifies it.
    expect(leaked).toHaveLength(1);
    expect(leaked[0]).toMatchObject({
      account_id: String(parent.id),
      child_id: String(foreignChild.id),
      institute_id: foreign.instituteId,
      email,
      has_other_justification: true
    });
  });

  it("crossInstituteFamilyMemberRows() marks a lone link with no other justification rather than hiding it", async () => {
    // A parent enrolled before the invite flow existed: one child, no invite, no
    // other link. That row is legitimate and must survive a repair DELETE, but
    // the gate still has to see it and decide — a measurement that quietly
    // excludes rows cannot tell the gate how many candidates it has.
    const email = "legacy-parent@example.test";
    const child = await store.createChild({ instituteId: iid, firstName: "Legacy", lastName: "Child", roomId: roomA });
    const parent = await createAccount({ email, password: "x", fullName: "Legacy Parent", role: "parent" });
    await store.linkFamily(String(parent.id), String(child.id), "parent");

    // Act
    const rows = await store.crossInstituteFamilyMemberRows();

    // Assert: visible, and explicitly marked as having nothing else to justify it.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      account_id: String(parent.id),
      child_id: String(child.id),
      institute_id: iid,
      email,
      has_other_justification: false
    });
  });

  it("crossInstituteFamilyMemberRows() is empty when the boundary holds", async () => {
    // The negative control. Without it, a function that always returned [] would
    // satisfy the two tests above by reporting nothing at all.
    const foreign = await foreignInstitute();
    const email = "clean@example.test";
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    await store.createInvite(iid, String(childA.id), email, "SUNSHINE-I1", "parent");
    await contactFor(String(childA.id), "Nouran Hisham", email);
    await contactFor(String(childB.id), "Nouran Hisham", email);
    const parent = await createAccount({ email, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(String(parent.id), String(childA.id), "parent");
    const foreignChild = await store.createChild({ instituteId: foreign.instituteId, firstName: "Foreign", lastName: "Child", roomId: foreign.roomId });

    // Act: a contact at the foreign centre, which the gate refuses.
    await contactFor(String(foreignChild.id), "Nouran Hisham", email);

    // Assert
    expect(await store.crossInstituteFamilyMemberRows()).toEqual([]);
    expect(await linksFor(String(parent.id))).toEqual([String(childA.id)]);
  });

  it("treats null, undefined, empty and whitespace-only contact email as no-op, never a throw", async () => {
    // Arrange
    const child = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const email = "edge@example.test";
    await store.createInvite(iid, String(child.id), email, "SUNSHINE-F1", "parent");
    const parent = await createAccount({ email, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(String(parent.id), String(child.id), "parent");

    // Act: every shape a staff form or an importer can hand the auto-link path.
    const results = [];
    for (const value of [null, undefined, "", "   ", "\t\n"]) {
      results.push(await store.autoLinkSiblingsForContact({ childId: String(child.id), email: value as string | null }));
    }

    // Assert: no throw, no invented links, and no cross-tenant widening.
    for (const r of results) {
      expect(r).toEqual({ linkedAccountIds: [], linkedChildIds: [] });
    }
    expect(await linksFor(String(parent.id))).toEqual([String(child.id)]);
    expect(await store.instituteIdsForAccount(String(parent.id))).toEqual([iid]);
  });

  it("does not widen access when the contact's own child sits at an unowned institute and instituteId is omitted", async () => {
    // Arrange: instituteId is optional on autoLinkSiblingsForContact and is
    // resolved from the contact's own child. That resolution is exactly what
    // made the old check trivial, so the omitted-instituteId path must still be
    // gated by the account's own institute set, not by the child's.
    const foreign = await foreignInstitute();
    const email = "derived-institute@example.test";
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    await store.createInvite(iid, String(childA.id), email, "SUNSHINE-G1", "parent");
    await contactFor(String(childA.id), "Nouran Hisham", email);
    const parent = await createAccount({ email, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(String(parent.id), String(childA.id), "parent");
    const foreignChild = await store.createChild({ instituteId: foreign.instituteId, firstName: "Foreign", lastName: "Child", roomId: foreign.roomId });

    // Act: no instituteId passed, so it is derived from the foreign child.
    const result = await store.autoLinkSiblingsForContact({
      childId: String(foreignChild.id),
      email
    });

    // Assert
    expect(result.linkedChildIds).toEqual([]);
    expect(await linksFor(String(parent.id))).toEqual([String(childA.id)]);
  });
});
