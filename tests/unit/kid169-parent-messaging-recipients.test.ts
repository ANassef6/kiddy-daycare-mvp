// KID-169 regression: the recipient the /child/messages page offers must be a
// member of the set `sendParentMessageAction` accepts.
//
// Production repro this pins: the page offered the centre's owner/admin account
// (`centerContactAccount`, which ignored its own instituteId argument and had no
// room predicate) while the KID-144 action only accepted classroom-assigned
// staff. Every send redirected to `/child/messages?error=recipient`, nothing was
// stored, and the page never read the `error` param — so the parent saw an
// identical page before and after a failed send.
//
// These tests drive the real action (with the session cookie mocked, the only
// thing the page and the action cannot share) so the assertion is behavioural,
// not a restatement of the query.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "@/lib/store";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryAll, queryGet, queryRun } from "@/lib/db";
import { parentMessageRecipients, parentRecipientIds, pickRecipient } from "@/lib/parent-messaging";
import { seedFixture } from "../helpers";

// next/headers has no request scope under vitest. The session cookie is the
// only thing the action reads from the request, so mocking it is the whole
// harness; `next/navigation`'s real redirect (and its NEXT_REDIRECT digest) is
// used unmodified so the redirect target is observable.
const sessionCookie = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (name === "kiddy_sess" ? sessionCookie : undefined) }),
  headers: () => new Headers(),
}));

let iid: string;
let roomA: string;
let roomB: string;

/** Signs `accountId` in as a parent and returns the action's redirect target. */
async function sendAs(accountId: string, recipientId: string, body: string): Promise<string | null> {
  sessionCookie.value = createSessionToken({
    accountId,
    role: "parent",
    email: "parent@example.com",
    accountConfirmed: true,
  } as never);
  const { sendParentMessageAction } = await import("@/lib/actions");
  const form = new FormData();
  form.set("recipientId", recipientId);
  form.set("body", body);
  try {
    await sendParentMessageAction(form);
    return null;
  } catch (err) {
    const digest = String((err as { digest?: unknown })?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) {
      // NEXT_REDIRECT;<type>;<url>;<status>
      return digest.split(";")[2] ?? "";
    }
    throw err;
  }
}

async function storedMessages(): Promise<Rowish[]> {
  return (await queryAll("SELECT sender_account_id, recipient_account_id, body FROM message")) as Rowish[];
}

type Rowish = { sender_account_id: string; recipient_account_id: string; body: string };

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  roomB = String((await queryGet("SELECT id FROM room WHERE name = 'Preschool'"))!.id);
});

describe("KID-169 the daycare recipient contract is one set", () => {
  it("never offers the unscoped owner/admin picker that ignored instituteId", async () => {
    // D2: the old picker took an instituteId and returned the globally oldest
    // owner/admin account in the deployment — a cross-tenant name disclosure.
    // It must be gone, not merely fixed at the call site.
    const storeModule = (await import("@/lib/store")) as unknown as Record<string, unknown>;
    expect(storeModule.centerContactAccount).toBeUndefined();
    expect((await import("@/lib/parent-messaging")) as unknown as Record<string, unknown>).not.toHaveProperty(
      "centerContactAccount"
    );
  });

  it("accepts every recipient the page offers, and refuses the rest", async () => {
    const child = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const parent = await createAccount({ email: "kid169-happy@example.com", password: "x", fullName: "Parent", role: "parent" });
    await store.linkFamily(String(parent.id), String(child.id));

    // Staff assigned to the parent's room: the only legitimate recipient.
    const roomStaff = await store.createStaff({ instituteId: iid, fullName: "Room A Carer", role: "carer", roomIds: [roomA] });
    const roomAcc = await createAccount({ email: "room-a@example.com", password: "x", fullName: "Room A Carer", role: "staff" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(roomStaff.id), String(roomAcc.id));

    // Staff assigned to another room: not this parent's staff.
    const otherStaff = await store.createStaff({ instituteId: iid, fullName: "Room B Carer", role: "carer", roomIds: [roomB] });
    const otherAcc = await createAccount({ email: "room-b@example.com", password: "x", fullName: "Room B Carer", role: "staff" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(otherStaff.id), String(otherAcc.id));

    // The production case: an owner/admin with a staff row but no assignment to
    // the parent's room. `centerContactAccount` used to return this account to
    // every parent in the deployment.
    const unassigned = await store.createStaff({ instituteId: iid, fullName: "Maria Lopez", role: "owner", roomIds: [] });
    const unassignedAcc = await createAccount({ email: "maria@example.com", password: "x", fullName: "Maria Lopez", role: "owner" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(unassigned.id), String(unassignedAcc.id));

    const offered = await parentMessageRecipients(String(parent.id));
    // KID-171 (D2): the seeded centre links its owner login to a staff record
    // assigned to Toddlers, so she joins the legitimate set. `unassigned`
    // below — the account `centerContactAccount` used to hand every parent —
    // must still not be in it.
    expect(offered.map((r) => String(r.full_name)).sort()).toEqual(["Maria Lopez", "Room A Carer"]);
    expect(offered.map((r) => String(r.id))).not.toContain(String(unassignedAcc.id));

    // Every id the page can put in the form is one the action accepts.
    for (const r of offered) {
      const to = await sendAs(String(parent.id), String(r.id), "hello");
      expect(to).toBe("/child/messages");
    }
    expect(await storedMessages()).toHaveLength(offered.length);
    expect((await storedMessages()).map((m) => m.recipient_account_id).sort()).toEqual(
      offered.map((r) => String(r.id)).sort()
    );

    // The account the old page offered, and every other account in the
    // deployment, is refused with the error the page now renders.
    for (const forged of [String(unassignedAcc.id), String(otherAcc.id), "00000000-0000-0000-0000-000000000000", "x"]) {
      const to = await sendAs(String(parent.id), forged, "hello again");
      expect(to).toBe("/child/messages?error=recipient");
    }
    expect(await storedMessages()).toHaveLength(offered.length);
  });

  it("drops a forged `to` parameter instead of rendering it as a recipient", async () => {
    const child = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: roomA });
    const parent = await createAccount({ email: "kid169-forged@example.com", password: "x", fullName: "Parent", role: "parent" });
    await store.linkFamily(String(parent.id), String(child.id));
    const roomStaff = await store.createStaff({ instituteId: iid, fullName: "Room A Carer", role: "carer", roomIds: [roomA] });
    const roomAcc = await createAccount({ email: "room-a-2@example.com", password: "x", fullName: "Room A Carer", role: "staff" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(roomStaff.id), String(roomAcc.id));
    const owner = await createAccount({ email: "owner@example.com", password: "x", fullName: "Centre Owner", role: "owner" });

    const allowed = await parentRecipientIds(String(parent.id));
    for (const requested of [String(owner.id), "00000000-0000-0000-0000-000000000000", "", "   "]) {
      const picked = pickRecipient(await parentMessageRecipients(String(parent.id)), requested);
      expect(picked).toBeDefined();
      expect(allowed.has(String(picked!.id))).toBe(true);
      expect(String(picked!.id)).not.toBe(requested);
    }

    // The default when no `to` is given is some allowed recipient, never a
    // forged one. KID-171 (D2) makes the seeded centre owner legitimately
    // allowed here too, so the assertion is membership, not a fixed name.
    const defaulted = String(pickRecipient(await parentMessageRecipients(String(parent.id)))!.id);
    expect(allowed.has(defaulted)).toBe(true);
    expect(defaulted).not.toBe(String(owner.id));
    expect(String(pickRecipient(await parentMessageRecipients(String(parent.id)), String(roomAcc.id))!.id)).toBe(String(roomAcc.id));
  });

  it("reports nobody available instead of falling back to another account", async () => {
    // A room with no staff assigned at all — the page must show an empty state,
    // not substitute some other centre's admin. KID-171 (D2) linked the seeded
    // centre owner to Toddlers and Preschool, so this case needs a room of its
    // own to stay genuinely empty.
    const emptyRoom = await store.createRoom(iid, "Empty Room", 4);
    const child = await store.createChild({ instituteId: iid, firstName: "Becca", lastName: "Nassef", roomId: String(emptyRoom.id) });
    const parent = await createAccount({ email: "kid169-empty@example.com", password: "x", fullName: "Parent", role: "parent" });
    await store.linkFamily(String(parent.id), String(child.id));
    const owner = await createAccount({ email: "lonely-owner@example.com", password: "x", fullName: "Centre Owner", role: "owner" });

    expect(await parentMessageRecipients(String(parent.id))).toEqual([]);
    expect(pickRecipient(await parentMessageRecipients(String(parent.id)))).toBeUndefined();

    // Even so, the action refuses that account: the empty state is not a bypass.
    expect(await sendAs(String(parent.id), String(owner.id), "hello")).toBe("/child/messages?error=recipient");
    expect(await storedMessages()).toEqual([]);
  });
});
