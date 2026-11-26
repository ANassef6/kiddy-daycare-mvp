// KID-2498: the Children status chips must be unambiguous and each chip must
// return exactly the status set its label promises. The founder could not tell
// "All active" (everything not withdrawn) from "Active" (only active).

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { queryGet, queryRun } from "@/lib/db";
import { ar, en, tr } from "@/lib/i18n";
import { seedFixture } from "../helpers";

let iid: string;
let ownerAcc: string;
let roomA: string;
let activeIds: string[];
let onHoldId: string;
let pendingId: string;
let withdrawnId: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  ownerAcc = String((await queryGet("SELECT id FROM account WHERE role = 'owner'"))!.id);

  // The seeded fixture has two active children (Ella and Leo).
  activeIds = (await store.listChildren(iid, { status: "active" })).map((c) => String(c.id));

  const onHold = await store.createChild({
    instituteId: iid,
    firstName: "Hana",
    lastName: "OnHold",
    dob: "2021-01-01",
    roomId: roomA,
  });
  const pending = await store.createChild({
    instituteId: iid,
    firstName: "Pia",
    lastName: "Pending",
    dob: "2021-01-02",
    roomId: roomA,
  });
  const withdrawn = await store.createChild({
    instituteId: iid,
    firstName: "Wes",
    lastName: "Withdrawn",
    dob: "2021-01-03",
    roomId: roomA,
  });
  onHoldId = String(onHold.id);
  pendingId = String(pending.id);
  withdrawnId = String(withdrawn.id);
  await queryRun("UPDATE child SET status = 'on_hold' WHERE id = ?", onHoldId);
  await queryRun("UPDATE child SET status = 'pending' WHERE id = ?", pendingId);
  await queryRun("UPDATE child SET status = 'withdrawn', active = 0 WHERE id = ?", withdrawnId);
});

async function idsFor(status: string): Promise<Set<string>> {
  const children = await store.listChildren(iid, { status, accountId: ownerAcc });
  return new Set(children.map((c) => String(c.id)));
}

describe("Children status chip semantics (KID-2498)", () => {
  it("default chip returns every status except withdrawn", async () => {
    expect(await idsFor("")).toEqual(new Set([...activeIds, onHoldId, pendingId]));
  });

  it("Active returns active children only", async () => {
    expect(await idsFor("active")).toEqual(new Set(activeIds));
  });

  it("On hold returns on_hold children only", async () => {
    expect(await idsFor("on_hold")).toEqual(new Set([onHoldId]));
  });

  it("Pending returns pending children only", async () => {
    expect(await idsFor("pending")).toEqual(new Set([pendingId]));
  });

  it("Withdrawn returns withdrawn children only", async () => {
    expect(await idsFor("withdrawn")).toEqual(new Set([withdrawnId]));
  });

  it("Everyone returns every child, including withdrawn", async () => {
    expect(await idsFor("all")).toEqual(
      new Set([...activeIds, onHoldId, pendingId, withdrawnId])
    );
  });
});

describe("Children status chip labels (KID-2498)", () => {
  const keys = [
    "childrenAdd.filterNotWithdrawn",
    "profile.active",
    "profile.onHold",
    "profile.pending",
    "profile.withdrawn",
    "childrenAdd.filterEveryone",
  ];

  it("renders six distinct, translated labels in both locales", () => {
    for (const dict of [en, ar]) {
      const labels = keys.map((key) => tr(dict, key));
      for (const label of labels) {
        expect(label.startsWith("MISSING:")).toBe(false);
        expect(label.trim().length).toBeGreaterThan(0);
      }
      expect(new Set(labels).size).toBe(keys.length);
    }
  });

  it("does not reuse the generic 'All' label for the Everyone chip", () => {
    expect(tr(en, "childrenAdd.filterEveryone")).toBe("Everyone");
    expect(tr(ar, "childrenAdd.filterEveryone")).toBe("الجميع");
    expect(tr(en, "childrenAdd.filterNotWithdrawn")).toBe("Not withdrawn");
  });
});
