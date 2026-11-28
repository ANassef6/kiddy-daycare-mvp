// KID-2479: supply requests can target one child.
//
// The request form only had item/quantity/unit/notes and supply_request had no
// child reference, so a parent could not tell which child a request was for.
// These tests pin the data model (nullable child_id), the child name on the
// list, the parent-side scoping (general + own children only) and the action's
// child authorization.

import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionCookie = { value: "" };
let mockHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (name === "kiddy_sess" ? sessionCookie : undefined) }),
  headers: () => ({
    get: (key: string) => mockHeaders[key.toLowerCase()] ?? null,
  }),
}));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    redirect: (url: string) => {
      const err = new Error(`NEXT_REDIRECT: ${url}`) as Error & { digest?: string };
      err.digest = `NEXT_REDIRECT;replace;${url};`;
      throw err;
    },
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  };
});

import * as store from "@/lib/store";
import { createSessionToken } from "@/lib/auth";
import { queryGet, queryAll } from "@/lib/db";
import { seedFixture } from "../helpers";

let iid: string;
let ownerId: string;
let parentId: string;
let childAId: string;
let childBId: string;

function formData(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.set(k, v);
  return form;
}

async function redirectTargetFor(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (err) {
    const digest = String((err as { digest?: unknown })?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    if (String((err as Error)?.message ?? "") === "NEXT_NOT_FOUND") return "NEXT_NOT_FOUND";
    throw err;
  }
}

function sessionFor(accountId: string, email: string, role: string): void {
  const token = createSessionToken({ accountId, email, role, emailConfirmed: true });
  sessionCookie.value = token;
  mockHeaders = { cookie: `kiddy_sess=${token}` };
}

beforeEach(async () => {
  sessionCookie.value = "";
  mockHeaders = {};
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute WHERE name = 'Sunshine Daycare'"))!.id);
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner' LIMIT 1"))!.id);
  parentId = String((await queryGet("SELECT id FROM account WHERE email = 'parent@example.test'"))!.id);
  const children = await queryAll("SELECT id FROM child WHERE institute_id = ? ORDER BY created_at", iid);
  childAId = String(children[0].id);
  childBId = String(children[1].id);
});

describe("KID-2479: supply_request.child_id", () => {
  it("stores the child and carries the child name on the list", async () => {
    const supply = await store.createSupply({
      instituteId: iid,
      childId: childAId,
      title: "Spare clothes",
      quantity: 2,
      unit: "sets",
    });
    expect(String(supply.child_id)).toBe(childAId);

    const rows = await store.listSupplies(iid);
    const row = rows.find((r) => String(r.id) === String(supply.id))!;
    expect(String(row.child_id)).toBe(childAId);
    expect(String(row.first_name)).toBe("Ella");
    expect(String(row.last_name)).toBe("Nguyen");
  });

  it("keeps a request without a child working (general request)", async () => {
    const supply = await store.createSupply({ instituteId: iid, title: "Paper towels" });
    expect(supply.child_id ?? null).toBeNull();
    const row = (await store.listSupplies(iid)).find((r) => String(r.id) === String(supply.id))!;
    expect(row.first_name ?? null).toBeNull();
  });

  it("scopes a parent to general requests plus their own children's requests", async () => {
    const otherChild = await store.createChild({
      instituteId: iid,
      firstName: "Maya",
      lastName: "Hassan",
    });
    const general = await store.createSupply({ instituteId: iid, title: "Tissues" });
    const own = await store.createSupply({ instituteId: iid, childId: childBId, title: "Diapers" });
    const foreign = await store.createSupply({
      instituteId: iid,
      childId: String(otherChild.id),
      title: "Boots",
    });

    const parentIds = (await store.listSupplies(iid, { accountId: parentId })).map((r) => String(r.id));
    expect(parentIds).toContain(String(general.id));
    expect(parentIds).toContain(String(own.id));
    expect(parentIds).not.toContain(String(foreign.id));

    // Staff/owner listings stay centre-wide.
    const staffIds = (await store.listSupplies(iid, { accountId: ownerId })).map((r) => String(r.id));
    expect(staffIds).toEqual(expect.arrayContaining([String(general.id), String(own.id), String(foreign.id)]));
  });

  it("keeps a parent's notification feed free of other children's requests", async () => {
    const otherChild = await store.createChild({
      instituteId: iid,
      firstName: "Maya",
      lastName: "Hassan",
    });
    const own = await store.createSupply({ instituteId: iid, childId: childAId, title: "Own child wipes" });
    const foreign = await store.createSupply({
      instituteId: iid,
      childId: String(otherChild.id),
      title: "Other child boots",
    });

    const feed = await store.recentActivityFeed(iid, parentId);
    const ids = feed.map((item) => item.id);
    expect(ids).toContain(String(own.id));
    expect(ids).not.toContain(String(foreign.id));
  });

  it("tags only the selected child's newsfeed when a child is chosen", async () => {
    sessionFor(ownerId, "trois4ever+admin@gmail.com", "owner");
    const { createSupplyAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      createSupplyAction(formData({ title: "Naptime blanket", quantity: "1", unit: "pcs", childId: childAId }))
    );
    expect(target).toBe("/portal/supplies");

    const supply = (await queryGet(
      "SELECT * FROM supply_request WHERE title = 'Naptime blanket' ORDER BY created_at DESC LIMIT 1"
    ))!;
    expect(String(supply.child_id)).toBe(childAId);

    const tagged = await queryAll(
      `SELECT nt.child_id FROM newsfeed_post n
       JOIN newsfeed_tag nt ON nt.post_id = n.id
       WHERE n.body LIKE 'Supplies needed: Naptime blanket%'`
    );
    expect(tagged.map((r) => String(r.child_id))).toEqual([childAId]);
  });

  it("refuses a child id from another centre (no write, no newsfeed)", async () => {
    const maple = await store.createDaycare({
      name: "Maple Tree Daycare",
      subdomain: "mapletree",
      ownerEmail: "maple-owner@example.test",
      ownerPassword: "kiddy-maple",
      ownerFullName: "Maple Owner",
    });
    const foreignChild = await store.createChild({
      instituteId: maple.instituteId,
      firstName: "Noah",
      lastName: "Maple",
    });
    sessionFor(ownerId, "trois4ever+admin@gmail.com", "owner");
    const { createSupplyAction } = await import("@/lib/actions");
    const target = await redirectTargetFor(() =>
      createSupplyAction(formData({ title: "Cross centre wipes", childId: String(foreignChild.id) }))
    );
    expect(target).toBe("/portal/children?error=scope");
    expect(
      (await queryGet("SELECT COUNT(*) AS c FROM supply_request WHERE title = 'Cross centre wipes'"))!.c
    ).toBe(0);
  });
});
