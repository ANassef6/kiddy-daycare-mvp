// KID-152 QA verification: the *register* call site of the sibling auto-link.
//
// The fix (cbf384b) gates linkSiblingsByParentEmail on the account's own
// institute set, and its own suite (kid152-tenant-gate.test.ts,
// kid149-backfill-isolation.test.ts) exercises that gate through
// autoLinkSiblingsForContact and through the backfill. Neither file drives the
// second caller: registerAction (lib/actions.ts:369), which is the path a real
// parent takes the first time they activate. That caller passes
// `invite.institute_id` and `invite.child_id` rather than resolving the
// institute from a child, so it is the one entry point where the gate's
// evidence has to come from the invite alone.
//
// registerAction itself needs next/headers (cookies(), redirect()) and GoTrue,
// so these tests drive the exact call it makes —
// linkSiblingsByParentEmail(account.id, email, invite.institute_id,
// invite.child_id) — against real rows. That is the whole of the register
// path's tenancy decision, and it is the part the fix changed.
//
// Why the register path needs its own coverage: it is the only flow where the
// account is brand new and therefore may hold no family_member row yet, so it is
// the only flow that proves the invite branch of instituteIdsForAccount is
// load-bearing. If that branch were wrong, every other suite would still be
// green because their fixtures all carry a link.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { createAccount } from "@/lib/auth";
import { queryAll, queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";

let homeInstituteId: string;
let homeRoomId: string;

interface Centre {
  instituteId: string;
  roomId: string;
}

/** A second, unrelated centre. This is the foreign tenant. */
async function foreignCentre(name: string): Promise<Centre> {
  const other = await store.seedInstitute({ name });
  const room = await store.createRoom(String(other.id), `${name} Room`, 10);
  return { instituteId: String(other.id), roomId: String(room.id) };
}

async function addParentContact(childId: string, email: string): Promise<void> {
  await store.addContact({
    childId,
    fullName: "Sasha Lindqvist",
    relationship: "parent",
    email,
    isPickup: false,
    isEmergency: false
  });
}

/** The exact call registerAction makes at lib/actions.ts:369. */
function registerSiblingLink(
  accountId: string,
  email: string,
  inviteInstituteId: string,
  inviteChildId: string | null
): Promise<{ linkedChildIds: string[] }> {
  return store.linkSiblingsByParentEmail(accountId, email, inviteInstituteId, inviteChildId);
}

async function linkedChildIds(accountId: string): Promise<string[]> {
  const rows = await queryAll(
    "SELECT child_id FROM family_member WHERE account_id = ? ORDER BY child_id",
    accountId
  );
  return rows.map((r) => String(r.child_id));
}

beforeEach(async () => {
  await seedFixture();
  homeInstituteId = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  homeRoomId = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
});

describe("KID-152 register path: the invite is the only evidence a new account has", () => {
  it("still links the parent's same-centre sibling when the invite is scoped to a child", async () => {
    // Arrange: the daycare invites the address against a specific child, exactly
    // as inviteParentAction does when staff pick a child on the invite form.
    // registerAction runs linkFamily for invite.child_id first, so by the time
    // the sibling link runs the account holds a link at this centre.
    const invitedChild = await store.createChild({
      instituteId: homeInstituteId,
      firstName: "Rasmus",
      lastName: "Lindqvist",
      roomId: homeRoomId
    });
    const sibling = await store.createChild({
      instituteId: homeInstituteId,
      firstName: "Elsa",
      lastName: "Lindqvist",
      roomId: homeRoomId
    });
    const email = "register-child-scoped@example.com";
    await addParentContact(String(invitedChild.id), email);
    await addParentContact(String(sibling.id), email);
    const parent = await createAccount({
      email,
      password: "x",
      fullName: "Sasha Lindqvist",
      role: "parent"
    });
    // registerAction: `if (invite.child_id) await linkFamily(...)`.
    await store.linkFamily(String(parent.id), String(invitedChild.id), "parent");

    // Act: the register-path sibling link.
    const result = await registerSiblingLink(
      String(parent.id),
      email,
      homeInstituteId,
      String(invitedChild.id)
    );

    // Assert: the same-centre sibling is granted. A gate that over-tightens
    // here is the same user-visible bug as the leak, so this must stay green.
    expect(result.linkedChildIds).toEqual([String(sibling.id)]);
    expect(await linkedChildIds(String(parent.id))).toEqual(
      [String(invitedChild.id), String(sibling.id)].sort()
    );
  });

  it("does not link a same-email child at a centre the account has no link to", async () => {
    // Arrange: the invite is at the home centre; a second centre holds a child
    // carrying the same address on its contact record.
    const invitedChild = await store.createChild({
      instituteId: homeInstituteId,
      firstName: "Rasmus",
      lastName: "Lindqvist",
      roomId: homeRoomId
    });
    const email = "register-cross-centre@example.com";
    await addParentContact(String(invitedChild.id), email);
    const parent = await createAccount({
      email,
      password: "x",
      fullName: "Sasha Lindqvist",
      role: "parent"
    });
    await store.linkFamily(String(parent.id), String(invitedChild.id), "parent");
    const foreign = await foreignCentre("Nordic Center");
    const foreignChild = await store.createChild({
      instituteId: foreign.instituteId,
      firstName: "Oskari",
      lastName: "Lindqvist",
      roomId: foreign.roomId
    });
    await addParentContact(String(foreignChild.id), email);

    // Act: the register-path sibling link, scoped to the home centre.
    const result = await registerSiblingLink(
      String(parent.id),
      email,
      homeInstituteId,
      String(invitedChild.id)
    );

    // Assert: nothing new is granted, and the foreign child is invisible.
    expect(result.linkedChildIds).toEqual([]);
    expect(await linkedChildIds(String(parent.id))).toEqual([String(invitedChild.id)]);
    const visible = (await store.familiesForAccount(String(parent.id))).map((c) => String(c.id));
    expect(visible).toEqual([String(invitedChild.id)]);
  });

  it("links a same-centre sibling from a child-less invite alone, with no family_member row yet", async () => {
    // Arrange: invite.child_id is null — both invite call sites accept it
    // (createInvite takes `childId: string | null`), so registerAction skips
    // linkFamily entirely and the account is left holding no link. The invite
    // addressed to the account is then the *only* tenancy evidence there is.
    // This is the case that proves the invite branch of the derivation works.
    const sibling = await store.createChild({
      instituteId: homeInstituteId,
      firstName: "Elsa",
      lastName: "Lindqvist",
      roomId: homeRoomId
    });
    const email = "register-childless-invite@example.com";
    await addParentContact(String(sibling.id), email);
    await store.createInvite(homeInstituteId, null, email, "SUNSHINE-R1", "parent");
    const parent = await createAccount({
      email,
      password: "x",
      fullName: "Sasha Lindqvist",
      role: "parent"
    });

    // Act + Assert (arrange guard): the account really has no link yet.
    expect(await store.instituteIdsForAccount(String(parent.id))).toEqual([homeInstituteId]);
    expect(await linkedChildIds(String(parent.id))).toEqual([]);

    // Act: the register-path sibling link with a null invite child.
    const result = await registerSiblingLink(String(parent.id), email, homeInstituteId, null);

    // Assert: the sibling is linked off the invite alone.
    expect(result.linkedChildIds).toEqual([String(sibling.id)]);
  });

  it("refuses a cross-centre sibling even when the register call is handed that centre", async () => {
    // Arrange: the account is evidenced only at the home centre, but the call is
    // made with the *other* centre's id. This is the defence-in-depth case: the
    // gate must not trust the institute argument it is given, because on the
    // addContact path that argument is derived from the contact's own child and
    // is therefore not an authorisation (that was the KID-152 defect).
    const child = await store.createChild({
      instituteId: homeInstituteId,
      firstName: "Rasmus",
      lastName: "Lindqvist",
      roomId: homeRoomId
    });
    const email = "register-wrong-institute@example.com";
    await addParentContact(String(child.id), email);
    const parent = await createAccount({
      email,
      password: "x",
      fullName: "Sasha Lindqvist",
      role: "parent"
    });
    await store.linkFamily(String(parent.id), String(child.id), "parent");
    const foreign = await foreignCentre("Baltic Center");
    const foreignChild = await store.createChild({
      instituteId: foreign.instituteId,
      firstName: "Oskari",
      lastName: "Lindqvist",
      roomId: foreign.roomId
    });
    await addParentContact(String(foreignChild.id), email);

    // Act: hand the call the foreign centre.
    const result = await registerSiblingLink(String(parent.id), email, foreign.instituteId, null);

    // Assert: refused, and the account's own centre is untouched.
    expect(result.linkedChildIds).toEqual([]);
    expect(await linkedChildIds(String(parent.id))).toEqual([String(child.id)]);
  });

  it("fails closed for a child-less invite addressed to a different address, and staff linking recovers it", async () => {
    // Arrange: the daycare issues a code to one address (a work address, say)
    // and the parent registers a different one. registerAction validates the
    // code and its pending status only — it never requires invite.email to equal
    // the registering address (lib/actions.ts:190-194) — so this state is
    // reachable. With child_id null there is no linkFamily, and the invite is
    // addressed to an address this account does not have, so the account has no
    // tenancy evidence at all.
    //
    // This is the one shape where the gate withholds access a parent arguably
    // should have. It is asserted, not skipped, so the boundary is visible and
    // cannot drift silently. Failing closed is the right side to err on here:
    // honouring a code minted for a different address is the same
    // email-inference that caused KID-152, and the parent is never locked out —
    // the daycare makes the link by hand, which is an explicit action.
    const sibling = await store.createChild({
      instituteId: homeInstituteId,
      firstName: "Elsa",
      lastName: "Lindqvist",
      roomId: homeRoomId
    });
    const registeredEmail = "personal-address@example.com";
    const invitedEmail = "work-address@example.com";
    await addParentContact(String(sibling.id), registeredEmail);
    await store.createInvite(homeInstituteId, null, invitedEmail, "SUNSHINE-R2", "parent");
    const parent = await createAccount({
      email: registeredEmail,
      password: "x",
      fullName: "Sasha Lindqvist",
      role: "parent"
    });

    // Act.
    const refused = await registerSiblingLink(String(parent.id), registeredEmail, homeInstituteId, null);

    // Assert: no automatic link, and no evidence was conjured from the contact.
    expect(refused.linkedChildIds).toEqual([]);
    expect(await store.instituteIdsForAccount(String(parent.id))).toEqual([]);

    // Assert: the documented recovery works — a link made by the daycare.
    await store.linkFamily(String(parent.id), String(sibling.id), "parent");
    const visible = (await store.familiesForAccount(String(parent.id))).map((c) => String(c.id));
    expect(visible).toEqual([String(sibling.id)]);
  });
});

describe("KID-152 register path: account identity is the gate's anchor", () => {
  it("does not widen access when the account email differs from the contact email by case or padding", async () => {
    // Arrange: the contact is typed with padded, mixed-case whitespace and the
    // account with the clean form — the same person, matched by
    // normalizeParentEmail. The tenant check must survive that normalisation,
    // because a gate that compared raw strings would stop matching the invite
    // and silently withhold legitimate access.
    const child = await store.createChild({
      instituteId: homeInstituteId,
      firstName: "Rasmus",
      lastName: "Lindqvist",
      roomId: homeRoomId
    });
    const sibling = await store.createChild({
      instituteId: homeInstituteId,
      firstName: "Elsa",
      lastName: "Lindqvist",
      roomId: homeRoomId
    });
    const accountEmail = "case-padded@example.com";
    const paddedForm = "  Case-Padded@Example.COM ";
    await addParentContact(String(child.id), paddedForm);
    await addParentContact(String(sibling.id), paddedForm);
    await store.createInvite(homeInstituteId, String(child.id), accountEmail, "SUNSHINE-R3", "parent");
    const parent = await createAccount({
      email: accountEmail,
      password: "x",
      fullName: "Sasha Lindqvist",
      role: "parent"
    });
    await store.linkFamily(String(parent.id), String(child.id), "parent");

    // Act: the register call excludes the invite's own child, which is already
    // linked by linkFamily above.
    const result = await registerSiblingLink(String(parent.id), paddedForm, homeInstituteId, String(child.id));

    // Assert: still linked at its own centre despite the formatting difference.
    expect(result.linkedChildIds).toEqual([String(sibling.id)]);
  });

  it("never grants a staff account family access through the same contact edit", async () => {
    // Arrange: a staff account whose address matches a contact. autoLink
    // filters on role='parent', but the register path calls
    // linkSiblingsByParentEmail directly, so the gate is the only thing standing
    // between a staff login and a family grant here.
    const child = await store.createChild({
      instituteId: homeInstituteId,
      firstName: "Rasmus",
      lastName: "Lindqvist",
      roomId: homeRoomId
    });
    const sibling = await store.createChild({
      instituteId: homeInstituteId,
      firstName: "Elsa",
      lastName: "Lindqvist",
      roomId: homeRoomId
    });
    const staffEmail = "staff-with-child-record@example.com";
    await addParentContact(String(child.id), staffEmail);
    await addParentContact(String(sibling.id), staffEmail);
    const staff = await createAccount({
      email: staffEmail,
      password: "x",
      fullName: "Teo Lindqvist",
      role: "staff"
    });

    // Act.
    const result = await registerSiblingLink(String(staff.id), staffEmail, homeInstituteId, null);

    // Assert: a staff account holds no invite and no family link, so the gate
    // refuses even though the address matches a contact at this centre.
    expect(result.linkedChildIds).toEqual([]);
    expect(await linkedChildIds(String(staff.id))).toEqual([]);
    expect(await store.crossInstituteFamilyMemberRows()).toEqual([]);
  });
});
