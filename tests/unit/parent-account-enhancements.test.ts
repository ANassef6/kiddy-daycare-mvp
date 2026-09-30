// KID-140 parent-account enhancements: sibling auto-link, same-email profile
// backfill, and classroom-staff messaging scoping.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { createAccount } from "@/lib/auth";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let iid: string;
let roomA: string;
let roomB: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  roomB = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool'"))!.id);
});

describe("KID-142 sibling auto-link by parent email", () => {
  it("links every child whose contact shares the parent's email", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const sharedEmail = "nouran@example.com";
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    await store.addContact({ childId: String(childB.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });

    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(parent.id as string, String(childA.id), "parent");

    const result = await store.linkSiblingsByParentEmail(parent.id as string, sharedEmail, iid, String(childA.id));

    expect(result.linkedChildIds.sort()).toEqual([String(childB.id)]);
    const family = await store.familiesForAccount(parent.id as string);
    const linkedIds = family.map((c) => String(c.id)).sort();
    expect(linkedIds).toContain(String(childA.id));
    expect(linkedIds).toContain(String(childB.id));
  });

  it("ignores contacts that belong to other institutes", async () => {
    const otherInstitute = await store.seedInstitute({ name: "Other Center" });
    const otherRoom = await store.createRoom(otherInstitute.id as string, "Other Room", 10);
    const otherChild = await store.createChild({ instituteId: otherInstitute.id as string, firstName: "Other", lastName: "Kid", roomId: otherRoom.id as string });
    const sharedEmail = "shared@example.com";
    await store.addContact({ childId: String(otherChild.id), fullName: "Shared Parent", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });

    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    await store.addContact({ childId: String(childA.id), fullName: "Shared Parent", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });

    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Shared Parent", role: "parent" });
    await store.linkFamily(parent.id as string, String(childA.id));

    const result = await store.linkSiblingsByParentEmail(parent.id as string, sharedEmail, iid, String(childA.id));
    expect(result.linkedChildIds).toEqual([]);
  });

  // The issue repro: "Create second child with same parent email; parent does
  // not gain access to both accounts." Creating the contact is the trigger.
  it("auto-links a parent account when a second child's contact is created", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const sharedEmail = "nouran@example.com";

    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Nouran Hisham", role: "parent" });
    // KID-152: the account is on file at this centre. `registerAction` is the
    // only way a parent account comes into existence and it refuses a
    // registration with no valid invite code, so the invite the daycare issued
    // at enrolment — which registration leaves in place — is what tenancy
    // evidence looks like in production. The auto-link now requires it; see
    // "gives an account with no tenancy evidence no links" below for the case
    // this rule deliberately refuses.
    await store.createInvite(iid, String(childA.id), sharedEmail, "SUNSHINE-142-A", "parent");
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    // Creating this second contact is what must grant the parent access.
    await store.addContact({ childId: String(childB.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });

    const family = await store.familiesForAccount(parent.id as string);
    expect(family.map((c) => String(c.id)).sort()).toEqual([String(childA.id), String(childB.id)].sort());
  });

  // KID-145 regression: the board report "I still can't see the sibling".
  // The auto-link above only fires on a contact create/update event. A sibling
  // that was already on file before that change never fires one, so the parent
  // resolves only the first child. The KID-146 backfill is what closes this;
  // this test is the assertion that must pass once the backfill has run, so the
  // defect cannot return silently between deploys.
  it("keeps a pre-existing same-email sibling visible to the parent", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const sharedEmail = "preexisting@example.com";

    // Simulate live data: both contacts already exist and the account is
    // already linked to the first child. No create/update event fires below.
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    await store.addContact({ childId: String(childB.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(parent.id as string, String(childA.id), "parent");

    // Running the backfill is idempotent and is the reconciliation path.
    await store.linkSiblingsByParentEmail(parent.id as string, sharedEmail, iid);

    const family = await store.familiesForAccount(parent.id as string);
    const linkedIds = family.map((c) => String(c.id)).sort();
    expect(linkedIds).toContain(String(childA.id));
    expect(linkedIds).toContain(String(childB.id));
    // The duplicate-family_member bug must not reappear via the backfill.
    expect(linkedIds).toHaveLength(2);
  });

  it("matches the parent email case-insensitively and ignores surrounding whitespace", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const parent = await createAccount({ email: "nouran@example.com", password: "x", fullName: "Nouran Hisham", role: "parent" });
    // KID-152: tenancy evidence, as every real parent has (see the note above).
    await store.createInvite(iid, String(childA.id), "nouran@example.com", "SUNSHINE-142-B", "parent");

    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: "Nouran@Example.com", isPickup: false, isEmergency: false });
    await store.addContact({ childId: String(childB.id), fullName: "Nouran Hisham", relationship: "parent", email: "  NOURAN@example.com  ", isPickup: false, isEmergency: false });

    const family = await store.familiesForAccount(parent.id as string);
    expect(family.map((c) => String(c.id)).sort()).toEqual([String(childA.id), String(childB.id)].sort());
  });

  it("re-links when an existing contact's email is edited to a parent address", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const parent = await createAccount({ email: "nouran@example.com", password: "x", fullName: "Nouran Hisham", role: "parent" });
    // KID-152: tenancy evidence, as every real parent has (see the note above).
    await store.createInvite(iid, String(childA.id), "nouran@example.com", "SUNSHINE-142-C", "parent");

    // Child A is known to the parent; child B's contact has no email yet.
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: "nouran@example.com", isPickup: false, isEmergency: false });
    const contactB = await store.addContact({ childId: String(childB.id), fullName: "Unassigned Guardian", relationship: "parent", isPickup: false, isEmergency: false });
    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id))).toEqual([String(childA.id)]);

    // Email change on the existing contact is the edge case in the issue.
    await store.updateContact(String(contactB.id), {
      fullName: "Nouran Hisham",
      relationship: "parent",
      email: "nouran@example.com",
      isPickup: false,
      isEmergency: false,
    });

    const family = await store.familiesForAccount(parent.id as string);
    expect(family.map((c) => String(c.id)).sort()).toEqual([String(childA.id), String(childB.id)].sort());
  });

  it("never gives a staff account family access as a side effect", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const sharedEmail = "carer-shared@example.com";
    const staffAccount = await createAccount({ email: sharedEmail, password: "x", fullName: "Carer", role: "staff" });

    await store.addContact({ childId: String(childA.id), fullName: "Carer", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    await store.addContact({ childId: String(childB.id), fullName: "Carer", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });

    const rows = await queryAll("SELECT * FROM family_member WHERE account_id = ?", String(staffAccount.id));
    expect(rows).toEqual([]);
  });

  // Idempotency: the same link applied repeatedly must not duplicate rows,
  // which is what broke the parent's children list before the unique index.
  it("keeps exactly one family link per account/child pair when re-run", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const sharedEmail = "nouran@example.com";
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Nouran Hisham", role: "parent" });
    // KID-152: tenancy evidence, as every real parent has (see the note above).
    await store.createInvite(iid, String(childA.id), sharedEmail, "SUNSHINE-142-D", "parent");

    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    await store.addContact({ childId: String(childB.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });

    // Re-run the whole auto-link path several times, as a re-run or a
    // duplicate invite would.
    for (let i = 0; i < 3; i += 1) {
      await store.linkSiblingsByParentEmail(parent.id as string, sharedEmail, iid);
      await store.autoLinkSiblingsForContact({ childId: String(childB.id), email: sharedEmail });
    }

    const rows = await queryAll(
      "SELECT * FROM family_member WHERE account_id = ?",
      String(parent.id)
    );
    expect(rows).toHaveLength(2);
    const family = await store.familiesForAccount(parent.id as string);
    expect(family.map((c) => String(c.id)).sort()).toEqual([String(childA.id), String(childB.id)].sort());
  });

  it("does not create a second parent account for the same email", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const sharedEmail = "nouran@example.com";
    await createAccount({ email: sharedEmail, password: "x", fullName: "Nouran Hisham", role: "parent" });

    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });

    const accounts = await queryAll("SELECT * FROM account WHERE lower(email) = ?", sharedEmail);
    expect(accounts).toHaveLength(1);
  });

  // KID-152, the leak itself. `linkSiblingsByParentEmail` used to filter
  // candidates on `WHERE c.institute_id = ?` and nothing else, and both callers
  // derive that value from the contact's own child — so the predicate was
  // trivially satisfied: it confirmed the child sits at the same centre as the
  // contact being added, which says nothing about which centres the account
  // belongs to. One addContact at a second centre was enough to hand a parent at
  // the first centre a child roster at the second. No migration involved.
  it("refuses a same-email contact at a centre the account is not on file at", async () => {
    const otherInstitute = await store.seedInstitute({ name: "Other Center" });
    const otherRoom = await store.createRoom(otherInstitute.id as string, "Other Room", 10);
    const sharedEmail = "cross-tenant@example.com";

    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Nouran Hisham", role: "parent" });
    // The only centre this account is on file at: the invite the daycare issued
    // at enrolment plus the family link registration created from it.
    await store.createInvite(iid, String(childA.id), sharedEmail, "SUNSHINE-152-A", "parent");
    await store.linkFamily(parent.id as string, String(childA.id), "parent");

    // A different centre, different staff, the same address.
    const foreignChild = await store.createChild({ instituteId: otherInstitute.id as string, firstName: "Foreign", lastName: "Child", roomId: otherRoom.id as string });

    // One ordinary contact write there. No migration, no backfill.
    await store.addContact({ childId: String(foreignChild.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });

    const links = await queryAll("SELECT child_id FROM family_member WHERE account_id = ?", String(parent.id));
    expect(links.map((r) => String(r.child_id))).toEqual([String(childA.id)]);
    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id))).toEqual([String(childA.id)]);
    // The deploy-gate check QA asked for reads the same rows: none exist.
    expect(await store.crossInstituteFamilyMemberRows()).toEqual([]);
  });

  // The other half of the same rule, so the fix cannot be over-applied into
  // "one centre per address": tenancy follows the account's own records, so a
  // guardian genuinely enrolled at two centres is linked at both.
  it("links at every centre the account is on file at, and only those", async () => {
    const otherInstitute = await store.seedInstitute({ name: "Other Center" });
    const otherRoom = await store.createRoom(otherInstitute.id as string, "Other Room", 10);
    const thirdInstitute = await store.seedInstitute({ name: "Third Center" });
    const thirdRoom = await store.createRoom(thirdInstitute.id as string, "Third Room", 10);
    const sharedEmail = "both-sites@example.com";

    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: otherInstitute.id as string, firstName: "Mikael", lastName: "Nassef", roomId: otherRoom.id as string });
    const thirdChild = await store.createChild({ instituteId: thirdInstitute.id as string, firstName: "Noor", lastName: "Nassef", roomId: thirdRoom.id as string });
    // Same centre as the account, but this child's own contact does not carry
    // the address, so the sibling match never considers it.
    const strangerChild = await store.createChild({ instituteId: iid, firstName: "Salma", lastName: "Nassef", roomId: roomB });

    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Two Sites", role: "parent" });
    // On file at two centres: the daycare issued an invite at each.
    await store.createInvite(iid, String(childA.id), sharedEmail, "SUNSHINE-152-B", "parent");
    await store.createInvite(otherInstitute.id as string, String(childB.id), sharedEmail, "SUNSHINE-152-C", "parent");

    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    await store.addContact({ childId: String(childB.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    // A third centre the account has no association with: refused.
    await store.addContact({ childId: String(thirdChild.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    await store.addContact({ childId: String(strangerChild.id), fullName: "Someone Else", relationship: "parent", isPickup: false, isEmergency: false });

    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id)).sort()).toEqual(
      [String(childA.id), String(childB.id)].sort()
    );
    expect(await store.crossInstituteFamilyMemberRows()).toEqual([]);
  });

  // The zero-link edge case, stated rather than left undefined. An address with
  // no invite and no link is a shape `registerAction` cannot produce, but the
  // schema allows one to exist (a shared, generic or mistyped address reaching
  // the account table some other way). It belongs to no centre, so no contact
  // write may hand it a child — inferring tenancy from a matching address is the
  // defect. It recovers the moment the daycare puts it on file the way it does
  // for every real parent.
  it("gives an account with no tenancy evidence no links, and starts linking once the daycare puts it on file", async () => {
    const sharedEmail = "no-evidence@example.com";
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "No Evidence", role: "parent" });

    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id))).toEqual([]);

    // On file with an invite, as enrolment does. The ordinary contact path
    // works from here on, and links the earlier contact's child too.
    await store.createInvite(iid, String(childA.id), sharedEmail, "SUNSHINE-152-D", "parent");
    await store.addContact({ childId: String(childB.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });

    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id)).sort()).toEqual(
      [String(childA.id), String(childB.id)].sort()
    );
  });

  it("linkFamily is idempotent for a repeated account/child pair", async () => {
    const child = await store.createChild({ instituteId: iid, firstName: "Solo", lastName: "Child", roomId: roomA });
    const parent = await createAccount({ email: "solo-parent@example.com", password: "x", fullName: "Solo Parent", role: "parent" });

    await store.linkFamily(parent.id as string, String(child.id));
    await store.linkFamily(parent.id as string, String(child.id));
    await store.linkFamily(parent.id as string, String(child.id));

    const rows = await queryAll("SELECT * FROM family_member WHERE account_id = ?", String(parent.id));
    expect(rows).toHaveLength(1);
  });

  it("updates the stored role in place when a link is re-applied with a stricter role", async () => {
    const child = await store.createChild({ instituteId: iid, firstName: "Role", lastName: "Child", roomId: roomA });
    const parent = await createAccount({ email: "role-parent@example.com", password: "x", fullName: "Role Parent", role: "parent" });

    await store.linkFamily(parent.id as string, String(child.id), "family");
    // A stricter re-link must update the stored role rather than add a row.
    await store.linkFamily(parent.id as string, String(child.id), "pickup");

    const roles = await store.familyRolesForAccount(parent.id as string);
    expect(roles).toEqual(["pickup"]);
  });
});

describe("KID-143 same-email contact backfill", () => {
  it("copies missing full name and phone from an existing same-email contact", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const email = "nouran@example.com";
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", phone: "+20 100 123 4567", email, isPickup: false, isEmergency: false });

    const newContact = await store.addContact({ childId: String(childB.id), fullName: "", relationship: "", phone: "", email, isPickup: false, isEmergency: false });

    expect(newContact.full_name).toBe("Nouran Hisham");
    expect(newContact.phone).toBe("+20 100 123 4567");
    expect(newContact.relationship).toBe("parent");
  });

  it("keeps explicitly provided values over backfilled ones", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const email = "nouran@example.com";
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", phone: "+20 100 123 4567", email, isPickup: false, isEmergency: false });

    const newContact = await store.addContact({ childId: String(childB.id), fullName: "Nouran H.", relationship: "family", phone: "+20 100 999 9999", email, isPickup: false, isEmergency: false });

    expect(newContact.full_name).toBe("Nouran H.");
    expect(newContact.phone).toBe("+20 100 999 9999");
    expect(newContact.relationship).toBe("family");
  });

  it("falls back to the existing account name when no contact exists yet", async () => {
    const email = "existing-parent@example.com";
    await createAccount({ email, password: "x", fullName: "Existing Parent", role: "parent" });
    const child = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });

    const newContact = await store.addContact({ childId: String(child.id), fullName: "", relationship: "parent", email, isPickup: false, isEmergency: false });

    expect(newContact.full_name).toBe("Existing Parent");
  });

  // "earliest existing same-email parent profile" — a later correction to one
  // child's contact must not become the profile future submissions copy.
  it("copies from the earliest same-email contact, not the newest", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const childC = await store.createChild({ instituteId: iid, firstName: "Salma", lastName: "Nassef", roomId: roomB });
    const email = "earliest@example.com";

    const first = await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", phone: "+20 111", email, isPickup: false, isEmergency: false });
    const second = await store.addContact({ childId: String(childB.id), fullName: "Nouran H.", relationship: "family", phone: "+20 222", email, isPickup: false, isEmergency: false });
    // created_at has one-second resolution, so pin the order explicitly rather
    // than relying on how fast the inserts ran.
    await queryRun("UPDATE contact SET created_at = '2026-01-01 00:00:01' WHERE id = ?", String(first.id));
    await queryRun("UPDATE contact SET created_at = '2026-01-01 00:00:02' WHERE id = ?", String(second.id));

    const third = await store.addContact({ childId: String(childC.id), fullName: "", relationship: "", phone: "", email, isPickup: false, isEmergency: false });

    expect(third.full_name).toBe("Nouran Hisham");
    expect(third.phone).toBe("+20 111");
    expect(third.relationship).toBe("parent");
  });

  it("matches the same address case-insensitively and ignores surrounding whitespace", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", phone: "+20 100", email: "  Nouran@Example.com  ", isPickup: false, isEmergency: false });

    const newContact = await store.addContact({ childId: String(childB.id), fullName: "", relationship: "parent", phone: "", email: "NOURAN@example.com", isPickup: false, isEmergency: false });

    expect(newContact.full_name).toBe("Nouran Hisham");
    expect(newContact.phone).toBe("+20 100");
  });

  it("leaves the existing same-email contact untouched", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const email = "untouched@example.com";
    const original = await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", phone: "+20 100", email, isPickup: true, isEmergency: false });
    const before = { ...original };

    await store.addContact({ childId: String(childB.id), fullName: "", relationship: "parent", phone: "", email, isPickup: false, isEmergency: false });

    const after = await queryGet("SELECT * FROM contact WHERE id = ?", String(original.id));
    expect(after).toEqual(before);
  });

  it("does not copy per-child flags or invent a profile for an unknown address", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const email = "flags@example.com";
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", phone: "+20 100", email, isPickup: true, isEmergency: true });

    // The new child needs its own pickup/emergency decision — it is not
    // inherited from the sibling's contact.
    const newContact = await store.addContact({ childId: String(childB.id), fullName: "Nouran Hisham", relationship: "parent", phone: "", email, isPickup: false, isEmergency: false });
    expect(newContact.is_pickup).toBe(0);
    expect(newContact.is_emergency).toBe(0);

    // No address on the submission and no match: no lookup, no invented data.
    const noEmail = await store.addContact({ childId: String(childB.id), fullName: "Someone Else", relationship: "family", phone: "+20 9", isPickup: false, isEmergency: false });
    expect(noEmail.full_name).toBe("Someone Else");
    expect(noEmail.phone).toBe("+20 9");
    expect(noEmail.email).toBeNull();
  });

  it("on edit, fills blanks from the same-email profile but never from itself", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const email = "edit-backfill@example.com";
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", phone: "+20 100", email, isPickup: false, isEmergency: false });
    const target = await store.addContact({ childId: String(childB.id), fullName: "Stale Name", relationship: "family", phone: "", email, isPickup: false, isEmergency: false });

    const updated = await store.updateContact(String(target.id), {
      fullName: "",
      relationship: "parent",
      phone: "",
      email,
      isPickup: false,
      isEmergency: false,
    });

    expect(updated.full_name).toBe("Nouran Hisham");
    expect(updated.phone).toBe("+20 100");
    // The value the admin submitted is never replaced by the source's.
    expect(updated.relationship).toBe("parent");
  });

  it("reports which fields it filled and which source it used", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const source = await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", phone: "+20 100", email: "report@example.com", isPickup: false, isEmergency: false });

    const filled = await store.backfillContactFromSameEmail({
      email: "report@example.com",
      fullName: "",
      phone: "",
      relationship: "parent",
    });
    expect(filled.source).toBe("earliest-contact");
    expect(filled.sourceContactId).toBe(String(source.id));
    expect(filled.filled).toEqual(["fullName", "phone"]);

    const nothing = await store.backfillContactFromSameEmail({
      email: "report@example.com",
      fullName: "Typed Name",
      phone: "+20 5",
      relationship: "parent",
    });
    expect(nothing.source).toBe("none");
    expect(nothing.filled).toEqual([]);
  });
});

describe("KID-144 classroom staff messaging", () => {
  it("returns only staff assigned to the parent's children's rooms", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const parent = await createAccount({ email: "parent-kid144@example.com", password: "x", fullName: "Parent KID144", role: "parent" });
    await store.linkFamily(parent.id as string, String(childA.id));

    const staffA = await store.createStaff({ instituteId: iid, fullName: "Carer A", role: "carer", roomIds: [roomA] });
    const staffB = await store.createStaff({ instituteId: iid, fullName: "Carer B", role: "carer", roomIds: [roomB] });

    const accA = await createAccount({ email: "carer-a@example.com", password: "x", fullName: "Carer A", role: "staff" });
    const accB = await createAccount({ email: "carer-b@example.com", password: "x", fullName: "Carer B", role: "staff" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staffA.id), String(accA.id));
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staffB.id), String(accB.id));

    const allowed = await store.classroomStaffForParent(parent.id as string);
    const names = allowed.map((s) => String(s.full_name)).sort();
    expect(names).toEqual(["Carer A"]);
  });

  it("includes staff assigned to any room when the parent has children in multiple rooms", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const parent = await createAccount({ email: "parent-multi@example.com", password: "x", fullName: "Multi Room Parent", role: "parent" });
    await store.linkFamily(parent.id as string, String(childA.id));
    await store.linkFamily(parent.id as string, String(childB.id));

    const staffA = await store.createStaff({ instituteId: iid, fullName: "Carer A", role: "carer", roomIds: [roomA] });
    const staffB = await store.createStaff({ instituteId: iid, fullName: "Carer B", role: "carer", roomIds: [roomB] });

    const accA = await createAccount({ email: "multi-a@example.com", password: "x", fullName: "Carer A", role: "staff" });
    const accB = await createAccount({ email: "multi-b@example.com", password: "x", fullName: "Carer B", role: "staff" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staffA.id), String(accA.id));
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staffB.id), String(accB.id));

    const allowed = await store.classroomStaffForParent(parent.id as string);
    const names = allowed.map((s) => String(s.full_name)).sort();
    expect(names).toEqual(["Carer A", "Carer B"]);
  });

  it("threadsForAccountScoped hides threads with non-classroom participants", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const parent = await createAccount({ email: "parent-threads@example.com", password: "x", fullName: "Thread Parent", role: "parent" });
    await store.linkFamily(parent.id as string, String(childA.id));

    const staffA = await store.createStaff({ instituteId: iid, fullName: "Carer A", role: "carer", roomIds: [roomA] });
    const admin = await createAccount({ email: "admin-threads@example.com", password: "x", fullName: "Admin", role: "owner" });
    const accA = await createAccount({ email: "thread-a@example.com", password: "x", fullName: "Carer A", role: "staff" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staffA.id), String(accA.id));

    const allowedThread = await store.createMessageThread({ instituteId: iid, isGroup: false, createdBy: accA.id as string, participantIds: [parent.id as string] });
    await store.sendMessage({ instituteId: iid, senderAccountId: accA.id as string, recipientAccountId: parent.id as string, body: "hi", threadId: String(allowedThread.id) });

    const adminThread = await store.createMessageThread({ instituteId: iid, isGroup: false, createdBy: admin.id as string, participantIds: [parent.id as string] });
    await store.sendMessage({ instituteId: iid, senderAccountId: admin.id as string, recipientAccountId: parent.id as string, body: "admin", threadId: String(adminThread.id) });

    const visible = await store.threadsForAccountScoped(parent.id as string);
    expect(visible.map((t) => String(t.id))).toEqual([String(allowedThread.id)]);
  });
});
