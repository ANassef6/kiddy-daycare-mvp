// KID-684: invoice creation must notify the child's parents.
//
// User report (KID-215, 2026-11-07): an admin created an invoice for the
// child "Becca Nassef" and the family parent got no push and no in-app
// notification although billing notifications are enabled on both channels.
// Root cause pinned here: createChildBilling (lib/store.ts) wrote the row
// and the audit event but never emitted through the shared KID-474/KID-480
// pipeline. The tests below pin the fixed behavior end-to-end on the real
// emission path (emitNotifications → notification rows → sendPushToAccounts
// → web-push), over the isolated SQLite fixture.
//
// Pinned here:
//   1. Reproduction — creating a child invoice emits exactly ONE
//      "invoice_created" notification per linked parent account, all sharing
//      the per-invoice dedupe ref `invoice-created-<billingId>` (so re-saves,
//      re-renders and retried emissions can never duplicate: the ref only
//      exists once and a replay of emitNotifications inserts nothing and
//      never re-pushes).
//   2. Editing / re-saving an existing invoice (updateChildBilling) emits
//      nothing — a status change is not a "new invoice".
//   3. A second invoice = a new billing id = fresh notifications (one per
//      parent) with distinct refs; the old ones stay untouched.
//   4. Only role='parent' family accounts are notified — a staff/guardian
//      account linked to the same child and the admin who created the
//      invoice (unlinked) never receive it (no self-notify).
//   5. Preferences gate the channels INDEPENDENTLY, honoring the notification
//      convention: an in-app 'billing' opt-out suppresses the notification
//      row AND the push; a push-only opt-out keeps the row but silences the
//      device. Emissions ride the existing sendPushToAccounts gating over
//      real subscriptions (web-push stubbed at the boundary — no network).
//   6. The deep link is role-correct: the parent push URL opens the parent
//      child surface's invoice section (`/child/<childId>#invoices`) and the
//      notification-center row carries the same href; it never points into
//      the admin portal. The page pin keeps the anchor present.
//   7. The copy names the child and the invoice; EN + AR ship for the new
//      title and the view renders both locales from the locale-independent
//      payload.

process.env.TZ = "UTC";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// The web-push boundary is stubbed so the whole real fan-out runs (VAPID
// config, per-account opt-out, subscriptions, locale copy, deep link) and
// every delivered payload is captured for assertion. Push sends must never
// hit a real service from tests.
const pushState = vi.hoisted(() => ({
  sends: [] as Array<{ endpoint: string; payload: Record<string, unknown> }>,
}));
// KID-816: the mock mirrors the REAL web-push v4 shape — pure ESM, named
// exports only, NO `default` wrapper (the old `{ default: { … } }` mock hid
// the production default-import bug on the invoice-created send path).
vi.mock("web-push", () => ({
  sendNotification: async (subscription: unknown, payload: string) => {
    const endpoint = String((subscription as { endpoint?: string })?.endpoint ?? "");
    pushState.sends.push({ endpoint, payload: JSON.parse(payload) });
  },
}));

import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";
import { createAccount } from "@/lib/auth";
import {
  createChildBilling,
  updateChildBilling,
  listNotificationsFor,
  emitNotifications,
  linkFamily,
  notificationViewCopy,
} from "@/lib/store";
import { pushDeepUrl, savePushSubscription } from "@/lib/push";
import { dictionaries, feedCopyFor } from "@/lib/i18n";

let iid = "";
let childId = "";
let childName = "";
let adminId = "";
let parentId = "";
let parent2Id = "";
let parentEndpoints: Map<string, string>;

async function createInvoice(description = "June fees", amountCents = 120000): Promise<any> {
  return createChildBilling({
    childId,
    instituteId: iid,
    description,
    amountCents,
    currency: "EGP",
    dueDate: "2026-12-01",
  });
}

async function billingActivityRows(accountId: string): Promise<any[]> {
  return (await listNotificationsFor(accountId)).filter(
    (r) => String(r.activity) === "billing"
  );
}

beforeEach(async () => {
  pushState.sends = [];
  parentEndpoints = new Map();
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  const child = (await queryGet(
    "SELECT id, first_name, last_name FROM child LIMIT 1"
  ))!;
  childId = String(child.id);
  childName = `${child.first_name} ${child.last_name}`;
  adminId = String(
    (await queryGet("SELECT id FROM account WHERE email = 'trois4ever+admin@gmail.com'"))!.id
  );

  for (const [tag, slot] of [
    ["parent-684-a", "parent"],
    ["parent-684-b", "parent2"],
  ] as const) {
    const acc = await createAccount({
      email: `${tag}-${Math.random().toString(36).slice(2)}@test.local`,
      password: "parent-pass",
      fullName: `KID-684 ${slot}`,
      role: "parent",
    });
    if (slot === "parent") parentId = String(acc.id);
    else parent2Id = String(acc.id);
    await linkFamily(String(acc.id), childId, "parent");
    // Real subscriptions so the push fan-out runs its normal gating; the
    // web-push boundary is stubbed so no network is touched.
    const endpoint = `https://push.test/sub-${slot}-${Math.random().toString(36).slice(2)}`;
    await savePushSubscription(String(acc.id), {
      endpoint,
      keys: { p256dh: "p256dh-test", auth: "auth-test" },
    });
    parentEndpoints.set(String(acc.id), endpoint);
  }

  process.env.VAPID_PUBLIC_KEY = "vapid-public-test";
  process.env.VAPID_PRIVATE_KEY = "vapid-private-test";
  process.env.VAPID_SUBJECT = "mailto:kiddy-push@kiddy.local";
});

describe("KID-684 reproduction: one notification per linked parent", () => {
  it("creating an invoice emits exactly one invoice_created row per parent", async () => {
    const billing = await createInvoice();
    const ref = `invoice-created-${String(billing.id)}`;

    for (const accountId of [parentId, parent2Id]) {
      const rows = await billingActivityRows(accountId);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].kind)).toBe("invoice_created");
      expect(String(rows[0].ref)).toBe(ref);
      expect(String(rows[0].institute_id)).toBe(iid);
      const payload = JSON.parse(String(rows[0].payload));
      expect(payload.childId).toBe(childId);
      expect(payload.childName).toBe(childName);
      expect(payload.description).toBe("June fees");
      expect(payload.amount).toBe("1200.00 EGP");
      expect(payload.dueDate).toBe("2026-12-01");
    }
  });

  it("the emission replays of the same ref answer nothing: no duplicate row, no re-push", async () => {
    const billing = await createInvoice();
    const sendsBefore = pushState.sends.length;
    let emittedAgain = 0;
    for (const accountId of [parentId, parent2Id]) {
      emittedAgain += await emitNotifications({
        instituteId: iid,
        accountIds: [accountId],
        activity: "billing",
        kind: "invoice_created",
        payload: {
          childId,
          childName,
          description: "June fees",
          amount: "1200.00 EGP",
          dueDate: "2026-12-01",
        },
        ref: `invoice-created-${String(billing.id)}`,
      });
    }
    expect(emittedAgain).toBe(0);
    for (const accountId of [parentId, parent2Id]) {
      expect(await billingActivityRows(accountId)).toHaveLength(1);
    }
    expect(pushState.sends.length).toBe(sendsBefore);
  });

  it("editing / re-saving an existing invoice emits nothing", async () => {
    const billing = await createInvoice();
    const before = await billingActivityRows(parentId);
    expect(before).toHaveLength(1);
    await updateChildBilling(String(billing.id), { status: "paid" });
    expect(await billingActivityRows(parentId)).toHaveLength(1);
    await updateChildBilling(String(billing.id), { status: "pending" });
    expect(await billingActivityRows(parentId)).toHaveLength(1);
  });

  it("a second invoice creates fresh per-parent notifications with unique refs", async () => {
    const first = await createInvoice("June fees");
    const second = await createInvoice("July fees");
    expect(String(second.id)).not.toBe(String(first.id));
    const rows = await billingActivityRows(parentId);
    expect(rows).toHaveLength(2);
    const refs = new Set(rows.map((r) => String(r.ref)));
    expect(refs).toEqual(
      new Set([`invoice-created-${String(first.id)}`, `invoice-created-${String(second.id)}`])
    );
    expect(await billingActivityRows(parent2Id)).toHaveLength(2);
  });
});

describe("KID-684 no self-notify: only linked role='parent' accounts", () => {
  it("a non-parent account linked to the child and the creating admin never receive it", async () => {
    const staff = await createAccount({
      email: `staff-684-${Math.random().toString(36).slice(2)}@test.local`,
      password: "staff-pass",
      fullName: "KID-684 Staff",
      role: "staff",
    });
    // A staff/guardian link on the same child: parentAccountIdsForChild
    // filters on role='parent', so this link stays silent.
    await linkFamily(String(staff.id), childId, "family");
    await createInvoice();
    expect(await billingActivityRows(String(staff.id))).toHaveLength(0);
    expect(await billingActivityRows(adminId)).toHaveLength(0);
    expect(await listNotificationsFor(String(staff.id))).toHaveLength(0);
    expect(await listNotificationsFor(adminId)).toHaveLength(0);
  });
});

describe("KID-684 preferences gate the channels independently", () => {
  it("an in-app billing opt-out suppresses the row AND the push; a push-only opt-out keeps the row", async () => {
    const { queryRun } = await import("@/lib/db");
    // parent1 opted out of in-app billing (so its push rides the row and
    // dies with it), parent2 kept the bell but silenced the device, parent3
    // is the no-pref control that receives both channels.
    await queryRun(
      "INSERT INTO notification_pref (account_id, activity, channel, enabled) VALUES (?, 'billing', 'inapp', 0)",
      parentId
    );
    await queryRun(
      "INSERT INTO notification_pref (account_id, activity, channel, enabled) VALUES (?, 'billing', 'push', 0)",
      parent2Id
    );
    const control = await createAccount({
      email: `parent-684-c-${Math.random().toString(36).slice(2)}@test.local`,
      password: "parent-pass",
      fullName: "KID-684 Control Parent",
      role: "parent",
    });
    const controlParentId = String(control.id);
    await linkFamily(controlParentId, childId, "parent");
    const controlEndpoint = `https://push.test/sub-control-${Math.random().toString(36).slice(2)}`;
    await savePushSubscription(controlParentId, {
      endpoint: controlEndpoint,
      keys: { p256dh: "p256dh-test", auth: "auth-test" },
    });
    await createInvoice();

    expect(await billingActivityRows(parentId)).toHaveLength(0);
    expect(await billingActivityRows(parent2Id)).toHaveLength(1);
    expect(await billingActivityRows(controlParentId)).toHaveLength(1);

    const endpoints = pushState.sends.map((s) => s.endpoint);
    expect(endpoints).toContain(controlEndpoint);
    expect(endpoints).not.toContain(parentEndpoints.get(parentId));
    expect(endpoints).not.toContain(parentEndpoints.get(parent2Id));
    expect(endpoints).toHaveLength(1);
  });
});

describe("KID-684 push delivery: role-correct deep link and copy", () => {
  it("every subscribed parent gets a push with the parent surface anchor, dedupe tag and localized title", async () => {
    await createInvoice();
    expect(pushState.sends).toHaveLength(2);
    const endpoints = new Set(pushState.sends.map((s) => s.endpoint));
    expect(endpoints).toEqual(new Set(parentEndpoints.values()));
    for (const send of pushState.sends) {
      expect(send.payload.url).toBe(`/child/${childId}#invoices`);
      expect(String(send.payload.tag)).toMatch(/^invoice-created-/);
      const payloadInRow = {
        childId,
        childName,
        description: "June fees",
        amount: "1200.00 EGP",
        dueDate: "2026-12-01",
      };
      // The push title/body come from the same locale-aware view copy the
      // parent notification center renders.
      const view = notificationViewCopy("invoice_created", payloadInRow, feedCopyFor("en"));
      expect(send.payload.title).toBe(view.title);
      expect(send.payload.body).toBe(view.body);
    }
  });

  it("pushDeepUrl falls back safely without a childId", () => {
    expect(pushDeepUrl("invoice_created", { childId })).toBe(`/child/${childId}#invoices`);
    expect(pushDeepUrl("invoice_created", {})).toBe("/child");
  });

  it("the notification-center row links to the same parent surface, never the admin portal", async () => {
    await createInvoice();
    const rows = await billingActivityRows(parentId);
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(String(rows[0].payload));
    expect(payload.childId).toBe(childId);
    const source = await import("node:fs");
    const page = source.readFileSync("app/child/notifications/page.tsx", "utf8");
    expect(page).toContain('invoice_created');
    expect(page).toContain('#invoices');
    const childPage = source.readFileSync("app/child/[id]/page.tsx", "utf8");
    expect(childPage).toContain('id="invoices"');
  });
});

describe("KID-684 copy: the notification names the child and the invoice", () => {
  it("view copy renders EN and AR titles from the locale-independent payload", () => {
    const payload = {
      childId,
      childName,
      description: "June fees",
      amount: "1200.00 EGP",
      dueDate: "2026-12-01",
    };
    const en = notificationViewCopy("invoice_created", payload, feedCopyFor("en"));
    expect(en.title).toBe(`New invoice for ${childName}: June fees`);
    expect(en.body).toContain("1200.00 EGP");
    expect(en.body).toContain("2026-12-01");

    const ar = notificationViewCopy("invoice_created", payload, feedCopyFor("ar"));
    // The Arabic template interpolates the same locale-independent payload.
    expect(ar.title).toContain("June fees");
    expect(ar.title).toContain(childName);
    expect(ar.title).not.toBe(en.title);
    expect(Object.keys(dictionaries.ar.feed)).toEqual(Object.keys(dictionaries.en.feed));
  });
});
