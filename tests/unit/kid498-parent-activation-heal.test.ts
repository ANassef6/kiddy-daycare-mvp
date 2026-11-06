// KID-498: parent activation self-heal, and the honest three-state login read.
//
// A parent whose registration created the account but whose child-link step
// failed is left "half-activated": zero family_member rows, invite still
// pending. The old withdrawal read called that state "This account's access
// has been withdrawn" — the Sunshine Daycare lockout of 2026-11-06, fixed
// there by a hand-applied one-row repair. These suites cover the machinery
// that replaces it, against the SQLite data layer the test suite runs on:
//
//   - parentAccountAccessState: the four-state classifier a login gate reads
//     ("active" | "withdrawn" | "activation-incomplete" | "no-access"), and
//     isAccountAccessWithdrawn keeping "withdrawn" for genuine ends only.
//   - healParentActivation: the shared service that finishes the link from
//     the still-pending invite — success, refused heals, role carry, and the
//     cross-tenant guarantees (only the invite's OWN child; a same-email
//     contact at a second centre never leaks, the KID-152 regression).
//   - the 0034 mirror in lib/sqlite-schema.ts: the one-time repair that links
//     the orphans that already exist, plus its idempotence.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { createAccount } from "@/lib/auth";
import { ensureSchema, queryAll, queryGet, queryRun, type Row } from "@/lib/db";
import { seedFixture } from "../helpers";

let iid: string;
let otherIid: string;

// Named once because the suites assert it as an invariant: a refused heal
// (or refused repair) leaves the invite exactly this, never deleted.
const PENDING = "pending";

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const other = await store.seedInstitute({ name: "Maple Foreign Centre" });
  otherIid = String(other.id);
});

async function parentAccount(email: string, fullName = "Parent Account"): Promise<Row> {
  return (await createAccount({ email, password: "pw-123456", fullName, role: "parent" })) as Row;
}

/** An invite the way a daycare issues one, with the knobs the suites need. */
async function invite(opts: {
  instituteId?: string;
  childId: string;
  email: string;
  role?: string;
  code?: string;
  status?: string;
  createdAt?: string;
}): Promise<string> {
  const row = await store.createInvite(
    opts.instituteId ?? iid,
    opts.childId,
    opts.email,
    opts.code ?? `KID-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    opts.role
  );
  const inviteId = String(row.id);
  if (opts.status && opts.status !== PENDING) {
    await queryRun("UPDATE invite SET status = ? WHERE id = ?", opts.status, inviteId);
  }
  if (opts.createdAt) {
    // Raw write: created_at ordering is part of the newest-first rule under test.
    await queryRun("UPDATE invite SET created_at = ? WHERE id = ?", opts.createdAt, inviteId);
  }
  return inviteId;
}

/** Strict lookup — the suites read invite status often enough to share this. */
async function inviteStatus(inviteId: string): Promise<string> {
  const row = await queryGet("SELECT status FROM invite WHERE id = ?", inviteId);
  if (!row) throw new Error(`invite ${inviteId} not found`);
  return String(row.status);
}

async function childAt(
  instituteId: string,
  name: string,
  opts?: { status?: string; active?: number }
): Promise<string> {
  const row = await store.createChild({ instituteId, firstName: name, lastName: "Refaat" });
  const id = String(row.id);
  if (opts?.status || opts?.active !== undefined) {
    await queryRun(
      "UPDATE child SET status = COALESCE(?, status), active = COALESCE(?, active) WHERE id = ?",
      opts?.status ?? null,
      opts?.active ?? null,
      id
    );
  }
  return id;
}

/** A contact row another centre typed for the same email — the shape that
 *  made KID-152 leak when email scans were trusted as tenancy evidence. */
async function foreignContact(childId: string, email: string): Promise<void> {
  await queryRun(
    `INSERT INTO contact (id, child_id, full_name, relationship, phone, email, is_pickup, is_emergency, created_at)
     VALUES (?, ?, 'Shared Parent', 'parent', '', ?, 0, 0, datetime('now'))`,
    `foreign-contact-${Math.random().toString(36).slice(2, 10)}`,
    childId,
    email
  );
}

/** Strict family-link read for one account. */
async function links(accountId: string): Promise<Array<{ child_id: string; role: string }>> {
  return (await queryAll(
    "SELECT child_id, role FROM family_member WHERE account_id = ? ORDER BY child_id",
    accountId
  )) as Array<{ child_id: string; role: string }>;
}

describe("KID-498: parentAccountAccessState — the four-state read", () => {
  it("a linked parent with an active child is active, and the withdrawn check is false", async () => {
    const account = await parentAccount("active@example.com");
    const child = await childAt(iid, "Active Kid");
    await store.linkFamily(account.id, child);
    expect(await store.parentAccountAccessState(account.id)).toBe("active");
    expect(await store.isAccountAccessWithdrawn(account.id)).toBe(false);
  });

  it("links exist but every linked child is withdrawn -> withdrawn (the genuine end)", async () => {
    const account = await parentAccount("gone@example.com");
    const child = await childAt(iid, "Withdrawn Kid", { status: "withdrawn", active: 0 });
    await store.linkFamily(account.id, child);
    expect(await store.parentAccountAccessState(account.id)).toBe("withdrawn");
    expect(await store.isAccountAccessWithdrawn(account.id)).toBe(true);
  });

  it("zero links with a pending invite for the email -> activation-incomplete, NOT withdrawn", async () => {
    const account = await parentAccount("halfdone@example.com");
    const child = await childAt(iid, "Not Yet Linked");
    await invite({ childId: child, email: "halfdone@example.com" });
    expect(await store.parentAccountAccessState(account.id)).toBe("activation-incomplete");
    // The regression that matters: the withdrawal message must not fire on
    // an activation that simply never finished.
    expect(await store.isAccountAccessWithdrawn(account.id)).toBe(false);
  });

  it("zero links and no pending invite -> no-access", async () => {
    const account = await parentAccount("nolinks@example.com");
    expect(await store.parentAccountAccessState(account.id)).toBe("no-access");
    expect(await store.isAccountAccessWithdrawn(account.id)).toBe(false);
  });

  it("a non-parent account is out of scope: null, and staff rules stay theirs", async () => {
    const staff = await createAccount({
      email: "floorstaff@example.com",
      password: "pw-123456",
      fullName: "Floor Staff",
      role: "teacher",
    });
    expect(await store.parentAccountAccessState(String(staff.id))).toBe(null);
    expect(await store.isAccountAccessWithdrawn(String(staff.id))).toBe(false);
  });
});

describe("KID-498: healParentActivation — finishing the link from the pending invite", () => {
  it("links the invite's child, carries the invite's role, and accepts the invite", async () => {
    const account = await parentAccount("resume@example.com");
    const child = await childAt(iid, "Link Me");
    const inviteId = await invite({ childId: child, email: "resume@example.com", role: "parent" });

    const heal = await store.healParentActivation(account.id);
    expect(heal).toMatchObject({ status: "linked", childId: child, inviteId });
    expect(await links(account.id)).toEqual([{ child_id: child, role: "parent" }]);
    expect(await inviteStatus(inviteId)).toBe("accepted");
    // The account is now a normal, active parent — with exactly ONE link.
    expect(await store.parentAccountAccessState(account.id)).toBe("active");
    expect((await links(account.id)).length).toBe(1);
  });

  it("is idempotent: a replayed heal finds no pending invite and adds no rows", async () => {
    const account = await parentAccount("replay@example.com");
    const child = await childAt(iid, "Once Only");
    await invite({ childId: child, email: "replay@example.com" });
    expect((await store.healParentActivation(account.id)).status).toBe("linked");
    expect(await store.healParentActivation(account.id)).toMatchObject({ status: "none" });
    expect((await links(account.id)).length).toBe(1);
  });

  it("carries a non-default invite role (pickup stays pickup, no_access stays no_access)", async () => {
    const account = await parentAccount("pickup@example.com");
    const child = await childAt(iid, "Pickup Kid");
    await invite({ childId: child, email: "pickup@example.com", role: "pickup" });
    expect(await store.healParentActivation(account.id)).toMatchObject({ status: "linked" });
    expect(await links(account.id)).toEqual([{ child_id: child, role: "pickup" }]);

    const account2 = await parentAccount("blocked-role@example.com");
    const child2 = await childAt(iid, "Blocked Kid");
    await invite({ childId: child2, email: "blocked-role@example.com", role: "no_access" });
    expect(await store.healParentActivation(account2.id)).toMatchObject({ status: "linked" });
    expect(await links(account2.id)).toEqual([{ child_id: child2, role: "no_access" }]);
  });

  it("refuses a withdrawn child: no link, invite stays pending, reason child_withdrawn", async () => {
    const account = await parentAccount("refused@example.com");
    const child = await childAt(iid, "Gone Kid", { status: "withdrawn", active: 0 });
    const inviteId = await invite({ childId: child, email: "refused@example.com" });

    const heal = await store.healParentActivation(account.id);
    expect(heal).toMatchObject({ status: "blocked", inviteId, reason: "child_withdrawn" });
    expect(await links(account.id)).toEqual([]);
    expect(await inviteStatus(inviteId)).toBe(PENDING);
    expect(await store.parentAccountAccessState(account.id)).toBe("activation-incomplete");
  });

  it("keeps the tenant boundary: a same-email contact at a second centre never gains a link (KID-152 regression)", async () => {
    const account = await parentAccount("shared@example.com");
    const homeChild = await childAt(iid, "Home Child");
    const foreignChild = await childAt(otherIid, "Foreign Child");
    await foreignContact(foreignChild, "shared@example.com");
    // The heal's authorization is one invite for ONE child at the home centre.
    await invite({ instituteId: iid, childId: homeChild, email: "shared@example.com" });

    const heal = await store.healParentActivation(account.id);
    expect(heal).toMatchObject({ status: "linked", childId: homeChild });
    expect(await links(account.id)).toEqual([{ child_id: homeChild, role: "parent" }]);
    expect(await links(account.id).then(async () => {
      const foreignLinks = await queryAll("SELECT account_id FROM family_member WHERE child_id = ?", foreignChild);
      return foreignLinks.length;
    })).toBe(0);
  });

  it("refuses an invite whose institute disagrees with its child's institute", async () => {
    const account = await parentAccount("mismatch@example.com");
    const child = await childAt(iid, "Wrongly Addressed");
    // The invite claims to come from the foreign centre but names a child at
    // the home centre: damaged data, refused rather than repaired cross-tenant.
    const inviteId = String(
      (
        await store.createInvite(
          otherIid, // the invite claims to come from the foreign centre...
          child, // ...but names a child at the home centre: damaged data.
          "mismatch@example.com",
          "KID-BADMATCH"
        )
      ).id
    );
    const heal = await store.healParentActivation(account.id);
    expect(heal).toMatchObject({ status: "blocked", inviteId, reason: "institute_mismatch" });
    expect(await links(account.id)).toEqual([]);
    expect(await inviteStatus(inviteId)).toBe(PENDING);
  });

  it("the newest pending invite wins when a mailbox has several", async () => {
    const account = await parentAccount("multi@example.com");
    const childB = await childAt(iid, "Newer Invite Child");
    await invite({ childId: await childAt(iid, "Older Invite Child"), email: "multi@example.com", createdAt: "2026-01-01 00:00:00" });
    await invite({ childId: childB, email: "multi@example.com", createdAt: "2026-02-01 00:00:00" });

    const heal = await store.healParentActivation(account.id);
    expect(heal).toMatchObject({ status: "linked", childId: childB });
    expect((await links(account.id)).length).toBe(1);
    const stillPending = await queryGet(
      "SELECT COUNT(*) c FROM invite WHERE email = 'multi@example.com' AND status = 'pending'"
    );
    expect(stillPending && Number((stillPending as { c: number }).c)).toBe(1);
  });

  it("a used invite can never be re-opened by a heal", async () => {
    const account = await parentAccount("used@example.com");
    const child = await childAt(iid, "Spent Invite Kid");
    const inviteId = await invite({ childId: child, email: "used@example.com", status: "accepted" });
    const heal = await store.healParentActivation(account.id);
    expect(heal).toMatchObject({ status: "none" });
    expect(await links(account.id)).toEqual([]);
    expect(await inviteStatus(inviteId)).toBe("accepted");
  });
});

describe("KID-498: the 0034 mirror (lib/sqlite-schema.ts) — the one-time repair", () => {
  it("heals an existing orphan parent from its pending invite, scoped and honest", async () => {
    // Raw pre-repair state, exactly what a failed registration leaves: an
    // account row, no family_member row, a pending invite. A contact at the
    // FOREIGN centre carries the same email (the KID-152 shape) — the repair
    // must match the invite alone.
    const account = await parentAccount("orphan-mirror@example.com");
    const child = await childAt(iid, "Mirror Kid");
    const foreignChild = await childAt(otherIid, "Foreign Kid");
    await foreignContact(foreignChild, "orphan-mirror@example.com");
    const inviteId = await invite({ instituteId: iid, childId: child, email: "orphan-mirror@example.com" });

    // ensureSchema() re-runs sqliteSchema() with no ledger, so it is the
    // mirror's trigger.
    await ensureSchema();

    expect(await links(account.id)).toEqual([{ child_id: child, role: "parent" }]);
    expect(await inviteStatus(inviteId)).toBe("accepted");
    // The foreign centre's same-email child never gained a link.
    expect(await queryAll("SELECT account_id FROM family_member WHERE child_id = ?", foreignChild)).toEqual([]);
  });

  it("is idempotent: re-running the mirror changes neither links nor invites", async () => {
    const account = await parentAccount("idem-mirror@example.com");
    const child = await childAt(iid, "Idem Kid");
    await invite({ instituteId: iid, childId: child, email: "idem-mirror@example.com" });

    await ensureSchema();
    const beforeLinks = await links(account.id);
    const beforeInvites = (await queryAll("SELECT id, status FROM invite WHERE email = 'idem-mirror@example.com' ORDER BY id")) as Array<Row>;
    expect(beforeLinks).toHaveLength(1);

    await ensureSchema();
    await ensureSchema();

    expect(await links(account.id)).toEqual(beforeLinks);
    expect((await queryAll("SELECT id, status FROM invite WHERE email = 'idem-mirror@example.com' ORDER BY id")) as Array<Row>).toEqual(beforeInvites);
  });

  it("leaves already-linked accounts (and their roles) alone, and refuses withdrawn children", async () => {
    // Already linked with a deliberate role, plus a stale second-child invite:
    // the repair must not re-derive or downgrade anything.
    const linked = await parentAccount("already-linked-mirror@example.com");
    const linkedChild = await childAt(iid, "Deliberate Kid");
    await store.linkFamily(linked.id, linkedChild, "pickup");
    const secondChild = await childAt(iid, "Second Kid");
    await invite({ instituteId: iid, childId: secondChild, email: "already-linked-mirror@example.com" });

    // An orphan whose invite names a withdrawn child stays an orphan.
    const withdrawnParent = await parentAccount("withdrawn-mirror@example.com");
    const withdrawnChild = await childAt(iid, "Mirror Withdrawn Kid", { status: "withdrawn", active: 0 });
    const withdrawnInvite = await invite({ instituteId: iid, childId: withdrawnChild, email: "withdrawn-mirror@example.com" });

    await ensureSchema();

    expect(await links(linked.id)).toEqual([{ child_id: linkedChild, role: "pickup" }]);
    expect(await queryAll(
      "SELECT account_id FROM family_member WHERE child_id = ?",
      secondChild
    )).toEqual([]);
    expect(await links(withdrawnParent.id)).toEqual([]);
    expect(await inviteStatus(withdrawnInvite)).toBe(PENDING);
  });
});
