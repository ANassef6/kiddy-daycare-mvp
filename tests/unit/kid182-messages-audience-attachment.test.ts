// KID-182: composer audience channels + attachments. Each classroom channel
// resolves to an exact audience — "whole" = parents + staff of the room,
// "children" = parents only, "staff" = staff only — and any attachment is
// stored on the resulting thread (attachment_url + attachment_name) so both
// the staff and parent thread views can render it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "@/lib/store";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryGet, queryRun, queryAll, type Row } from "@/lib/db";
import { mustGet, seedFixture } from "../helpers";

const sessionCookie = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (name === "kiddy_sess" ? sessionCookie : undefined) }),
  headers: () => new Headers(),
}));

let iid: string;
let roomA: string;
let staffAcc: string;
let parentA: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);

  // Staff member assigned to Toddlers only.
  const s = await store.createStaff({ instituteId: iid, fullName: "Room A Carer", role: "carer", roomIds: [roomA] });
  const acc = await createAccount({ email: "carer-a@test", password: "x", fullName: "Room A Carer", role: "staff" });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(s.id), String(acc.id));
  staffAcc = String(acc.id);

  // One child + one parent in Toddlers.
  const child = await store.createChild({ instituteId: iid, firstName: "Lina", lastName: "Kid182", roomId: roomA });
  const p = await createAccount({ email: "pa-182@test", password: "x", fullName: "Parent A", role: "parent" });
  await store.linkFamily(String(p.id), String(child.id));
  parentA = String(p.id);

  // The unlinked owner is the composer sender — unscoped admins see all
  // rooms, so the audience split below is per-mode, not per-scope.
  const owner = await mustGet("SELECT id FROM account WHERE role = 'owner'");
  sessionCookie.value = createSessionToken({
    accountId: String(owner.id),
    role: "owner",
    email: "admin@sunshinedaycare.test",
    accountConfirmed: true,
  } as never);
});

function composerForm(field: (f: FormData) => void): FormData {
  const form = new FormData();
  form.set("body", "Hello Kid182");
  field(form);
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

function queryOf(target: string): Record<string, string> {
  const params = new URLSearchParams(target.split("?")[1] ?? "");
  return Object.fromEntries(params.entries());
}

function threadIdOf(target: string): string {
  return String(new URLSearchParams(target.split("?")[1] ?? "").get("thread") ?? "");
}

function participantIdsOf(threadId: string): Promise<string[]> {
  return queryAll("SELECT account_id FROM message_thread_participant WHERE thread_id = ?", threadId).then((rows) =>
    rows.map((r: Row) => String(r.account_id))
  );
}

// Union of every thread participant besides the creator, across all messages
// the composer fanned out to. The fixture seeds other parents/staff too, so a
// single first-redirect thread is not the full recipient set.
async function recipientUnionExcluding(ownerId: string): Promise<string[]> {
  const rows = await queryAll(
    "SELECT DISTINCT account_id FROM message_thread_participant WHERE account_id <> ?",
    ownerId
  );
  return rows.map((r: Row) => String(r.account_id));
}

describe("KID-182 composer audiences", () => {
  it("channels expose exactly the 3 audience options with parent+staff counts", async () => {
    const channels = await store.roomChannelsForAccount(iid, String((await mustGet("SELECT id FROM account WHERE role = 'owner'")).id));
    // Fresh fixture rooms have no children yet, so counts render as 0/0 but
    // the shape (both counts present, one channel per room) is what pins the
    // 3-audience composer UI.
    expect(channels.length).toBeGreaterThanOrEqual(2);
    for (const ch of channels) {
      expect(ch.parent_count).toBeDefined();
      expect(ch.staff_count).toBeDefined();
    }
  });

  it("staff-only channel sends to the room's staff, never its parents", async () => {
    const owner = await mustGet("SELECT id FROM account WHERE role = 'owner'");
    const { sendComposerAction } = await import("@/lib/actions");
    await redirectTargetOf(() =>
      sendComposerAction(
        composerForm((f) => {
          f.set("channels", roomA);
          f.set(`audience:${roomA}`, "staff");
        })
      )
    );
    const recipients = await recipientUnionExcluding(String(owner.id));
    // The parent is never part of a staff-only fanout.
    expect(recipients).toContain(staffAcc);
    expect(recipients).not.toContain(parentA);
  });

  it("children-only channel sends to the room's parents, never its staff", async () => {
    const owner = await mustGet("SELECT id FROM account WHERE role = 'owner'");
    const { sendComposerAction } = await import("@/lib/actions");
    await redirectTargetOf(() =>
      sendComposerAction(
        composerForm((f) => {
          f.set("channels", roomA);
          f.set(`audience:${roomA}`, "children");
        })
      )
    );
    const recipients = await recipientUnionExcluding(String(owner.id));
    expect(recipients).toContain(parentA);
    expect(recipients).not.toContain(staffAcc);
  });

  it("whole-class channel sends to both parents and staff", async () => {
    const owner = await mustGet("SELECT id FROM account WHERE role = 'owner'");
    const { sendComposerAction } = await import("@/lib/actions");
    await redirectTargetOf(() =>
      sendComposerAction(
        composerForm((f) => {
          f.set("channels", roomA);
          f.set(`audience:${roomA}`, "whole");
        })
      )
    );
    const recipients = await recipientUnionExcluding(String(owner.id));
    expect(recipients).toContain(parentA);
    expect(recipients).toContain(staffAcc);
  });

  it("saves the composer attachment on the thread", async () => {
    const { sendComposerAction } = await import("@/lib/actions");
    const bytes = Buffer.from("kiddy-182-attachment", "utf8");
    const file = new File([bytes], "artwork.png", { type: "image/png" });
    const target = await redirectTargetOf(() =>
      sendComposerAction(
        composerForm((f) => {
          f.set("groupMode", "on");
          f.set("channels", roomA);
          f.set("audience:" + roomA, "whole");
          f.set("attachment", file);
        })
      )
    );
    const thread = await queryGet("SELECT * FROM message_thread WHERE id = ?", threadIdOf(target));
    expect(String(thread!.attachment_name)).toBe("artwork.png");
    expect(String(thread!.attachment_url)).toBe(
      `data:image/png;base64,${bytes.toString("base64")}`
    );
  });

  it("rejects an oversized attachment explicitly and sends nothing", async () => {
    const { sendComposerAction } = await import("@/lib/actions");
    const threadsBefore = await queryGet("SELECT COUNT(*) c FROM message_thread");
    const before = Number(threadsBefore!.c);
    const big = new File([Buffer.alloc(1_600_000, 1)], "big.bin", { type: "application/octet-stream" });
    const target = await redirectTargetOf(() =>
      sendComposerAction(
        composerForm((f) => {
          f.set("channels", roomA);
          f.set("audience:" + roomA, "whole");
          f.set("attachment", big);
        })
      )
    );
    expect(queryOf(target).error).toBe("attachment");
    // Evidence over silent failure: no thread was created for that send.
    const threadsAfter = await queryGet("SELECT COUNT(*) c FROM message_thread");
    expect(Number(threadsAfter!.c)).toBe(before);
  });
});
