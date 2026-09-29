// KID-149: the backfill migration must not grant cross-institute family access.
//
// The delivered 0018 sibling backfill had no institute predicate, so a parent
// account linked a same-email child at every centre. This exercises the SQLite
// mirror of the migration (lib/sqlite-schema.ts), which the suite runs against.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { createAccount } from "@/lib/auth";
import { ensureSchema, queryAll, queryGet, queryRun } from "@/lib/db";
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

async function familyMemberRows(): Promise<string[]> {
  const rows = await queryAll("SELECT child_id FROM family_member");
  return rows.map((r) => String(r.child_id));
}

describe("KID-149 backfill institute isolation", () => {
  it("does not link a same-email child at a centre the account has no link to", async () => {
    // Arrange: the parent is a real parent at Sunshine (iid) via an invite.
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const sharedEmail = "cross-tenant@example.com";
    await store.createInvite(iid, String(childA.id), sharedEmail, "SUNSHINE-9", "parent");
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(parent.id as string, String(childA.id), "parent");

    // A different centre, different staff, same contact email. The contact row
    // is inserted directly so this test measures the MIGRATION only. Writing it
    // through addContact would fire the KID-142 runtime auto-link, which is a
    // separate defect with its own test below ("runtime auto-link grants
    // cross-institute access").
    const otherInstitute = await store.seedInstitute({ name: "Other Center" });
    const otherRoom = await store.createRoom(otherInstitute.id as string, "Other Room", 10);
    const foreignChild = await store.createChild({ instituteId: otherInstitute.id as string, firstName: "Foreign", lastName: "Child", roomId: otherRoom.id as string });
    await queryRun(
      `INSERT INTO contact (id, child_id, full_name, relationship, email, is_pickup, is_emergency)
       VALUES (?, ?, ?, 'parent', ?, 0, 0)`,
      `contact-${String(foreignChild.id)}`,
      String(foreignChild.id),
      "Nouran Hisham",
      sharedEmail
    );

    // Act: run the migration.
    await ensureSchema();

    // Assert: the foreign child is never linked, the own-centre child is.
    const linked = await familyMemberRows();
    expect(linked).toContain(String(childA.id));
    expect(linked).not.toContain(String(foreignChild.id));

    const visible = (await store.familiesForAccount(parent.id as string)).map((c) => String(c.id));
    expect(visible).toEqual([String(childA.id)]);
  });

  it("runtime auto-link does not grant cross-institute access (KID-142 defect, live in prod)", async () => {
    // The migration is not involved here. This is a single addContact at a
    // second centre, which is the ordinary way staff record a new child. It
    // reproduced on shipped master 1971f34, so the leak does not wait for 0018
    // or 0019: a staff member typing an existing parent's address at another
    // centre hands that parent access to the other centre's child.
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const sharedEmail = "runtime-leak@example.com";
    await store.createInvite(iid, String(childA.id), sharedEmail, "SUNSHINE-6", "parent");
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(parent.id as string, String(childA.id), "parent");

    const otherInstitute = await store.seedInstitute({ name: "Other Center" });
    const otherRoom = await store.createRoom(otherInstitute.id as string, "Other Room", 10);
    const foreignChild = await store.createChild({ instituteId: otherInstitute.id as string, firstName: "Foreign", lastName: "Child", roomId: otherRoom.id as string });

    // Act: one addContact at the other centre. No ensureSchema, no migration.
    await store.addContact({ childId: String(foreignChild.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });

    // Assert: the parent must not gain access across the tenant boundary.
    const links = (await queryAll("SELECT child_id FROM family_member WHERE account_id = ?", String(parent.id))).map((r) => String(r.child_id));
    expect(links).toEqual([String(childA.id)]);
    expect(links).not.toContain(String(foreignChild.id));
  });

  it("still backfills a same-email sibling inside the account's own centre", async () => {
    // Arrange: two children at the same centre, no contact-create trigger left.
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const sharedEmail = "same-centre@example.com";
    await store.createInvite(iid, String(childA.id), sharedEmail, "SUNSHINE-8", "parent");
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    await store.addContact({ childId: String(childB.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(parent.id as string, String(childA.id), "parent");

    // Act
    await ensureSchema();

    // Assert: the reported defect is fixed and no duplicate row appears.
    const visible = (await store.familiesForAccount(parent.id as string)).map((c) => String(c.id)).sort();
    expect(visible).toEqual([String(childA.id), String(childB.id)].sort());
  });

  it("is idempotent across repeated runs", async () => {
    const childA = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const childB = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomB });
    const sharedEmail = "idempotent@example.com";
    await store.createInvite(iid, String(childA.id), sharedEmail, "SUNSHINE-7", "parent");
    await store.addContact({ childId: String(childA.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    await store.addContact({ childId: String(childB.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(parent.id as string, String(childA.id), "parent");

    await ensureSchema();
    const first = (await store.familiesForAccount(parent.id as string)).map((c) => String(c.id)).sort();

    // Act: a second application must not duplicate or drop anything.
    await ensureSchema();
    const second = (await store.familiesForAccount(parent.id as string)).map((c) => String(c.id)).sort();

    // Assert
    expect(second).toEqual(first);
    expect(second).toEqual([String(childA.id), String(childB.id)].sort());
  });
});
