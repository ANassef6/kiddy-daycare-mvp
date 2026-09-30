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
//
// KID-149: the first version of that migration carried no institute predicate
// at all, so it linked a parent to every same-email child at every centre. The
// backfill now derives the institutes an account belongs to — an invite
// addressed to it, or a family link it already holds — and creates nothing
// outside that set. Every fixture here therefore registers its parent the way
// the product does, because `createAccount()` on its own leaves no tenancy
// evidence, and an account with no evidence belongs to no centre. That
// zero-link edge case is asserted, not left implicit.

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

/** The daycare invites a parent for one child at one centre and the parent
 *  activates the code — the only way a parent account comes into existence
 *  (registerAction refuses self-service registration). What survives is an
 *  `invite` row keyed to the address plus, when `link` is set, the family link
 *  registerAction writes for the invited child. Those artefacts are the
 *  first-class evidence the backfill uses to decide which institutes the account
 *  belongs to.
 */
async function parentViaInvite(opts: {
  email: string;
  instituteId: string;
  childId: string;
  fullName?: string;
  role?: string;
  /** Defaults to false: the invite row is already enough tenancy evidence, and
   *  leaving the link out keeps the backfill responsible for every child. */
  link?: boolean;
}) {
  const code = `code-${Math.random().toString(36).slice(2, 10)}`;
  await store.createInvite(opts.instituteId, opts.childId, opts.email, code, opts.role ?? "parent");
  const account = await createAccount({
    email: opts.email,
    password: "x",
    fullName: opts.fullName ?? "Nouran Hisham",
    role: "parent",
  });
  if (opts.link) await store.linkFamily(account.id as string, opts.childId, opts.role ?? "parent");
  return account;
}

async function familyRows(accountId: string): Promise<{ child_id: string; role: string }[]> {
  const rows = await queryAll(
    "SELECT child_id, role FROM family_member WHERE account_id = ? ORDER BY child_id",
    accountId
  );
  return rows.map((r) => ({ child_id: String(r.child_id), role: String(r.role) }));
}

/** A second tenant: its own institute, its own room, no relationship to the
 *  first one. */
async function secondInstitute(): Promise<{ id: string; roomId: string }> {
  const other = await store.seedInstitute({ name: "Other Center" });
  const room = await store.createRoom(other.id as string, "Other Room", 10);
  return { id: String(other.id), roomId: String(room.id) };
}

async function child(instituteId: string, roomId: string, firstName: string, lastName: string) {
  return store.createChild({ instituteId, firstName, lastName, roomId });
}

describe("KID-146 backfill of pre-existing same-email sibling links", () => {
  // The acceptance case, reproduced as it actually happens: the parent activated
  // an invite for the first child, and the sibling was already on file with the
  // same address but never linked.
  it("links children whose contact predates the auto-link so the parent sees them", async () => {
    const childA = await child(iid, roomA, "Becca", "Nassef");
    const childB = await child(iid, roomB, "Mikael", "Nassef");
    const sharedEmail = "nouran@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    await legacyContact({ childId: String(childB.id), email: sharedEmail });
    const parent = await parentViaInvite({
      email: sharedEmail,
      instituteId: iid,
      childId: String(childA.id),
      link: true,
    });

    // Before the backfill the parent sees only the child they were invited for —
    // the reported symptom.
    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id))).toEqual([
      String(childA.id),
    ]);

    await ensureSchema();

    const family = await store.familiesForAccount(parent.id as string);
    expect(family.map((c) => String(c.id)).sort()).toEqual([String(childA.id), String(childB.id)].sort());
    expect(await familyRows(parent.id as string)).toEqual([
      { child_id: String(childA.id), role: "parent" },
      { child_id: String(childB.id), role: "parent" },
    ]);
  });

  it("is re-runnable and never creates a duplicate row", async () => {
    const childA = await child(iid, roomA, "Becca", "Nassef");
    const childB = await child(iid, roomB, "Mikael", "Nassef");
    const sharedEmail = "rerun@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    await legacyContact({ childId: String(childB.id), email: sharedEmail });
    const parent = await parentViaInvite({ email: sharedEmail, instituteId: iid, childId: String(childA.id) });

    await ensureSchema();
    await ensureSchema();
    await ensureSchema();

    expect(await familyRows(parent.id as string)).toHaveLength(2);
    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id)).sort()).toEqual(
      [String(childA.id), String(childB.id)].sort()
    );
  });

  it("uses the contact relationship as the link role", async () => {
    const childA = await child(iid, roomA, "Becca", "Nassef");
    const childB = await child(iid, roomB, "Mikael", "Nassef");
    const sharedEmail = "roles@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail, relationship: "family" });
    await legacyContact({ childId: String(childB.id), email: sharedEmail, relationship: "pickup" });
    const parent = await parentViaInvite({ email: sharedEmail, instituteId: iid, childId: String(childA.id) });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual([
      { child_id: String(childA.id), role: "family" },
      { child_id: String(childB.id), role: "pickup" },
    ]);
  });

  it("matches the address case-insensitively and ignores surrounding whitespace", async () => {
    const childA = await child(iid, roomA, "Becca", "Nassef");
    const childB = await child(iid, roomB, "Mikael", "Nassef");
    await legacyContact({ childId: String(childA.id), email: "  Nouran@Example.com  " });
    await legacyContact({ childId: String(childB.id), email: "NOURAN@EXAMPLE.COM" });
    // The invite is written lowercased by createInvite, like every real one.
    const parent = await parentViaInvite({
      email: "nouran@example.com",
      instituteId: iid,
      childId: String(childA.id),
    });

    await ensureSchema();

    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id)).sort()).toEqual(
      [String(childA.id), String(childB.id)].sort()
    );
  });

  it("never grants a non-parent account family access", async () => {
    const childA = await child(iid, roomA, "Becca", "Nassef");
    const sharedEmail = "carer@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    const staffAccount = await createAccount({ email: sharedEmail, password: "x", fullName: "Carer", role: "staff" });
    // Defence in depth: role can be corrected after the account was created.
    await queryRun("UPDATE account SET role = 'staff' WHERE id = ?", String(staffAccount.id));

    await ensureSchema();

    expect(await familyRows(String(staffAccount.id))).toEqual([]);
  });

  it("ignores contacts with no address and addresses nobody owns", async () => {
    const childA = await child(iid, roomA, "Becca", "Nassef");
    const childB = await child(iid, roomB, "Mikael", "Nassef");
    await legacyContact({ childId: String(childA.id), email: null, name: "Walk-in Guardian" });
    await legacyContact({ childId: String(childB.id), email: "   ", name: "Blank Address" });
    const parent = await parentViaInvite({
      email: "nouran@example.com",
      instituteId: iid,
      childId: String(childA.id),
    });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual([]);
  });

  it("does not let a contact at one centre link a child that has no contact of its own", async () => {
    const other = await secondInstitute();
    const sharedEmail = "two-centres@example.com";

    // The shared address exists only on a child at the home institute.
    const homeChild = await child(iid, roomA, "Becca", "Nassef");
    await legacyContact({ childId: String(homeChild.id), email: sharedEmail });

    // The other centre's child has a different guardian, and no parent account.
    const otherChild = await child(other.id, other.roomId, "Stranger", "Kid");
    await legacyContact({ childId: String(otherChild.id), email: "someone-else@example.com" });

    const parent = await parentViaInvite({
      email: sharedEmail,
      instituteId: iid,
      childId: String(homeChild.id),
    });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual([{ child_id: String(homeChild.id), role: "parent" }]);
  });

  // ---------- KID-149: institute scoping ----------

  // The reported defect, as an acceptance criterion: two institutes, one shared
  // parent address. The account is on file only at the first centre, so the
  // other centre's child must stay unlinked while the first centre's child is
  // linked.
  it("never links a same-email child at an institute the account is not on file at", async () => {
    const other = await secondInstitute();
    const sharedEmail = "two-sites@example.com";

    const homeChild = await child(iid, roomA, "Becca", "Nassef");
    const foreignChild = await child(other.id, other.roomId, "Mikael", "Nassef");
    // The same address is typed on a child at each centre.
    await legacyContact({ childId: String(homeChild.id), email: sharedEmail });
    await legacyContact({ childId: String(foreignChild.id), email: sharedEmail });

    // The account belongs to the home centre only.
    const parent = await parentViaInvite({
      email: sharedEmail,
      instituteId: iid,
      childId: String(homeChild.id),
    });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual([{ child_id: String(homeChild.id), role: "parent" }]);
    const allLinked = await queryAll(
      "SELECT child_id FROM family_member WHERE child_id IN (?, ?)",
      String(homeChild.id),
      String(foreignChild.id)
    );
    expect(allLinked.map((r) => String(r.child_id))).not.toContain(String(foreignChild.id));
    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id))).toEqual([
      String(homeChild.id),
    ]);
  });

  // The same scenario, but the daycare genuinely onboarded the parent at both
  // centres. The rule is a union, not a single home centre, so both children are
  // linked — one profile across centres is the behaviour the product intends.
  // The outcome is per-child and never depends on row order.
  it("links at every institute the account is on file at, and only those", async () => {
    const other = await secondInstitute();
    const sharedEmail = "both-sites@example.com";

    const homeChild = await child(iid, roomA, "Becca", "Nassef");
    const awayChild = await child(other.id, other.roomId, "Mikael", "Nassef");
    const strangerChild = await child(iid, roomB, "Mikael", "Nassef");
    await legacyContact({ childId: String(homeChild.id), email: sharedEmail });
    await legacyContact({ childId: String(awayChild.id), email: sharedEmail });
    // Same address, same centre the parent is on file at, but a child whose own
    // contact does not carry it — the sibling path never matches these.
    await legacyContact({ childId: String(strangerChild.id), email: "nobody@example.com" });

    const parent = await parentViaInvite({
      email: sharedEmail,
      instituteId: iid,
      childId: String(homeChild.id),
    });
    // Second centre: an invite addressed to the same parent, still pending.
    await store.createInvite(other.id, String(awayChild.id), sharedEmail, "other-centre-1", "parent");

    await ensureSchema();

    const linked = (await familyRows(parent.id as string)).map((r) => r.child_id).sort();
    expect(linked).toEqual([String(homeChild.id), String(awayChild.id)].sort());
  });

  // The invite is only one of the two sources. A parent whose children were
  // enrolled before the invite flow existed has the family link and no invite.
  it("derives the institute from an existing family link when there is no invite", async () => {
    const childA = await child(iid, roomA, "Becca", "Nassef");
    const childB = await child(iid, roomB, "Mikael", "Nassef");
    const sharedEmail = "linked-only@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    await legacyContact({ childId: String(childB.id), email: sharedEmail });
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "No Invite", role: "parent" });
    await store.linkFamily(parent.id as string, String(childA.id), "parent");

    expect((await queryAll("SELECT id FROM invite WHERE email = ?", sharedEmail))).toHaveLength(0);

    await ensureSchema();

    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id)).sort()).toEqual(
      [String(childA.id), String(childB.id)].sort()
    );
  });

  // The zero-link edge case, stated in the migration header and pinned here: an
  // address with no invite and no link has no tenancy evidence, so guessing an
  // institute from it would be the very thing the migration must not do.
  it("creates nothing for an account with neither an invite nor a link", async () => {
    const sharedEmail = "no-evidence@example.com";

    const childA = await child(iid, roomA, "Becca", "Nassef");
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    // The account exists and owns the address, but nothing ties it to a centre.
    const parent = await createAccount({ email: sharedEmail, password: "x", fullName: "No Evidence", role: "parent" });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual([]);
    expect(await store.familiesForAccount(parent.id as string)).toEqual([]);

    // The link appears through the application's own path, on a daycare action
    // at the real centre — not from the backfill.
    await store.createInvite(iid, String(childA.id), sharedEmail, "welcome-1", "parent");
    await store.addContact({
      childId: String(childA.id),
      fullName: "Nouran Hisham",
      relationship: "parent",
      email: sharedEmail,
      isPickup: false,
      isEmergency: false,
    });
    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id))).toEqual([
      String(childA.id),
    ]);
  });

  // Insert-only: a role an admin set deliberately must survive the backfill.
  it("leaves an existing family link's role untouched", async () => {
    const childA = await child(iid, roomA, "Becca", "Nassef");
    const childB = await child(iid, roomB, "Mikael", "Nassef");
    const sharedEmail = "downgraded@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    await legacyContact({ childId: String(childB.id), email: sharedEmail });
    const parent = await parentViaInvite({
      email: sharedEmail,
      instituteId: iid,
      childId: String(childA.id),
      role: "pickup",
    });
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
    const childA = await child(iid, roomA, "Becca", "Nassef");
    const sharedEmail = "disagree@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail, relationship: "no_access" });
    await legacyContact({ childId: String(childA.id), email: sharedEmail, relationship: "parent" });
    const parent = await parentViaInvite({ email: sharedEmail, instituteId: iid, childId: String(childA.id) });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual([{ child_id: String(childA.id), role: "parent" }]);
  });

  // A value outside the KID-112 enum must not trip the CHECK constraint that
  // guards family_member.role; it falls back to 'parent' like the runtime does.
  it("falls back to the parent role for a relationship outside the enum", async () => {
    const childA = await child(iid, roomA, "Becca", "Nassef");
    const sharedEmail = "legacy-text@example.com";
    await queryRun("UPDATE contact SET relationship = 'Grandmother' WHERE child_id = ?", String(childA.id));
    await legacyContact({ childId: String(childA.id), email: sharedEmail, relationship: "Mother" });
    const parent = await parentViaInvite({ email: sharedEmail, instituteId: iid, childId: String(childA.id) });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual([{ child_id: String(childA.id), role: "parent" }]);
  });

  // familiesForAccount filters c.active = 1, so a withdrawn child is linked but
  // invisible, and access returns without a gap if the child is reactivated.
  it("links a withdrawn child without making it visible, and restores it on reactivation", async () => {
    const childA = await child(iid, roomA, "Becca", "Nassef");
    const sharedEmail = "withdrawn@example.com";
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    await queryRun("UPDATE child SET active = 0 WHERE id = ?", String(childA.id));
    const parent = await parentViaInvite({ email: sharedEmail, instituteId: iid, childId: String(childA.id) });

    await ensureSchema();

    expect(await familyRows(parent.id as string)).toHaveLength(1);
    expect(await store.familiesForAccount(parent.id as string)).toEqual([]);

    await queryRun("UPDATE child SET active = 1 WHERE id = ?", String(childA.id));
    expect((await store.familiesForAccount(parent.id as string)).map((c) => String(c.id))).toEqual([String(childA.id)]);
  });

  // The backfill must compose with the KID-142 runtime path, not race it.
  it("stays consistent when the KID-142 contact path also runs", async () => {
    const childA = await child(iid, roomA, "Becca", "Nassef");
    const childB = await child(iid, roomB, "Mikael", "Nassef");
    const sharedEmail = "both-paths@example.com";
    const parent = await parentViaInvite({ email: sharedEmail, instituteId: iid, childId: String(childA.id) });

    // Legacy contact on A, then the live addContact() path on B.
    await legacyContact({ childId: String(childA.id), email: sharedEmail });
    await store.addContact({ childId: String(childB.id), fullName: "Nouran Hisham", relationship: "parent", email: sharedEmail, isPickup: false, isEmergency: false });

    // The runtime path already linked both; the backfill must add nothing.
    expect(await familyRows(parent.id as string)).toHaveLength(2);

    await ensureSchema();

    const family = await store.familiesForAccount(parent.id as string);
    expect(family.map((c) => String(c.id)).sort()).toEqual([String(childA.id), String(childB.id)].sort());
    expect(await familyRows(parent.id as string)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// KID-149: the repair half, for a database on which the unscoped 0018 ran.
//
// 0018 is skipped by filename once it is in the ledger, so editing it cannot
// undo what it already wrote — that is what 0019 is for. These tests reproduce
// the post-0018 state by writing the rows that version actually wrote (a 32-char
// lowercase hex id, the md5(...) expression 0018 mints and nothing else in the
// codebase does) and then re-running the schema, which is how the SQLite path
// applies migrations: ensureSchema() re-runs sqliteSchema() on every process
// start, so the repair runs again and is expected to be idempotent.
// ---------------------------------------------------------------------------

/** A row as the unscoped 0018 wrote it: hex id, taken from the same address at
 *  a centre the account has no association with. */
async function badRow(opts: { accountId: string; childId: string; role?: string }): Promise<string> {
  const id = Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  await queryRun(
    `INSERT INTO family_member (id, account_id, child_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
    id,
    opts.accountId,
    opts.childId,
    opts.role ?? "parent",
    LEGACY_AT
  );
  return id;
}

/** A row as the *application* wrote it: uid() always contains a hyphen, so it is
 *  never in the repair's scope however it looks. */
async function appRow(opts: { accountId: string; childId: string; role?: string }): Promise<string> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await queryRun(
    `INSERT INTO family_member (id, account_id, child_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
    id,
    opts.accountId,
    opts.childId,
    opts.role ?? "parent",
    LEGACY_AT
  );
  return id;
}

async function anyRow(accountId: string, childId: string): Promise<{ id: string; role: string } | undefined> {
  return queryGet("SELECT id, role FROM family_member WHERE account_id = ? AND child_id = ?", accountId, childId) as any;
}

describe("KID-149 repair of the unscoped 0018 on an already-applied database", () => {
  it("removes the cross-institute grant and keeps the in-institute link, row for row", async () => {
    const other = await secondInstitute();
    const home = await child(iid, roomA, "Becca", "Nassef");
    const foreign = await child(other.id, other.roomId, "Mikael", "Nassef");
    const sharedEmail = "repair-shared@example.com";
    const parent = await parentViaInvite({ email: sharedEmail, instituteId: iid, childId: String(home.id) });

    // What the unscoped 0018 wrote: both children, linked to the same address.
    await legacyContact({ childId: String(home.id), email: sharedEmail });
    await legacyContact({ childId: String(foreign.id), email: sharedEmail });
    const goodId = await badRow({ accountId: parent.id as string, childId: String(home.id) });
    const badId = await badRow({ accountId: parent.id as string, childId: String(foreign.id) });

    await ensureSchema(); // the repair runs, exactly as it would on a restart

    expect(await anyRow(parent.id as string, String(foreign.id))).toBeUndefined();
    const kept = await anyRow(parent.id as string, String(home.id));
    // The sibling fix the board user is waiting on survives untouched: not
    // re-pointed, not re-created under a new id, not re-roled.
    expect(kept?.id).toBe(goodId);
    expect(kept?.role).toBe("parent");
    expect(badId).not.toBe(goodId);
  });

  it("never touches a link the application made, even one that looks the same", async () => {
    const other = await secondInstitute();
    const foreign = await child(other.id, other.roomId, "Mikael", "Nassef");
    const sharedEmail = "app-row@example.com";
    // This parent is a real parent at the first centre, invited there, and holds
    // a link at the second — so the row is legitimate and must survive.
    const home = await child(iid, roomA, "Becca", "Nassef");
    const parent = await parentViaInvite({ email: sharedEmail, instituteId: iid, childId: String(home.id) });
    await legacyContact({ childId: String(home.id), email: sharedEmail });
    await legacyContact({ childId: String(foreign.id), email: sharedEmail });
    await appRow({ accountId: parent.id as string, childId: String(home.id) });
    const keepId = await appRow({ accountId: parent.id as string, childId: String(foreign.id) });

    await ensureSchema();

    expect((await anyRow(parent.id as string, String(foreign.id)))?.id).toBe(keepId);
    expect(await anyRow(parent.id as string, String(home.id))).toBeDefined();
  });

  it("does not let two bad rows at one centre justify each other", async () => {
    const other = await secondInstitute();
    const home = await child(iid, roomA, "Becca", "Nassef");
    const foreignA = await child(other.id, other.roomId, "Mikael", "Nassef");
    const foreignB = await child(other.id, other.roomId, "Ida", "Nassef");
    const sharedEmail = "pair@example.com";
    const parent = await parentViaInvite({ email: sharedEmail, instituteId: iid, childId: String(home.id) });

    for (const c of [home, foreignA, foreignB]) await legacyContact({ childId: String(c.id), email: sharedEmail });
    await badRow({ accountId: parent.id as string, childId: String(home.id) });
    // Two children at the *same* other centre, both granted by the unscoped
    // 0018. Neither is evidence the account belongs there.
    await badRow({ accountId: parent.id as string, childId: String(foreignA.id) });
    await badRow({ accountId: parent.id as string, childId: String(foreignB.id) });
    expect(await familyRows(parent.id as string)).toHaveLength(3);

    await ensureSchema();

    expect((await familyRows(parent.id as string)).map((r) => r.child_id)).toEqual([String(home.id)]);
  });

  it("keeps a parent who is on file at both centres linked at both", async () => {
    const other = await secondInstitute();
    const home = await child(iid, roomA, "Becca", "Nassef");
    const foreign = await child(other.id, other.roomId, "Mikael", "Nassef");
    const sharedEmail = "two-centres@example.com";
    const parent = await parentViaInvite({ email: sharedEmail, instituteId: iid, childId: String(home.id) });
    // A second invite at the other centre is first-class evidence there, so the
    // link 0018 wrote there is legitimate after all. The invite row is the whole
    // point: the same address, enrolled again elsewhere.
    await store.createInvite(other.id, String(foreign.id), sharedEmail, `code-${Math.random().toString(36).slice(2, 10)}`, "parent");
    await legacyContact({ childId: String(home.id), email: sharedEmail });
    await legacyContact({ childId: String(foreign.id), email: sharedEmail });
    await badRow({ accountId: parent.id as string, childId: String(home.id) });
    await badRow({ accountId: parent.id as string, childId: String(foreign.id) });

    await ensureSchema();

    expect((await familyRows(parent.id as string)).map((r) => r.child_id).sort()).toEqual(
      [String(home.id), String(foreign.id)].sort()
    );
  });

  it("leaves a contact with no address alone", async () => {
    const other = await secondInstitute();
    const home = await child(iid, roomA, "Becca", "Nassef");
    const foreign = await child(other.id, other.roomId, "Mikael", "Nassef");
    const sharedEmail = "blank-contact@example.com";
    const parent = await parentViaInvite({ email: sharedEmail, instituteId: iid, childId: String(home.id) });
    await legacyContact({ childId: String(home.id), email: sharedEmail });
    await legacyContact({ childId: String(foreign.id), email: null });

    await ensureSchema();

    const family = await store.familiesForAccount(parent.id as string);
    expect(family.map((c) => String(c.id))).toEqual([String(home.id)]);
  });

  it("is idempotent: running the repair twice changes nothing", async () => {
    const other = await secondInstitute();
    const home = await child(iid, roomA, "Becca", "Nassef");
    const foreign = await child(other.id, other.roomId, "Mikael", "Nassef");
    const sharedEmail = "twice@example.com";
    const parent = await parentViaInvite({ email: sharedEmail, instituteId: iid, childId: String(home.id) });
    await legacyContact({ childId: String(home.id), email: sharedEmail });
    await legacyContact({ childId: String(foreign.id), email: sharedEmail });
    await badRow({ accountId: parent.id as string, childId: String(home.id) });
    await badRow({ accountId: parent.id as string, childId: String(foreign.id) });

    await ensureSchema();
    const once = await familyRows(parent.id as string);
    await ensureSchema();
    await ensureSchema();

    expect(await familyRows(parent.id as string)).toEqual(once);
    expect(once.map((r) => r.child_id)).toEqual([String(home.id)]);
  });
});
