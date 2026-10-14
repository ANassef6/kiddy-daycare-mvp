// KID-180: Add contact must (1) keep the staff member on the same child's
// family view and (2) send the parent invitation automatically when the
// contact carries an email. These tests pin the action's outcome, the invite
// row it leaves behind, and what it deliberately does NOT do (no invite for
// a contact without an email, none for a parent with a confirmed account —
// the KID-135 trap, none reusing an existing pending invite as a duplicate).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as store from "@/lib/store";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryGet, queryAll, type Row } from "@/lib/db";
import { mustGet, seedFixture } from "../helpers";

const sessionCookie = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (name === "kiddy_sess" ? sessionCookie : undefined) }),
  headers: () => new Headers(),
}));

let iid: string;
let child: Row;
let ownerAccountId: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  ownerAccountId = String((await mustGet("SELECT id FROM account WHERE role = 'owner'")).id);
  child = await store.createChild({ instituteId: iid, firstName: "Lina", lastName: "Kid180" });
  sessionCookie.value = createSessionToken({
    accountId: ownerAccountId,
    role: "owner",
    email: "admin@sunshinedaycare.test",
    accountConfirmed: true,
  } as never);
});

afterEach(() => {
  sessionCookie.value = "";
});

function formWith(over: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("childId", String(child.id));
  form.set("fullName", "Maysaa Kid180");
  form.set("relationship", "parent");
  form.set("phone", "+1 555 0180");
  form.set("email", "trois4ever+testparent@example.com");
  for (const [k, v] of Object.entries(over)) form.set(k, v);
  return form;
}

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

async function loadAction() {
  return (await import("@/lib/actions")).addContactAction;
}

/** Parse the redirect target into its query record (none for a bare path). */
function queryOf(target: string): Record<string, string> {
  const params = new URLSearchParams(target.split("?")[1] ?? "");
  return Object.fromEntries(params.entries());
}

describe("KID-180 add contact auto-invite", () => {
  it("sends the invite and lands back on the same child's family tab", async () => {
    const action = await loadAction();
    const target = await redirectTargetOf(() => action(formWith()));
    // Keeps the staff member in the child's contacts view — never a drop
    // back to the Children list or the first profile tab.
    expect(target.startsWith(`/portal/children/${child.id}?`)).toBe(true);
    const q = queryOf(target);
    expect(q.tab).toBe("family");
    // Local test env has no mail provider: the invite row must exist and the
    // send attempt must be recorded as visible pending state, not erased.
    expect(q.invite).toBe("pending");
    expect(q.email).toBe("trois4ever+testparent@example.com");
    expect((await store.listContacts(String(child.id))).length).toBe(1);
    const invite = await queryGet(
      "SELECT * FROM invite WHERE email = ?",
      "trois4ever+testparent@example.com"
    );
    expect(String(invite?.child_id)).toBe(String(child.id));
    expect(String(invite?.status)).toBe("pending");
    // The delivery attempt is on the row (email_error from the missing
    // provider), so "did it actually go out?" is answerable, not silent.
    expect(String(invite!.email_sent_at ?? "")).toBe("");
    expect(String(invite!.email_error ?? "").length).toBeGreaterThan(0);
  });

  it("saves a contact with no email cleanly and attempts no invite", async () => {
    const action = await loadAction();
    const target = await redirectTargetOf(() => action(formWith({ email: "" })));
    expect(target).toBe(`/portal/children/${child.id}?tab=family`);
    expect(String(queryOf(target).invite ?? "")).toBe("");
    const contacts = await store.listContacts(String(child.id));
    expect(contacts.length).toBe(1);
    expect(contacts[0].email ?? "").toBe("");
    expect(await queryGet("SELECT id FROM invite WHERE email = ?", "trois4ever+testparent@example.com")).toBeUndefined();
  });

  it("never duplicates or errors for an email that already has a confirmed account", async () => {
    // The realistic shape: the parent can already sign in and is linked to a
    // sibling in this centre, so the tenant gate (KID-152) allows the
    // auto-link; the action must still not stack a second invite on top.
    const sibling = await store.createChild({ instituteId: iid, firstName: "Sam", lastName: "Kid180" });
    const account = await createAccount({
      email: "trois4ever+testparent@example.com",
      password: "x",
      fullName: "Already Active Parent",
      role: "parent",
    });
    const { linkFamily } = await import("@/lib/store");
    await linkFamily(String(account.id), String(sibling.id), "parent");

    const action = await loadAction();
    const target = await redirectTargetOf(() => action(formWith()));
    const q = queryOf(target);
    expect(q.tab).toBe("family");
    expect(q.invite).toBe("activated");
    expect(q.email).toBe("trois4ever+testparent@example.com");
    // Contact saved and sibling auto-link granted access without a crash.
    expect((await store.listContacts(String(child.id))).length).toBe(1);
    const links = await queryAll(
      "SELECT * FROM family_member fm JOIN account a ON a.id = fm.account_id WHERE a.email = ?",
      "trois4ever+testparent@example.com"
    );
    expect(links.map((l) => String(l.child_id)).map(String)).toContain(String(child.id));
    expect(await queryGet("SELECT id FROM invite WHERE email = ?", "trois4ever+testparent@example.com")).toBeUndefined();
  });

  it("reuses an existing pending invite instead of stacking a duplicate", async () => {
    const { createInvite } = await import("@/lib/store");
    await createInvite(iid, String(child.id), "trois4ever+testparent@example.com", "KID-180A", "parent");
    const action = await loadAction();
    const target = await redirectTargetOf(() => action(formWith()));
    expect(queryOf(target).tab).toBe("family");
    expect(queryOf(target).invite).toBe("pending");
    const invites = await queryAll("SELECT id FROM invite WHERE email = ?", "trois4ever+testparent@example.com");
    expect(invites.length).toBe(1);
  });

  it("skips the invite entirely for an unconfirmed account when no mail provider is wired", async () => {
    // KID-135 shape: the address belongs to a registered-but-unconfirmed
    // parent. In the test env there is no GoTrue, so the send is skipped
    // without an error page and without a confusing duplicate invite.
    await createAccount({
      email: "trois4ever+testparent@example.com",
      password: "x",
      fullName: "Not Yet Confirmed",
      role: "parent",
    });
    const { setEmailConfirmed } = await import("@/lib/auth");
    const accountId = String((await queryGet("SELECT id FROM account WHERE email = ?", "trois4ever+testparent@example.com"))!.id);
    await setEmailConfirmed(accountId, false);

    const action = await loadAction();
    const target = await redirectTargetOf(() => action(formWith()));
    const q = queryOf(target);
    expect(q.tab).toBe("family");
    // Save-the-contact always wins: no error status on the redirect.
    expect((await store.listContacts(String(child.id))).length).toBe(1);
    expect(queryOf(target).invite).not.toBe("failed");
    expect(await queryGet("SELECT id FROM invite WHERE email = ?", "trois4ever+testparent@example.com")).toBeUndefined();
  });

  it("rejects an invalid relationship while staying on the family tab", async () => {
    const action = await loadAction();
    const target = await redirectTargetOf(() => action(formWith({ relationship: "best friend forever" })));
    expect(target).toBe(`/portal/children/${child.id}?tab=family&error=relationship`);
    expect((await store.listContacts(String(child.id))).length).toBe(0);
  });
});

describe("KID-180 the child profile reopens on the tab an action submitted from", () => {
  it("preselects the requested tab and hides the rest", async () => {
    const ChildProfileTabs = (await import("@/components/ChildProfileTabs")).default;
    const markup = renderToStaticMarkup(
      <ChildProfileTabs
        tabs={[
          { id: "daily", label: "Daily", node: "DAILY-PANE" },
          { id: "family", label: "Family", node: "FAMILY-PANE" },
        ]}
        initialTab="family"
      />
    );
    expect(markup).toContain("FAMILY-PANE");
    expect(markup).not.toContain("DAILY-PANE");
  });

  it("falls back to the first tab for an unknown request", async () => {
    const ChildProfileTabs = (await import("@/components/ChildProfileTabs")).default;
    const markup = renderToStaticMarkup(
      <ChildProfileTabs
        tabs={[
          { id: "daily", label: "Daily", node: "DAILY-PANE" },
          { id: "family", label: "Family", node: "FAMILY-PANE" },
        ]}
        initialTab="nonsense"
      />
    );
    expect(markup).toContain("DAILY-PANE");
    expect(markup).not.toContain("FAMILY-PANE");
  });
});
