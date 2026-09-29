// KID-146: backfill family links for children that already existed.
//
// KID-142 only auto-linked siblings from addContact(), updateContact() and the
// register path. familiesForAccount() — the single read path behind every
// /child/* page — renders from family_member alone, so a contact row written
// before 05be841 left the child permanently invisible to the parent who owns
// that email. Migration 0018 reconciles that data; this suite exercises the
// SQLite mirror of it in lib/sqlite-schema.ts.
//
// The pre-existing state is built with raw INSERTs, not store helpers, so no
// runtime auto-link can run — that is exactly the "predates the link" data the
// migration has to repair. `ensureSchema()` re-runs `sqliteSchema()` on the
// SQLite path (there is no migration ledger there), so it is the real trigger
// for the backfill.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { createAccount } from "@/lib/auth";
import { ensureSchema, queryAll, queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let iid: string;
let roomA: string;
let roomB: string;

const LEGACY_AT = "2026-01-01 00:00:00";

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  roomB = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool'"))!.id);
});

/** A contact row stored the way it would have been before the KID-142
 *  auto-link existed: raw INSERT, so nothing links as a side effect. */
async function legacyContact(opts: {
  childId: string;
  email?: string | null;
  relationship?: string;
  name?: string;
}): Promise<string> {
  const id = `legacy-contact-${Math.random().toString(36).slice(2, 10)}`;
  await queryRun(
    `INSERT INTO contact (id, child_id, full_name, relationship, phone, email, is_pickup, is_emergency, created_at)
     VALUES (?, ?, ?, ?, '', ?, 0, 0, ?)`,
    id,
    opts.childId,
    opts.name ?? "Nouran Hisham",
    opts.relationship ?? "parent",
    opts.email ?? null,
    LEGACY_AT
  );
  return id;
}

async function familyRows(accountId: string): Promise<{ child_id: string; role: string }[]> {
  const rows = await queryAll(
    "SELECT child_id, role FROM family_member WHERE account_id = ? ORDER BY child_id",
    accountId
  );
  return rows.map((r) => ({ child_id: String(r.child_id), role: String(r.role) }));
}

describe("KID-146 backfill of pre-existing same-email sibling links", () => {
  // The acceptance case: a contact row and a parent account that both predate
  // the link, then the backfill, then the parent resolves both children.
  it("links children whose contact predates the auto-link so the parent sees them", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const sharedEmail = "nouran@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    await legacyContact({ childId: String(childB.id), email: sharedEmail });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Nouran Hisham", role: "parent" });

    // Before the backfill the parent sees nothing — the reported symptom.
    expect(await store.familiesForAccount(parent.id as string)).toEqual([]);

    await ensureSchema();

    const family = await store.familiesForAccount(parent.id as string);
    expect(family.map((c) => String(c.id)).sort()).toEqual([String(childA.id), String(childB.id)].sort());
    expect(await familyRows(parent.id as string)).toEqual([
      { child_id: String(childA.id), role: "parent" },
      { child_id: String(childB.id), role: "parent" },
    ]);
  });

  it("is re-runnable and never creates a duplicate row", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const sharedEmail = "rerun@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    await legacyContact({ childId: String(childB.id), email: sharedEmail });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Nouran Hisham", role: "parent" });

    await ensureSchema();
    await ensureSchema();
    await ensureSchema();

    expect(await familyRows(parent.id as string)).toHaveLength(2);
    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id)).sort()).toEqual(
      [String(childA.id), String(childB.id)].sort()
    );
  });

  it("uses the contact relationship as the link role", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const sharedEmail = "roles@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail, relationship: "family" });
    await legacyContact({ childId: String(childB.id), email: sharedEmail, relationship: "pickup" });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Nouran Hisham", role: "parent" });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual([
      { child_id: String(childA.id), role: "family" },
      { child_id: String(childB.id), role: "pickup" },
    ]);
  });

  it("matches the address case-insensitively and ignores surrounding whitespace", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    await legacyContact({ childId: String(childA.id), email: "  Nouran@Example.com  " });
    await legacyContact({ childId: String(childB.id), email: "NOURAN@EXAMPLE.COM" });
    const parent = await createAccount({ email: "nouran@example.com", password: "x", fullName: "Nouran Hisham", role: "parent" });

    await ensureSchema();

    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id)).sort()).toEqual(
      [String(childA.id), String(childB.id)].sort()
    );
  });

  it("never grants a non-parent account family access", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const sharedEmail = "carer@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    const staffAccount = await createAccount({ email: sharedEmail, password: "x", fullName: "Carer", role: "staff" });
    // Defence in depth: role can be corrected after the account was created.
    await queryRun("UPDATE account SET role = 'staff' WHERE id = ?", String(staffAccount.id));

    await ensureSchema();

    expect(await familyRows(String(staffAccount.id))).toEqual([]);
  });

  it("ignores contacts with no address and addresses nobody owns", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    await legacyContact({ childId: String(childA.id), email: null, name: "Walk-in Guardian" });
    await legacyContact({ childId: String(childB.id), email: "   ", name: "Blank Address" });
    const parent = await createAccount({ email: "nouran@example.com", password: "x", fullName: "Nouran Hisham", role: "parent" });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual([]);
  });

  it("does not let a contact at one centre link a child that has no contact of its own", async () => {
    const otherInstitute = await store.seedInstitute({ name: "Other Center" });
    const otherRoom = await store.createRoom(otherInstitute.id as string, "Other Room", 10);
    const sharedEmail = "two-centres@example.com";

    // The shared address exists only on a child at the home institute.
    const homeChild = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    await legacyContact({ childId: String(homeChild.id), email: sharedEmail });

    // The other centre's child has a different guardian, and no parent account.
    const otherChild = await store.createChild({ instituteId: otherInstitute.id as string, firstName: "Stranger", lastName: "Kid", roomId: otherRoom.id as string });
    await legacyContact({ childId: String(otherChild.id), email: "someone-else@example.com" });

    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Two Centres", role: "parent" });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual([{ child_id: String(homeChild.id), role: "parent" }]);
  });

  // A parent with children at two centres gets one profile, so the other
  // centre's own same-email contact is a genuine sibling link.
  it("links a same-email child at another centre because the address identifies the person", async () => {
    const otherInstitute = await store.seedInstitute({ name: "Other Center" });
    const otherRoom = await store.createRoom(otherInstitute.id as string, "Other Room", 10);
    const sharedEmail = "two-sites@example.com";

    const homeChild = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const otherChild = await store.createChild({ instituteId: otherInstitute.id as string, firstName: "Mikael", lastName: "Nassef", roomId: otherRoom.id as string });
    await legacyContact({ childId: String(homeChild.id), email: sharedEmail });
    await legacyContact({ childId: String(otherChild.id), email: sharedEmail });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Two Sites", role: "parent" });

    await ensureSchema();

    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id)).sort()).toEqual(
      [String(homeChild.id), String(otherChild.id)].sort()
    );
  });

  // Insert-only: a role an admin set deliberately must survive the backfill.
  it("leaves an existing family link's role untouched", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const sharedEmail = "downgraded@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    await legacyContact({ childId: String(childB.id), email: sharedEmail });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Downgraded", role: "parent" });
    // The daycare deliberately downgraded this one child; the backfill must not
    // silently restore full access.
    await store.linkFamily(parent.id as string, String(childA.id), "pickup");

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual([
      { child_id: String(childA.id), role: "pickup" },
      { child_id: String(childB.id), role: "parent" },
    ]);
  });

  // Two same-email contacts on one child that disagree: one row, and the most
  // permissive role wins, matching what familyAccessForAccount grants anyway.
  it("keeps one row and takes the most permissive role when contacts disagree", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const sharedEmail = "disagree@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail, relationship: "no_access" });
    await legacyContact({ childId: String(childA.id), email: sharedEmail, relationship: "parent" });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Disagree", role: "parent" });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual([{ child_id: String(childA.id), role: "parent" }]);
  });

  // A value outside the KID-112 enum must not trip the CHECK constraint that
  // guards family_member.role; it falls back to 'parent' like the runtime does.
  it("falls back to the parent role for a relationship outside the enum", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const sharedEmail = "legacy-text@example.com";
    await queryRun("UPDATE contact SET relationship = 'Grandmother' WHERE child_id = ?", String(childA.id));
    await legacyContact({ childId: String(childA.id), email: sharedEmail, relationship: "Mother" });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Legacy Text", role: "parent" });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual([{ child_id: String(childA.id), role: "parent" }]);
  });

  // familiesForAccount filters c.active = 1, so a withdrawn child is linked but
  // invisible, and access returns without a gap if the child is reactivated.
  it("links a withdrawn child without making it visible, and restores it on reactivation", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const sharedEmail = "withdrawn@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    await queryRun("UPDATE child SET active = 0 WHERE id = ?", String(childA.id));
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Withdrawn", role: "parent" });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toHaveLength(1);
    expect(await store.familiesForAccount(parent.id as string)).toEqual([]);

    await queryRun("UPDATE child SET active = 1 WHERE id = ?", String(childA.id));
    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id))).toEqual([String(childA.id)]);
  });

  // The backfill must compose with the KID-142 runtime path, not race it.
  it("stays consistent when the KID-142 contact path also runs", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const sharedEmail = "both-paths@example.com";
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Both Paths", role: "parent" });

    // Legacy contact on A, then the live addContact() path on B.
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    await store.addContact({ childId: String(childB.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });

    await ensureSchema();

    const family = await store.familiesForAccount(parent.id as string);
    expect(family.map((c) => String(c.id)).sort()).toEqual([String(childA.id), String(childB.id)].sort());
    expect(await familyRows(parent.id as string)).toHaveLength(2);
  });
});
