// KID-2455: per-message attachments + per-participant thread archive.
//
// Attachments live on the message row (attachment_url + attachment_name) so
// the bubble can render exactly the file that was sent. Archiving lives on
// message_thread_participant so one viewer never hides a thread for another,
// and a new message auto-unarchives it for its recipient.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as store from "@/lib/store";
import { createAccount, createSessionToken } from "@/lib/auth";
import { queryGet, queryRun, queryAll, type Row } from "@/lib/db";
import { dictionaries, tr } from "@/lib/i18n";
import { mustGet, seedFixture } from "../helpers";

const sessionCookie = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (name === "kiddy_sess" ? { value: sessionCookie.value } : undefined),
  }),
  headers: () =>
    new Headers(sessionCookie.value ? { cookie: `kiddy_sess=${sessionCookie.value}` } : undefined),
}));

let iid: string;
let roomA: string;
let staffAcc: string;
let parentA: string;
let ownerAcc: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomA = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);

  const s = await store.createStaff({ instituteId: iid, fullName: "Room A Carer", role: "carer", roomIds: [roomA] });
  const acc = await createAccount({ email: "carer-2455@test", password: "x", fullName: "Room A Carer", role: "staff" });
  await queryRun("UPDATE account SET staff_id = ? WHERE id = ?", String(s.id), String(acc.id));
  staffAcc = String(acc.id);

  const child = await store.createChild({ instituteId: iid, firstName: "Lina", lastName: "Kid2455", roomId: roomA });
  const p = await createAccount({ email: "pa-2455@test", password: "x", fullName: "Parent A", role: "parent" });
  await store.linkFamily(String(p.id), String(child.id));
  parentA = String(p.id);

  const owner = await mustGet("SELECT id FROM account WHERE role = 'owner'");
  ownerAcc = String(owner.id);
});

function asAccount(accountId: string, role: string) {
  sessionCookie.value = createSessionToken({
    accountId,
    role,
    email: `${accountId}@test`,
    accountConfirmed: true,
  } as never);
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
  return Object.fromEntries(new URLSearchParams(target.split("?")[1] ?? "").entries());
}

async function privateThread(viewer: string, other: string, title = "KID-2455 thread"): Promise<string> {
  const thread = await store.createMessageThread({
    instituteId: iid,
    title,
    isGroup: true,
    createdBy: viewer,
    participantIds: [other],
  });
  return String(thread.id);
}

describe("KID-2455 per-message attachments", () => {
  it("stores the composer attachment on every message row, not just the thread", async () => {
    asAccount(ownerAcc, "owner");
    const { sendComposerAction } = await import("@/lib/actions");
    const bytes = Buffer.from("kid2455-image", "utf8");
    const file = new File([bytes], "artwork.png", { type: "image/png" });
    const form = new FormData();
    form.set("body", "Look at this");
    form.set("groupMode", "on");
    form.set("channels", roomA);
    form.set("audience:" + roomA, "whole");
    form.set("attachment", file);
    const target = await redirectTargetOf(() => sendComposerAction(form));
    const threadId = String(queryOf(target).thread ?? "");

    const rows = await queryAll("SELECT * FROM message WHERE thread_id = ?", threadId);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(String(row.attachment_name)).toBe("artwork.png");
      expect(String(row.attachment_url)).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
    }
  });

  it("lets a parent reply with a file and records it on the reply row", async () => {
    const threadId = await privateThread(ownerAcc, parentA);
    asAccount(parentA, "parent");
    const { sendParentMessageAction } = await import("@/lib/actions");
    const bytes = Buffer.from("%PDF-1.4 kid2455", "utf8");
    const file = new File([bytes], "note.pdf", { type: "application/pdf" });
    const form = new FormData();
    form.set("recipientId", staffAcc);
    form.set("threadId", threadId);
    form.set("body", "The signed form");
    form.set("attachment", file);
    const target = await redirectTargetOf(() => sendParentMessageAction(form));
    expect(target).toContain("/child/messages");

    const row = await queryGet(
      "SELECT * FROM message WHERE thread_id = ? AND sender_account_id = ? ORDER BY created_at DESC LIMIT 1",
      threadId,
      parentA
    );
    expect(String(row!.attachment_name)).toBe("note.pdf");
    expect(String(row!.attachment_url)).toBe(`data:application/pdf;base64,${bytes.toString("base64")}`);
  });

  it("refuses a disallowed file type before any message is written", async () => {
    const threadId = await privateThread(ownerAcc, parentA);
    asAccount(parentA, "parent");
    const { sendParentMessageAction } = await import("@/lib/actions");
    const before = await queryGet("SELECT COUNT(*) c FROM message WHERE thread_id = ?", threadId);
    const form = new FormData();
    form.set("recipientId", staffAcc);
    form.set("threadId", threadId);
    form.set("body", "Executable?");
    form.set("attachment", new File([Buffer.from("MZ")], "tool.exe", { type: "application/x-msdownload" }));
    const target = await redirectTargetOf(() => sendParentMessageAction(form));
    expect(queryOf(target).error).toBe("attachment");
    const after = await queryGet("SELECT COUNT(*) c FROM message WHERE thread_id = ?", threadId);
    expect(Number(after!.c)).toBe(Number(before!.c));
  });
});

describe("KID-2455 thread archive", () => {
  it("archives per viewer: parent hides it, staff still see it Active", async () => {
    const threadId = await privateThread(ownerAcc, parentA);
    await store.setThreadArchived(threadId, parentA, true);

    const parentArchived = await store.threadsForAccount(parentA, { archived: true });
    expect(parentArchived.map((t: Row) => String(t.id))).toContain(threadId);
    const parentActive = await store.threadsForAccount(parentA, { archived: false });
    expect(parentActive.map((t: Row) => String(t.id))).not.toContain(threadId);

    const staffActive = await store.threadsForAccount(staffAcc, { archived: false });
    // staffAcc is not a participant of this thread; owner is.
    const ownerActive = await store.threadsForAccount(ownerAcc, { archived: false });
    expect(ownerActive.map((t: Row) => String(t.id))).toContain(threadId);
    expect(staffActive.map((t: Row) => String(t.id))).not.toContain(threadId);
  });

  it("unarchive returns the thread to Active", async () => {
    const threadId = await privateThread(ownerAcc, parentA);
    await store.setThreadArchived(threadId, parentA, true);
    await store.setThreadArchived(threadId, parentA, false);
    const active = await store.threadsForAccount(parentA, { archived: false });
    expect(active.map((t: Row) => String(t.id))).toContain(threadId);
  });

  it("a new message auto-unarchives the thread for its recipient", async () => {
    const threadId = await privateThread(ownerAcc, parentA);
    await store.setThreadArchived(threadId, parentA, true);
    await store.sendMessage({
      instituteId: iid,
      senderAccountId: ownerAcc,
      recipientAccountId: parentA,
      body: "New message wakes the thread",
      threadId,
    });
    const participant = await queryGet(
      "SELECT archived_at FROM message_thread_participant WHERE thread_id = ? AND account_id = ?",
      threadId,
      parentA
    );
    expect(participant!.archived_at).toBeNull();
    const active = await store.threadsForAccount(parentA, { archived: false });
    expect(active.map((t: Row) => String(t.id))).toContain(threadId);
  });

  it("the parent page shows the attach control and the Active/Archived toggle", async () => {
    await privateThread(ownerAcc, parentA);
    asAccount(parentA, "parent");
    const ParentMessagesPage = (await import("@/app/child/messages/page")).default;
    const active = renderToStaticMarkup(
      await ParentMessagesPage({ searchParams: Promise.resolve({}) })
    );
    expect(active).toContain('data-testid="messages-attach"');
    expect(active).toContain("Active");
    expect(active).toContain("Archived");
    expect(active).toContain("Archive");
  });

  it("the archived view lists archived threads with an Unarchive action", async () => {
    const threadId = await privateThread(ownerAcc, parentA, "Archived 2455 thread");
    await store.setThreadArchived(threadId, parentA, true);
    asAccount(parentA, "parent");
    const ParentMessagesPage = (await import("@/app/child/messages/page")).default;
    const archived = renderToStaticMarkup(
      await ParentMessagesPage({ searchParams: Promise.resolve({ archived: "1" }) })
    );
    expect(archived).toContain("Archived 2455 thread");
    expect(archived).toContain("Unarchive");
  });

  it("carries the attach/archive labels in English and Arabic", () => {
    for (const key of [
      "messages.attachFile",
      "messages.active",
      "messages.archived",
      "messages.archive",
      "messages.unarchive",
    ]) {
      expect(tr(dictionaries.en, key)).toBeTruthy();
      expect(tr(dictionaries.ar, key)).toBeTruthy();
    }
    expect(tr(dictionaries.en, "messages.attachFile")).toBe("Attach file");
    expect(tr(dictionaries.ar, "messages.archive")).toBe("أرشفة");
  });

  it("the archive action only changes the caller's participant row", async () => {
    const threadId = await privateThread(ownerAcc, parentA);
    asAccount(parentA, "parent");
    const { setThreadArchivedAction } = await import("@/lib/actions");
    const form = new FormData();
    form.set("threadId", threadId);
    form.set("archived", "1");
    form.set("returnTo", "/child/messages");
    const target = await redirectTargetOf(() => setThreadArchivedAction(form));
    expect(target).toBe("/child/messages");

    const parentRow = await queryGet(
      "SELECT archived_at FROM message_thread_participant WHERE thread_id = ? AND account_id = ?",
      threadId,
      parentA
    );
    const ownerRow = await queryGet(
      "SELECT archived_at FROM message_thread_participant WHERE thread_id = ? AND account_id = ?",
      threadId,
      ownerAcc
    );
    expect(parentRow!.archived_at).not.toBeNull();
    expect(ownerRow!.archived_at).toBeNull();
  });
});
