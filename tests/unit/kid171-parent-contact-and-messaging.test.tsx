// KID-171 regression tests for the three KID-148 QA defects, all found against
// production on 2026-10-03.
//
// D1  an activated parent contact rendered "Send invite"
// D2  no parent could message the daycare (no account→staff→staff_room chain)
// D3  an unread badge counted a thread the page refuses to list
//
// Each test names the production observation it pins, so a future refactor that
// reintroduces the shape fails here rather than in a browser.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as store from "@/lib/store";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryGet, queryRun, type Row } from "@/lib/db";
import { contactInviteState } from "@/lib/contact-invite-state";
import ContactInviteActions from "@/components/ContactInviteActions";
import {
  parentMessageRecipients,
  sumVisibleUnread,
} from "@/lib/parent-messaging";
import { activationByEmails } from "@/lib/activation";
import { pendingInviteByEmails } from "@/lib/invite-email";
import { mustGet, seedFixture } from "../helpers";

// The staff-link action reads the admin session from the cookie; that is the
// only thing it shares with the page.
const sessionCookie = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (name === "kiddy_sess" ? sessionCookie : undefined) }),
  headers: () => new Headers(),
}));

let iid: string;
/** The seeded parent's account id — every recipient query is keyed on it, not on the email. */
let parentId: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  parentId = String((await mustGet("SELECT id FROM account WHERE email = 'parent@example.test'")).id);
});

/** The family tab renders the resolved state through this one mapping. */
function renderActions(email: string | null, account: { unactivated: boolean } | undefined, inviteId: string | null) {
  return renderToStaticMarkup(
    <ContactInviteActions
      state={contactInviteState({ email, account, pendingInviteId: inviteId })}
      childId="child-1"
      relationship="parent"
      activatedLabel="Activated — has their own login"
    />
  );
}

async function addContact(child: Row, fullName: string, email: string) {
  await store.addContact({
    childId: String(child.id),
    fullName,
    relationship: "parent",
    phone: "+1 555 0100",
    email,
    isPickup: false,
    isEmergency: false,
  });
}

describe("D1 an activated parent contact is never offered another invite", () => {
  it("renders neither 'Send invite' nor 'Resend invite' for a confirmed account", () => {
    // Production: `qa.kid147.parent@example.test` had signed in and was active,
    // and the contact row offered "Send invite" on two children.
    const markup = renderActions("qa.kid147.parent@example.test", { unactivated: false }, null);
    expect(markup).not.toContain("Send invite");
    expect(markup).not.toContain("Resend invite");
    expect(markup).not.toContain("Resend activation");
    // An explicit state, not merely an absent button: the criterion could not
    // pass while the state was conveyed only by which button was missing.
    expect(markup).toContain("Activated");
    expect(markup).toContain('data-testid="contact-activated"');
  });

  it("outranks a leftover pending invite row with the same confirmed state", () => {
    // Production: `nouranhisham22@gmail.com` — account exists, resolves two
    // children — rendered "Resend invite" because its invite row was never
    // consumed. Re-inviting a parent who can already sign in is the same bug.
    const markup = renderActions("nouranhisham22@gmail.com", { unactivated: false }, "invite-123");
    expect(markup).toContain("Activated");
    expect(markup).not.toContain("Resend invite");
  });

  it("still offers 'Resend invite' for a contact whose invite is pending", () => {
    // The half of D1 that already worked, pinned so the fix cannot eat it.
    const markup = renderActions("pending.parent@example.test", undefined, "invite-456");
    expect(markup).toContain("Resend invite");
    expect(markup).not.toContain("Send invite");
    expect(markup).not.toContain("Activated");
  });

  it("still offers 'Send invite' for a contact with no account and no invite", () => {
    // The third acceptance case, and the only one correct before the fix.
    const markup = renderActions("brand.new@example.test", undefined, null);
    expect(markup).toContain("Send invite");
    expect(markup).not.toContain("Resend invite");
    expect(markup).not.toContain("Activated");
  });

  it("reads a confirmed account row as an account, not as a missing one", () => {
    // "The test that is missing is 'is there an account row at all', not 'is it
    // unconfirmed'" — the map entry itself is the presence signal.
    const confirmed = new Map([["a@b.test", { email: "a@b.test", unactivated: false }]]);
    expect(contactInviteState({ email: "a@b.test", account: confirmed.get("a@b.test") }).kind).toBe("activated");
    expect(contactInviteState({ email: "a@b.test", account: undefined }).kind).toBe("send_invite");
  });

  it("resolves real activation and invite rows for a seeded child", async () => {
    // End-to-end on the two batched lookups the page feeds the resolver, so a
    // change to either map's keying cannot silently collapse states again.
    const child = await store.createChild({ instituteId: iid, firstName: "Kian", lastName: "QA" });
    const confirmed = await createAccount({ email: "qa.kid171.active@example.test", password: "x", fullName: "Kian QA", role: "parent" });
    const unconfirmed = await createAccount({ email: "qa.kid171.pending@example.test", password: "x", fullName: "Pending QA", role: "parent" });
    await queryRun("UPDATE account SET email_confirmed = 0 WHERE id = ?", String(unconfirmed.id));
    await addContact(child, "Kian QA", "qa.kid171.active@example.test");
    await addContact(child, "Pending QA", "qa.kid171.pending@example.test");
    await addContact(child, "No Account QA", "qa.kid171.none@example.test");

    const emails = ["qa.kid171.active@example.test", "qa.kid171.pending@example.test", "qa.kid171.none@example.test"];
    const activation = await activationByEmails(emails);
    const pending = await pendingInviteByEmails(emails);
    const kindFor = (email: string) =>
      contactInviteState({
        email,
        account: activation.get(email),
        pendingInviteId: pending.get(email) ? String(pending.get(email)!.id) : null,
      }).kind;

    expect(kindFor("qa.kid171.active@example.test")).toBe("activated");
    expect(kindFor("qa.kid171.pending@example.test")).toBe("resend_activation");
    expect(kindFor("qa.kid171.none@example.test")).toBe("send_invite");
  });

  it("renders nothing at all for a contact with no email address", () => {
    expect(contactInviteState({ email: null }).kind).toBe("none");
    expect(renderActions("", undefined, null)).toBe("");
  });
});

describe("D2 a parent can message the daycare", () => {
  it("offers the classroom's logged-in staff in a freshly seeded centre", async () => {
    // Production: every staff row on /portal/staff read "No login yet", so
    // `classroomStaffForParent` matched nothing for every parent and
    // /child/messages was empty for the whole deployment.
    const recipients = await parentMessageRecipients(parentId);
    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients.map((r) => String(r.full_name))).toContain("Maria Lopez");

    // The chain the query depends on, asserted directly so a broken link names
    // itself.
    const linked = await mustGet(
      `SELECT COUNT(*) AS c FROM account a
       JOIN staff s ON s.id = a.staff_id
       JOIN staff_room sr ON sr.staff_id = s.id
       JOIN child c ON c.room_id = sr.room_id
       JOIN family_member fm ON fm.child_id = c.id
       WHERE fm.account_id = ?`,
      parentId
    );
    expect(Number(linked.c)).toBeGreaterThan(0);
  });

  it("stores a message the recipient then receives, end to end", async () => {
    // The acceptance line is "gets a non-empty recipient list, and that member is
    // offered" — proving the offer leads to a stored message is the strongest
    // form of that, and does not depend on production config.
    const [recipient] = await parentMessageRecipients(parentId);
    const message = await store.sendMessage({
      instituteId: iid,
      senderAccountId: parentId,
      recipientAccountId: String(recipient.id),
      body: "Is Ella's room open for a late pickup today?",
      threadId: null,
    });
    expect(message.id).toBeTruthy();
    const inbox = await store.conversation(parentId, String(recipient.id));
    expect(inbox.map((m: any) => m.body)).toContain("Is Ella's room open for a late pickup today?");
  });

  it("lets an admin link a login to an existing staff record from the UI", async () => {
    // The repair the old UI could not express: `addStaffAction` only creates new
    // staff rows, so "Maria Lopez" could not gain a login without a database write.
    const room = await mustGet("SELECT id FROM room WHERE name = 'Toddlers'");
    const orphan = await store.createStaff({
      instituteId: iid,
      fullName: "Orphan Carer",
      role: "carer",
      roomIds: [String(room.id)],
    });
    const child = await store.createChild({ instituteId: iid, firstName: "Orphan", lastName: "Case", roomId: String(room.id) });
    const parent = await createAccount({ email: "kid171-orphan-parent@example.test", password: "x", fullName: "Orphan Parent", role: "parent" });
    await store.linkFamily(String(parent.id), String(child.id));

    // Before: this staff record is invisible to the parent, because no account
    // carries their staff_id.
    expect((await parentMessageRecipients(String(parent.id))).map((r) => String(r.full_name))).not.toContain("Orphan Carer");

    const owner = String((await mustGet("SELECT id FROM account WHERE role = 'owner'")).id);
    sessionCookie.value = createSessionToken({ accountId: owner, role: "owner", email: "admin@sunshinedaycare.test", accountConfirmed: true } as never);
    const { linkStaffLoginAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("staffId", String(orphan.id));
    form.set("email", "orphan.carer@example.test");
    form.set("password", "orphan-password");
    const to = await redirectTargetOf(() => linkStaffLoginAction(form));
    expect(to).toBe(`/portal/staff/${orphan.id}?linked=1`);

    // After: the same parent is offered the staff member they were just linked to.
    const recipients = await parentMessageRecipients(String(parent.id));
    expect(recipients.map((r) => String(r.full_name))).toContain("Orphan Carer");
    expect(recipients.map((r) => String(r.id))).toContain(String((await mustGet("SELECT id FROM account WHERE email = 'orphan.carer@example.test'")).id));
  });

  it("refuses to steal an account that already belongs to another staff member", async () => {
    // Authorize the resource, not just the role: linking must not silently move
    // a person's access between staff records.
    const orphan = await store.createStaff({ instituteId: iid, fullName: "Second Orphan", role: "carer", roomIds: [] });
    const taken = await store.createStaff({ instituteId: iid, fullName: "First Owner Of Login", role: "carer", roomIds: [] });
    const account = await createAccount({ email: "already-linked@example.test", password: "x", fullName: "First Owner Of Login", role: "staff" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(taken.id), String(account.id));

    const owner = String((await mustGet("SELECT id FROM account WHERE role = 'owner'")).id);
    sessionCookie.value = createSessionToken({ accountId: owner, role: "owner", email: "admin@sunshinedaycare.test", accountConfirmed: true } as never);
    const { linkStaffLoginAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("staffId", String(orphan.id));
    form.set("email", "already-linked@example.test");
    form.set("password", "some-password");
    expect(await redirectTargetOf(() => linkStaffLoginAction(form))).toBe(`/portal/staff/${orphan.id}?error=belongs`);
    expect(String((await mustGet("SELECT staff_id FROM account WHERE id = ?", String(account.id))).staff_id)).toBe(String(taken.id));
  });
});

describe("D3 an unread badge counts only what the page can open", () => {
  it("excludes a thread whose other participant is not classroom staff", async () => {
    const room = await mustGet("SELECT id FROM room WHERE name = 'Toddlers'");
    // Two staff records: one assigned to the parent's child's classroom, one
    // with no assignment at all. Only the first is a legal recipient.
    const roomStaff = await store.createStaff({ instituteId: iid, fullName: "Visible Carer", role: "carer", roomIds: [String(room.id)] });
    const visible = await createAccount({ email: "visible.carer@example.test", password: "x", fullName: "Visible Carer", role: "staff" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(roomStaff.id), String(visible.id));

    const unassignedStaff = await store.createStaff({ instituteId: iid, fullName: "Unassigned Owner", role: "owner", roomIds: [] });
    const hidden = await createAccount({ email: "unassigned.owner@example.test", password: "x", fullName: "Unassigned Owner", role: "owner" });
    await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(unassignedStaff.id), String(hidden.id));

    const openThread = await store.createMessageThread({
      instituteId: iid,
      title: "visible conversation",
      isGroup: false,
      createdBy: parentId,
      participantIds: [String(visible.id)],
    });
    await store.sendMessage({ instituteId: iid, senderAccountId: String(hidden.id), recipientAccountId: parentId, body: "visible one", threadId: String(openThread.id) });

    // The KID-148 production shape: an unread message in a thread whose other
    // participant is not classroom staff. The admin sees this conversation at
    // /portal/messages; the parent's page must not offer it.
    const blockedThread = await store.createMessageThread({
      instituteId: iid,
      title: "QA message round6 148",
      isGroup: false,
      createdBy: String(hidden.id),
      participantIds: [parentId],
    });
    await store.sendMessage({ instituteId: iid, senderAccountId: String(hidden.id), recipientAccountId: parentId, body: "checking in from portal", threadId: String(blockedThread.id) });

    const scoped = await store.threadsForAccountScoped(parentId);
    expect(scoped.map((t: any) => String(t.id))).toEqual([String(openThread.id)]);

    // Both messages are unread and addressed to this account, so the old
    // unscoped counter read 2. The page can only ever open one of them, so the
    // badge must be 1 — never 2, and never 1 above an empty list.
    expect(sumVisibleUnread(scoped)).toBe(1);
    expect(sumVisibleUnread(await store.threadsForAccount(parentId))).toBe(2);
    expect(sumVisibleUnread(await store.threadsForAccountScoped(parentId))).toBe(
      sumVisibleUnread(scoped)
    );
  });

  it("sums per-thread unread counts and tolerates a missing value", () => {
    expect(sumVisibleUnread([{ unread_count: 2 }, { unread_count: "3" }, {}] as never)).toBe(5);
    expect(sumVisibleUnread([])).toBe(0);
  });
});

/** Captures a `redirect()` from a server action as its target string. */
async function redirectTargetOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const digest = String((err as { digest?: unknown })?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw err;
  }
  throw new Error("expected the action to redirect");
}
