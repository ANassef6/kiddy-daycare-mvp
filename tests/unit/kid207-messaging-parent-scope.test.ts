// KID-207 regression tests: cross-centre leak on /portal/messages.
//
// Production observation: a Maple Grove parent (family, children — everything
// at centre 2) opened /portal/messages and got Sunshine's composer: Sunshine's
// classroom channels and Sunshine's full parent list as recipient options.
// Two composed defects:
//   - the page pinned an institute that was not the viewer's (the
//     pre-KID-199.3 "first institute" rule), and
//   - the messaging scope treated a parent's missing staff row as "unscoped
//     admin-like", so every room and every parent of the pinned institute was
//     offered.
// The page pin is session-resolved now (KID-199.3), but a parent's pin can
// STILL resolve to another centre through their tenancy set — a stale invite
// row makes Sunshine (created first) the primary — so the scope part must be
// derived from family data and fail closed, never render the pinned
// institute's full directory.
//
// These tests pin both halves: a parent of centre 2 gets ZERO centre-1 rows
// wherever the pin points, and their own centre's composer shows only the
// rooms and co-room parents their family data says.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createAccount, createSessionToken, type Session } from "@/lib/auth";
import { queryAll, queryGet, queryRun, type Row } from "@/lib/db";
import { createChild, createInvite, createRoom, createStaff, linkFamily, messagingRoomIds, parentAccountsScoped, roomChannelsForAccount, seedInstitute } from "@/lib/store";
import { seedFixture } from "../helpers";

// The page, the action and the tenant resolver read the request head through
// next/headers; the suite injects the cookie per test (kid236/kid246
// harness). No server is spun up.
const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  sessionValue: "" as string,
  host: "" as string,
}));
vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.cookie) entries.cookie = mockState.cookie;
    if (mockState.host) entries.host = mockState.host;
    return new Headers(entries);
  },
  cookies: () => ({ get: (name: string) => (name === "kiddy_sess" ? { value: mockState.sessionValue } : undefined), set: () => undefined }),
}));

let sunshineIid: string;
let mapleIid: string;
let mapleWillows: string;
let mapleOaks: string;
let sunshinePreschool: string;
let mapleParent1: string; // family: Willows child only
let mapleParent2: string; // family: Oaks child only, PLUS a stale Sunshine invite (the qa.kid186 shape)
let mapleParent3: string; // family: Willows child — co-room parent of parent1
let sunshineGrace: string;
let sunshineParent2: string;

beforeEach(async () => {
  await seedFixture();
  // Sunshine is the seeded FIRST institute (its rooms include Toddlers and
  // Preschool), so every legacy rule that misfires lands on Sunshine.
  sunshineIid = String((await queryGet("SELECT id FROM institute ORDER BY created_at LIMIT 1"))!.id);
  sunshinePreschool = String((await queryGet("SELECT id FROM room WHERE institute_id = ? AND name = 'Preschool'", sunshineIid))!.id);
  sunshineGrace = String((await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'"))!.id);

  // A second Sunshine parent account so a Sunshine-parent leak has two
  // searchable names.
  const sunshinePerson = await createAccount({ email: "qa.kid207.sunshine@example.test", password: "x", fullName: "Maple Grove Impostor", role: "parent" });
  const sunshineChild2 = String((await queryGet("SELECT id FROM child WHERE room_id = ? LIMIT 1", sunshinePreschool))!.id);
  await linkFamily(String(sunshinePerson.id), sunshineChild2);
  sunshineParent2 = String(sunshinePerson.id);

  // Centre 2 — the "Maple Grove" of the defect report. Created AFTER
  // Sunshine so tenancy ordering (ORDER BY institute.created_at) favours
  // Sunshine whenever the tenancy set spans both.
  const maple = await seedInstitute({ name: "Maple Grove" });
  mapleIid = String(maple.id);
  const willows = await createRoom(mapleIid, "Willows", 10);
  const oaks = await createRoom(mapleIid, "Oaks", 10);
  mapleWillows = String(willows.id);
  mapleOaks = String(oaks.id);

  const childW = await createChild({ instituteId: mapleIid, firstName: "Fern", lastName: "Elm", roomId: mapleWillows });
  const childO = await createChild({ instituteId: mapleIid, firstName: "Aspen", lastName: "Birch", roomId: mapleOaks });

  const p1 = await createAccount({ email: "qa.kid186.parent@example.test", password: "x", fullName: "Maple Parent One", role: "parent" });
  await linkFamily(String(p1.id), String((childW as Row).id));
  mapleParent1 = String(p1.id);

  const p2 = await createAccount({ email: "qa.kid186.parent2@example.test", password: "x", fullName: "Maple Parent Two", role: "parent" });
  await linkFamily(String(p2.id), String((childO as Row).id));
  // The qa.kid186 tenancy shape: a stale invite at ANOTHER centre ties the
  // parent's tenancy set to Sunshine (created earlier), so the page pin
  // resolves to Sunshine even though all family data is Maple.
  await createInvite(sunshineIid, null, "qa.kid186.parent2@example.test", "MAPLE-CROSS-001");
  mapleParent2 = String(p2.id);

  const p3 = await createAccount({ email: "qa.kid186.parent3@example.test", password: "x", fullName: "Willows Coparent", role: "parent" });
  await linkFamily(String(p3.id), String((childW as Row).id));
  mapleParent3 = String(p3.id);
});

async function signParentIn(accountId: string): Promise<void> {
  const acc = (await queryGet("SELECT id, email, role FROM account WHERE id = ?", accountId)) as {
    id: string;
    email: string;
    role: string;
  };
  const session: Session = { accountId: acc.id, role: String(acc.role), email: String(acc.email), emailConfirmed: true };
  const token = createSessionToken(session);
  mockState.cookie = `kiddy_sess=${token}`;
  mockState.sessionValue = token;
  mockState.host = "";
}

const names = (rows: Row[]): string[] => rows.map((r) => String(r.full_name));
const roomNames = (rows: Row[]): string[] => rows.map((r) => String(r.name));

describe("KID-207 cross-centre fail-closed (a centre-2 parent never gets centre-1 rows)", () => {
  it("a Maple parent scoped against the Sunshine pin sees no Sunshine channels and no Sunshine parents", async () => {
    // The defect report: the composer listed Sunshine's channels + parents
    // for a viewer with zero Sunshine family links.
    expect(names(await parentAccountsScoped(sunshineIid, mapleParent1))).toEqual([]);
    expect(roomNames(await roomChannelsForAccount(sunshineIid, mapleParent1))).toEqual([]);
  });

  it("the converse: a Sunshine parent scoped against the Maple pin sees no Maple rows", async () => {
    expect(names(await parentAccountsScoped(mapleIid, sunshineGrace))).toEqual([]);
    expect(roomNames(await roomChannelsForAccount(mapleIid, sunshineGrace))).toEqual([]);
  });

  it("a stale cross-centre invite never widens the scope: the scope stays family-derived", async () => {
    // parent2 carries a Sunshine invite, so their tenancy set spans both
    // centres. The invite is NOT family data: against Sunshine the scope is
    // still empty, against Maple it is still exactly their child's room.
    expect(await messagingRoomIds(sunshineIid, mapleParent2)).toEqual([]);
    await expect(parentAccountsScoped(sunshineIid, mapleParent2)).resolves.toEqual([]);
    expect(await messagingRoomIds(mapleIid, mapleParent2)).toEqual([mapleOaks]);
    expect(await parentAccountsScoped(mapleIid, mapleParent2)).toEqual([]);
    // parent2's own centre list is their Oaks room, not the Sunshine rooms.
    expect(roomNames(await roomChannelsForAccount(mapleIid, mapleParent2))).toEqual(["Oaks"]);
  });

  it("a parent with no family links at the pinned institute scopes to [] — never to null (unscoped)", async () => {
    // The old defect read "no staff rows" as "unscoped admin-like" and
    // returned NULL — the parent then inherited the full directory of
    // whatever the page pinned. messagingRoomIds never does that for parents.
    expect(await messagingRoomIds(sunshineIid, mapleParent3)).toEqual([]);
    // Sanity: scopedRoomIds (staff semantics) still returns null for the
    // same input — the pin shows messaging is deliberately stricter.
    const { scopedRoomIds } = await import("@/lib/store");
    expect(await scopedRoomIds(sunshineIid, mapleParent3)).toBeNull();
  });
});

describe("KID-207 in-centre scope (the parent's own composer)", () => {
  it("channels are exactly the rooms the parent's children attend, with audience counts", async () => {
    const channels = await roomChannelsForAccount(mapleIid, mapleParent1);
    expect(roomNames(channels)).toEqual(["Willows"]);
    expect(Number(channels[0].parent_count)).toBeGreaterThan(0);
    // Not the sibling Maple room, not the Sunshine rooms.
    expect(roomNames(channels)).not.toContain("Oaks");
    expect(roomNames(channels)).not.toContain("Toddlers");
    expect(roomNames(channels)).not.toContain("Preschool");
  });

  it("recipients are co-room parents only — same centre, same room", async () => {
    const got = names(await parentAccountsScoped(mapleIid, mapleParent1));
    expect(got).toEqual(["Willows Coparent"]);
    // Never the viewer themself, never the Sunshine parents. The Oaks family
    // of the same centre is a different class list.
    expect(got).not.toContain("Maple Parent Two");
    expect(got).not.toContain("Grace Nguyen");
    expect(got).not.toContain("Maple Grove Impostor");
  });

  it("a parent with children in two rooms sees both rooms and both classes", async () => {
    const parentB = String((await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'"))!.id);
    // Grace (Sunshine) has children in Toddlers AND Preschool.
    const channels = roomNames(await roomChannelsForAccount(sunshineIid, parentB)).sort();
    expect(channels).toEqual(["Preschool", "Toddlers"]);
  });

  it("owners and admins keep the unscoped directory of THEIR institute only", async () => {
    // The seeded owner (role 'owner', linked staff row on Sunshine) keeps the
    // full Sunshine list, and never gains Maple rows.
    const ownerAcc = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
    const ownerNames = names(await parentAccountsScoped(sunshineIid, ownerAcc));
    expect(ownerNames).toContain("Grace Nguyen");
    expect(ownerNames).toContain("Maple Grove Impostor");
    expect(ownerNames).not.toContain("Maple Parent One");
    expect(ownerNames).not.toContain("Willows Coparent");
    expect(ownerNames).not.toContain("Maria Lopez"); // never the viewer themself
    const ownerRooms = roomNames(await roomChannelsForAccount(sunshineIid, ownerAcc)).sort();
    expect(ownerRooms).toEqual(["Preschool", "Toddlers"]); // all Sunshine rooms…
    expect(ownerRooms).not.toContain("Willows");
    expect(ownerRooms).not.toContain("Oaks"); // …and none of Maple's
  });

  it("staff room assignment still scopes staff as before (assigned rooms only)", async () => {
    // Maya's shape from the report: a Maple staff row assigned to Willows
    // only must give the Willows channel — on the Maple pin.
    const acc = await createAccount({ email: "maya.kid207.staff@example.test", password: "x", fullName: "Maya Maple", role: "staff" });
    const staff = await createStaff({ instituteId: mapleIid, fullName: "Maya Maple", role: "carer", roomIds: [mapleWillows] });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), String(acc.id));
    expect(roomNames(await roomChannelsForAccount(mapleIid, String(acc.id)))).toEqual(["Willows"]);
    expect(names(await parentAccountsScoped(mapleIid, String(acc.id)))).toEqual(["Maple Parent One", "Willows Coparent"]);
  });
});

describe("KID-207 write boundary: sendComposerAction accepts only the family-scoped set", () => {
  /** Signs `accountId` in and returns the action's redirect target. */
  async function sendComposer(accountId: string, form: FormData): Promise<string | null> {
    await signParentIn(accountId);
    const { sendComposerAction } = await import("@/lib/actions");
    try {
      await sendComposerAction(form);
      return null;
    } catch (err) {
      const digest = String((err as { digest?: unknown })?.digest ?? "");
      if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
      throw err;
    }
  }

  function composerForm(body: string, opts: { channels?: string[]; recipients?: string[] }): FormData {
    const fd = new FormData();
    fd.set("body", body);
    for (const r of opts.channels ?? []) fd.append("channels", r);
    for (const r of opts.recipients ?? []) fd.append("recipients", r);
    return fd;
  }

  const messageCount = async (): Promise<number> => Number((await queryAll("SELECT COUNT(*) c FROM message"))[0].c);

  it("a forged Sunshine channel checkbox is refused with nothing stored", async () => {
    // The write half of C4c: the old scope (null → all rooms of the pin)
    // would have accepted Sunshine room ids and fanned the message out to
    // Sunshine parents/staff.
    const target = await sendComposer(
      mapleParent1,
      composerForm("cross-centre try", { channels: [sunshinePreschool] })
    );
    expect(target).toBe("/portal/messages?error=norecipients");
    expect(await messageCount()).toBe(0);
  });

  it("a forged Sunshine parent recipient is dropped; picking a co-room parent still sends", async () => {
    // Forged Sunshine recipients are all filtered out → no recipients at all.
    const forged = await sendComposer(
      mapleParent1,
      composerForm("forged recipients", { recipients: [sunshineGrace, sunshineParent2] })
    );
    expect(forged).toBe("/portal/messages?error=norecipients");
    expect(await messageCount()).toBe(0);

    // A legitimate co-room parent is accepted.
    const ok = await sendComposer(
      mapleParent1,
      composerForm("hello neighbour", { recipients: [mapleParent3] })
    );
    expect(ok ?? "").toMatch(/^\/portal\/messages/);
    const rows = (await queryAll("SELECT recipient_account_id, body FROM message")) as Row[];
    expect(rows).toHaveLength(1);
    expect(String(rows[0].recipient_account_id)).toBe(mapleParent3);
  });

  it("a pinned-wrong parent (stale invite) forging Sunshine submits gets refused with nothing stored", async () => {
    // parent2's tenancy makes `firstInstituteId()` resolve SUNSHINE. The old
    // scope read their missing staff row as unscoped against that pin — the
    // forged channel would have fanned a message out to every Sunshine
    // parent and staff. Family-derived scope refuses it.
    const target = await sendComposer(
      mapleParent2,
      composerForm("forge under wrong pin", { channels: [sunshinePreschool], recipients: [sunshineGrace, sunshineParent2] })
    );
    expect(target).toBe("/portal/messages?error=norecipients");
    expect(await messageCount()).toBe(0);
  });

  it("the family-scoped channel still fans out to the room's staff and parents only", async () => {
    // Staff assigned to the room so the audience has a staff half.
    const acc = await createAccount({ email: "willows-staff@example.test", password: "x", fullName: "Willows Staff", role: "staff" });
    const staff = await createStaff({ instituteId: mapleIid, fullName: "Willows Staff", role: "carer", roomIds: [mapleWillows] });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(staff.id), String(acc.id));

    // channel = Willows, audience = whole (default). The redirect that ends
    // the action carries the thread — observe the stored rows, not the error.
    await signParentIn(mapleParent1);
    const { sendComposerAction } = await import("@/lib/actions");
    const fd = new FormData();
    fd.set("body", "willows notice");
    fd.append("channels", mapleWillows);
    try {
      await sendComposerAction(fd);
    } catch (err) {
      const digest = String((err as { digest?: unknown })?.digest ?? "");
      expect(digest.startsWith("NEXT_REDIRECT")).toBe(true);
      expect(digest).toContain("/portal/messages");
    }
    const rows = (await queryAll(
      `SELECT r.recipient_account_id, r.body FROM message r JOIN account a ON a.id = r.recipient_account_id`
    )) as Row[];
    // Feder's parent (Willows Coparent) + the room staff. Never Sunshine
    // accounts, never the Oaks family, never the sender.
    const creditors = rows.map((r) => String(r.recipient_account_id));
    expect(creditors).toContain(mapleParent3);
    expect(creditors).toContain(String(acc.id));
    expect(creditors).not.toContain(mapleParent2);
    expect(creditors).not.toContain(sunshineGrace);
    expect(creditors).not.toContain(sunshineParent2);
    expect(creditors).not.toContain(mapleParent1);
    expect(Number((await queryAll("SELECT COUNT(*) c FROM message"))[0].c)).toBe(2);
  });
});

describe("KID-207 the /portal/messages page renders the family-scoped composer", () => {
  async function renderCompose(searchParams: Record<string, string>): Promise<string> {
    const { default: Page } = await import("@/app/portal/messages/page");
    return renderToStaticMarkup(await Page({ searchParams }));
  }

  it("with a correct pin the composer lists the child's room and co-room parents only", async () => {
    await signParentIn(mapleParent1);
    const html = await renderCompose({ compose: "1" });
    expect(html).toContain("Willows");
    expect(html).toContain("Willows Coparent");
    // Not the sibling Maple class, and none of the Sunshine directory.
    expect(html).not.toContain("Oaks");
    expect(html).not.toContain("Grace Nguyen");
    expect(html).not.toContain("Maple Grove Impostor");
  });

  it("a wrong pin (stale tenancy) fails closed: zero other-centre rows anywhere", async () => {
    // parent2's tenancy set spans both centres, so `firstInstituteId()`
    // resolves Sunshine here — exactly the pinned-wrong institute of the
    // defect report. The composer must render EMPTY, never Sunshine's.
    await signParentIn(mapleParent2);
    const html = await renderCompose({ compose: "1" });
    expect(html).not.toContain("Toddlers");
    expect(html).not.toContain("Preschool");
    expect(html).not.toContain("Grace Nguyen");
    expect(html).not.toContain("Maple Grove Impostor");
    expect(html).not.toContain("Fern");
    // The empty-composer state is explicit, not a silent foreign list.
    expect(html).toContain("No parents in your classrooms.");
  });
});
