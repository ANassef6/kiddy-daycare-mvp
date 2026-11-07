// KID-160: the sibling auto-link must not let one contact row silently rewrite
// the role a parent account already holds.
//
// The delivered engine had no precedence and no ORDER BY: the role of whichever
// contact row came back LAST was written to family_member by linkFamily's
// unconditional UPDATE, so a weaker contact (pickup, family, no_access) replaced
// the parent role a reconcile had just granted. One-child families could lose
// /child entirely, and the same staff edit did nothing in a two-child family —
// the blast radius depended on the shape of the family. 0019's insert-only
// backfill (`ON CONFLICT (account_id, child_id) DO NOTHING`) could not repair a
// role the runtime had already written, so the downgrade was permanent.
//
// The fix pins the runtime to the migration's own rule (0019 step 2):
//   parent > family > pickup > no_access, one row per (account_id, child_id).
// A reconcile resolves the role per child under that ranking and writes it
// insert-or-upgrade-only, so a weaker contact never downgrades and a stronger
// contact still upgrades.
//
// Mirror of the KID-149 harness: local SQLite, no network, no production writes.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { createAccount } from "@/lib/auth";
import { ensureSchema, queryAll, queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

let iid: string;
let roomA: string;

const EMAIL = "kid-160@example.com";

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
});

type LinkRoles = Record<string, string>;

async function linkRolesForAccount(accountId: string): Promise<LinkRoles> {
  const rows = await queryAll("SELECT child_id, role FROM family_member WHERE account_id = ?", accountId);
  const roles: LinkRoles = {};
  for (const r of rows) roles[String(r.child_id)] = String(r.role ?? "");
  return roles;
}

async function contactIdForChild(childId: string): Promise<string> {
  return String((await queryGet("SELECT id FROM contact WHERE child_id = ?", childId))!.id);
}

describe("KID-160 sibling auto-link role precedence", () => {
  it("a plain weaker addContact never downgrades a parent link (issue repro)", async () => {
    // Arrange — the exact shape from the issue: two children at the same centre
    // sharing the parent address; child 2 already linked as parent.
    const child1 = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const child2 = await store.createChild({ instituteId: iid, firstName: "Mikael", lastName: "Nassef", roomId: roomA });
    await store.createInvite(iid, String(child1.id), EMAIL, "K160-REPRO", "parent");
    await store.addContact({ childId: String(child1.id), fullName: "Nouran Hisham", relationship: "parent", email: EMAIL, isPickup: false, isEmergency: false });
    const parent = await createAccount({ email: EMAIL, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(parent.id as string, String(child1.id), "parent");
    await store.addContact({ childId: String(child2.id), fullName: "Nouran Hisham", relationship: "parent", email: EMAIL, isPickup: false, isEmergency: false });

    expect(await linkRolesForAccount(String(parent.id))).toEqual({
      [String(child1.id)]: "parent",
      [String(child2.id)]: "parent",
    });

    // Act — no edit, no migration, no ensureSchema: one weaker contact on the
    // same child. The delivered engine stored `pickup` on child 2.
    await store.addContact({ childId: String(child2.id), fullName: "Nouran Hisham", relationship: "pickup", email: EMAIL, isPickup: false, isEmergency: false });

    // Assert — a weaker contact never downgrades a link it does not outrank.
    expect(await linkRolesForAccount(String(parent.id))).toEqual({
      [String(child1.id)]: "parent",
      [String(child2.id)]: "parent",
    });
  });

  it("a stronger contact still upgrades an existing weaker link", async () => {
    const child1 = await store.createChild({ instituteId: iid, firstName: "Nael", lastName: "Nassef", roomId: roomA });
    await store.createInvite(iid, String(child1.id), EMAIL, "K160-UP", "parent");
    await store.addContact({ childId: String(child1.id), fullName: "Nouran Hisham", relationship: "pickup", email: EMAIL, isPickup: false, isEmergency: false });
    const parent = await createAccount({ email: EMAIL, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(parent.id as string, String(child1.id), "pickup");
    expect(await linkRolesForAccount(String(parent.id))).toEqual({ [String(child1.id)]: "pickup" });

    // Act — a parent contact now exists for the same address on the same child.
    await store.addContact({ childId: String(child1.id), fullName: "Nouran Hisham", relationship: "parent", email: EMAIL, isPickup: false, isEmergency: false });

    // Assert — strongest contact wins under the 0019 ranking …
    expect(await linkRolesForAccount(String(parent.id))).toEqual({ [String(child1.id)]: "parent" });
    // … and the account-wide access follows it.
    expect(await store.familyAccessForAccount(String(parent.id))).toBe("parent");
  });

  it("a one-child no_access edit does not remove /child access", async () => {
    // Arrange — one-child family: this is the exact lockout shape. A reconcile
    // granting access is one thing; a reconcile silently removing access a
    // parent already holds left the parent denied on their own child while
    // familiesForAccount still returned the row.
    const child1 = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    await store.createInvite(iid, String(child1.id), EMAIL, "K160-LOCK", "parent");
    await store.addContact({ childId: String(child1.id), fullName: "Nouran Hisham", relationship: "parent", email: EMAIL, isPickup: false, isEmergency: false });
    const parent = await createAccount({ email: EMAIL, password: "x", fullName: "Nouran Hisham", role: "parent" });
    await store.linkFamily(parent.id as string, String(child1.id), "parent");
    expect((await store.familiesForAccount(String(parent.id))).length).toBe(1);

    // Act — staff edits the child's ONLY contact from parent to no_access. The
    // reconcile runs over contacts that now say no_access and must not strip
    // the parent link: deliberate downgrades are explicit staff work, never a
    // side effect of a contact edit.
    await store.updateContact(await contactIdForChild(String(child1.id)), {
      fullName: "Nouran Hisham",
      relationship: "no_access",
      email: EMAIL,
      isPickup: false,
      isEmergency: false,
    });

    // Assert — the data layer and the access layer agree, and the parent
    // keeps their own child.
    expect(await linkRolesForAccount(String(parent.id))).toEqual({ [String(child1.id)]: "parent" });
    expect(await store.familyAccessForAccount(String(parent.id))).toBe("parent");
    expect((await store.familiesForAccount(String(parent.id))).length).toBe(1);
  });

  it("runtime result equals the 0019 migration result for the same input", async () => {
    // Arrange — one child per row of the issue's measured matrix, plus the
    // single-prerogative and legacy-text cases. Every child gets the same set
    // of same-address contact rows, inserted directly so nothing fires the
    // runtime while building the input, and both resolvers (migration and
    // runtime) see byte-identical data. One invite is enough: the 0019
    // institute boundary is institute-wide.
    const matrix: Array<{ label: string; relationships: string[]; expectedRole: string }> = [
      { label: "ParentThenNoAccess", relationships: ["parent", "no_access"], expectedRole: "parent" },
      { label: "NoAccessThenParent", relationships: ["no_access", "parent"], expectedRole: "parent" },
      { label: "ParentNoAccessFamily", relationships: ["parent", "no_access", "family"], expectedRole: "parent" },
      { label: "ParentThenPickup", relationships: ["parent", "pickup"], expectedRole: "parent" },
      { label: "FamilyOnly", relationships: ["family"], expectedRole: "family" },
      { label: "NoAccessOnly", relationships: ["no_access"], expectedRole: "no_access" },
      // Legacy free text: writes and ensureSchema normalize contact
      // relationships through the KID-112 mapping first (0016), so "grandmother"
      // reaches both resolvers as canonical `family` — the 0019 CASE's
      // ELSE 'parent' branch is defensive only. Raw-inserted here to prove the
      // engines stay equal across that whole pipeline.
      { label: "LegacyTextOnly", relationships: ["grandmother"], expectedRole: "family" },
    ];

    const matrixChildren: Array<{ childId: string; expectedRole: string }> = [];
    for (const entry of matrix) {
      const child = await store.createChild({ instituteId: iid, firstName: "Matrix", lastName: entry.label, roomId: roomA });
      for (const [i, relationship] of entry.relationships.entries()) {
        await rawInsertContact(String(child.id), relationship, i);
      }
      matrixChildren.push({ childId: String(child.id), expectedRole: entry.expectedRole });
    }
    await store.createInvite(iid, matrixChildren[0].childId, EMAIL, "K160-PARITY", "parent");
    const parent = await createAccount({ email: EMAIL, password: "x", fullName: "Nouran Hisham", role: "parent" });

    // Act A — the migration resolves these contacts.
    await ensureSchema();
    const migrationRoles = await linkRolesForAccount(String(parent.id));

    // Act B — remove what the migration wrote, then let the runtime resolve
    // the identical input.
    await queryRun("DELETE FROM family_member WHERE account_id = ?", String(parent.id));
    expect(Object.keys(await linkRolesForAccount(String(parent.id)))).toHaveLength(0);
    await store.linkSiblingsByParentEmail(String(parent.id), EMAIL, iid);
    const runtimeRoles = await linkRolesForAccount(String(parent.id));

    // Assert — exact matrix, engine value for engine value. This is the
    // assertion that would have caught the defect: no ORDER BY, and the engine
    // would have stored the last-returned row's role on at least the
    // multi-contact children.
    const expected: LinkRoles = {};
    for (const child of matrixChildren) expected[child.childId] = child.expectedRole;
    expect(migrationRoles).toEqual(expected);
    expect(runtimeRoles).toEqual(expected);
  });
});

// Raw contact insert (see KID-149): bypasses addContact so a legacy free-text
// relationship reaches both resolvers as-is instead of being normalized on the
// way in.
async function rawInsertContact(childId: string, relationship: string, index: number): Promise<void> {
  await queryRun(
    `INSERT INTO contact (id, child_id, full_name, relationship, email, is_pickup, is_emergency)
     VALUES (?, ?, 'Nouran Hisham', ?, ?, 0, 0)`,
    `contact-${childId}-${index}`,
    childId,
    relationship,
    EMAIL
  );
}
