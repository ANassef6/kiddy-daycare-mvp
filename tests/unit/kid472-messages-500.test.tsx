// KID-534 (KID-482 D-2) regression tests for the intermittent HTTP 500 on the
// parent /child/messages page.
//
// Production observation (KID-482 QA, 2026-11-07): 2 of 4 real-browser loads
// of /child/messages rendered "Application error … Digest: 3930614149" while
// every sequential curl load returned 200. The failure class is a transient
// rejection inside one of the reads the page awaits directly inside the
// server component: pre-fix that rejection was unhandled and Next served a
// dead-end 500; post-fix the page must log the failure, degrade to the
// recoverable "try again" state and never throw.
//
// Each test drives the real page component against the seeded local data
// layer (the same engine a local production build runs) and pins one
// dependency that may reject. The module mocks are passthrough wrappers: only
// the specific read under test fails; everything else runs for real, and the
// wrapper is restored to real behavior after every test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createSessionToken } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { mustGet, seedFixture } from "../helpers";

type AnyFn = (...args: never[]) => unknown;

// Each wrapped fn keeps a `__passthrough` handle so afterEach can restore the
// real implementation without re-importing the mock factory.
function wrapping(NAMES: string[]) {
  return async (importOriginal: () => Promise<Record<string, AnyFn>>) => {
    const actual = await importOriginal();
    const wrapped: Record<string, unknown> = {};
    for (const name of NAMES) {
      const real = actual[name];
      const fn = vi.fn(((...args: unknown[]) => (real as AnyFn)(...(args as never[]))) as AnyFn);
      Object.defineProperty(fn, "__passthrough", { value: real, enumerable: false });
      wrapped[name] = fn;
    }
    return { ...actual, ...wrapped };
  };
}

vi.mock(
  "@/lib/store",
  wrapping([
    "threadsForAccountScoped",
    "classroomStaffForParent",
    "conversation",
    "threadForViewer",
    "threadMessages",
  ])
);
vi.mock("@/lib/auth", wrapping(["getAccount"]));

import * as store from "@/lib/store";
import * as auth from "@/lib/auth";
import ParentMessagesPage from "@/app/child/messages/page";
import ParentMessagesError from "@/app/child/messages/error";

const SESSION_COOKIE = "kiddy_sess";
const sessionCookie = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (name === SESSION_COOKIE ? { value: sessionCookie.value } : undefined),
  }),
  headers: () =>
    new Headers(sessionCookie.value ? { cookie: `${SESSION_COOKIE}=${sessionCookie.value}` } : undefined),
}));

const CONTROLLED: (keyof typeof store | "getAccount")[] = [
  "threadsForAccountScoped",
  "classroomStaffForParent",
  "conversation",
  "threadForViewer",
  "threadMessages",
  "getAccount",
];

/** The controllable mock for one dependency read. */
function mockFor(name: (typeof CONTROLLED)[number]): Mock {
  const fn = (name === "getAccount" ? auth : store)[name as keyof (typeof auth | typeof store)];
  return fn as unknown as Mock;
}

let parentId: string;
let instituteId: string;

beforeEach(async () => {
  await seedFixture();
  instituteId = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  parentId = String((await mustGet("SELECT id FROM account WHERE email = 'parent@example.test'")).id);
  sessionCookie.value = createSessionToken(
    { accountId: parentId, role: "parent", email: "parent@example.test" } as never
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const name of CONTROLLED) {
    const fn = mockFor(name);
    const real = (fn as unknown as Record<string, unknown>).__passthrough as
      | ((...args: never[]) => unknown)
      | undefined;
    fn.mockReset();
    if (real) fn.mockImplementation(real as never);
  }
  vi.restoreAllMocks();
});

async function renderMessagesPage(searchParams: { thread?: string; to?: string; error?: string } = {}) {
  return renderToStaticMarkup(await ParentMessagesPage({ searchParams: Promise.resolve(searchParams) }));
}

/** A thread the seeded parent can open: owner Nassef is classroom staff for the parent's children. */
async function seededParentThread(): Promise<string> {
  const staff = String((await mustGet("SELECT id FROM account WHERE role = 'owner'")).id);
  const thread = await store.createMessageThread({
    instituteId: instituteId,
    title: "kid534 bounded thread",
    isGroup: false,
    createdBy: parentId,
    participantIds: [staff],
  });
  await store.sendMessage({
    instituteId: instituteId,
    senderAccountId: staff,
    recipientAccountId: parentId,
    body: "kid534 thread body",
    threadId: String(thread!.id),
  });
  return String(thread!.id);
}

describe("the failure class is bounded, not a 500", () => {
  it("renders the composer with no recovery state when every read succeeds", async () => {
    const markup = await renderMessagesPage();
    expect(markup).toContain('data-testid="messages-input"');
    expect(markup).toContain('data-testid="messages-send"');
    expect(markup).not.toContain('data-testid="messages-load-error"');
  });

  it("degrades to the recoverable state instead of throwing when the scoped thread read rejects", async () => {
    // The KID-482 digest failure shape: a transient store rejection inside the
    // render. Pre-fix this test threw out of the component (→ HTTP 500).
    mockFor("threadsForAccountScoped").mockRejectedValueOnce(new Error("simulated transient read failure"));
    const markup = await renderMessagesPage();
    expect(mockFor("threadsForAccountScoped")).toHaveBeenCalledTimes(1);
    expect(markup).toContain('data-testid="messages-load-error"');
    expect(markup).toContain('data-testid="messages-retry"');
    // Recovery must work without JavaScript: a plain anchor to the same route.
    expect(markup).toContain('href="/child/messages"');
    expect(markup).toContain("Try again");
  });

  it("degrades when the recipient read rejects and never offers a composer built on unknown recipients", async () => {
    mockFor("classroomStaffForParent").mockRejectedValueOnce(new Error("simulated recipient read failure"));
    const markup = await renderMessagesPage();
    expect(mockFor("classroomStaffForParent")).toHaveBeenCalledTimes(1);
    expect(markup).toContain('data-testid="messages-load-error"');
    // With the recipient set unknown, neither "here is the composer" nor "no
    // staff are available" is an honest claim — neither is rendered.
    expect(markup).not.toContain('data-testid="messages-input"');
    expect(markup).not.toContain('data-testid="messages-no-staff"');
  });

  it("degrades when the direct conversation read rejects", async () => {
    mockFor("conversation").mockRejectedValueOnce(new Error("simulated conversation read failure"));
    const markup = await renderMessagesPage();
    expect(mockFor("conversation")).toHaveBeenCalledTimes(1);
    expect(markup).toContain('data-testid="messages-load-error"');
    expect(markup).toContain('data-testid="messages-direct-load-error"');
  });

  it("keeps the thread card recoverable when the thread's message read rejects mid-render", async () => {
    const threadId = await seededParentThread();
    mockFor("threadMessages").mockRejectedValueOnce(new Error("simulated thread read failure"));
    const markup = await renderMessagesPage({ thread: threadId });
    expect(mockFor("threadMessages")).toHaveBeenCalledTimes(1);
    expect(markup).toContain('data-testid="messages-load-error"');
    expect(markup).toContain('data-testid="messages-thread-load-error"');
  });

  it("renders a recoverable state, never a re-throw, when the thread lookup rejects", async () => {
    const threadId = await seededParentThread();
    mockFor("threadForViewer").mockRejectedValueOnce(new Error("simulated thread lookup failure"));
    const markup = await renderMessagesPage({ thread: threadId });
    expect(mockFor("threadForViewer")).toHaveBeenCalledTimes(1);
    expect(markup).toContain('data-testid="messages-load-error"');
  });

  it("degrades to the English-fallback recovery state when the shared account read rejects", async () => {
    // getAccount backs both the locale resolution and the direct-conversation
    // identity; its first rejection degrades the page. The dict falls back to
    // English copy, current to the failure style used by the page.
    mockFor("getAccount").mockRejectedValueOnce(new Error("simulated account read failure"));
    const markup = await renderMessagesPage();
    expect(markup).toContain('data-testid="messages-load-error"');
    expect(markup).toContain("Try again");
  });

  it("renders the segment error boundary affordance for a digest-carrying exception", () => {
    const err = Object.assign(new Error("a server-side exception has occurred"), {
      digest: "3930614149",
    }) as Error & { digest?: string };
    const markup = renderToStaticMarkup(<ParentMessagesError error={err} reset={() => {}} />);
    expect(markup).toContain('data-testid="messages-boundary-retry"');
    expect(markup).toContain("Try again");
  });
});

// KID-534 acceptance: "parent sends a message, staff replies, parent re-reads
// the thread" — executed through the real production actions (the same code
// path the deployed forms close over), on the real data layer, then re-read
// both through the store and through a fresh server render.
describe("parent → staff → parent round trip still passes", () => {
  it("thread round trip: parent thread reply → staff thread reply → parent re-read renders both", async () => {
    const { sendParentMessageAction, replyThreadAction } = await import("@/lib/actions");
    const owner = await mustGet("SELECT id, email FROM account WHERE role = 'owner'");
    const thread = await store.createMessageThread({
      instituteId,
      title: "kid534 round trip thread",
      isGroup: false,
      createdBy: parentId,
      participantIds: [String(owner.id)],
    });
    const threadId = String(thread!.id);

    // Parent leg: reply inside the existing thread (the exact composer form
    // the /child/messages thread card renders).
    const parentBody = `kid534 parent-to-staff ping ${Date.now()}`;
    const fd = new FormData();
    fd.set("threadId", threadId);
    // The production thread composer posts the hidden recipient alongside the
    // thread id (MessageComposerForm hiddenRecipientId).
    fd.set("recipientId", String(owner.id));
    fd.set("body", parentBody);
    await expectActionRedirect(() => sendParentMessageAction(fd), `/child/messages?thread=${threadId}`);

    // Staff leg: the same staff account replies inside the thread.
    const staffBody = `kid534 staff-to-parent reply ${Date.now()}`;
    sessionCookie.value = createSessionToken({
      accountId: String(owner.id),
      role: "owner",
      email: String(owner.email),
    } as never);
    const fd2 = new FormData();
    fd2.set("threadId", threadId);
    fd2.set("body", staffBody);
    await expectActionRedirect(
      () => replyThreadAction(fd2),
      `/portal/messages?thread=${threadId}`
    );

    // Parent re-read: a fresh server render of the page shows both legs.
    sessionCookie.value = createSessionToken({
      accountId: parentId,
      role: "parent",
      email: "parent@example.test",
    } as never);
    const visible = await store.threadsForAccountScoped(parentId);
    expect(visible.map((t: any) => String(t.id))).toContain(threadId);
    const markup = await renderMessagesPage({ thread: threadId });
    expect(markup).toContain(parentBody);
    expect(markup).toContain(staffBody);
    expect(markup).not.toContain('data-testid="messages-load-error"');
  });

  it("direct DM round trip: parent DM → staff reply → parent re-read of the direct surface", async () => {
    const { sendParentMessageAction, sendMessageAction } = await import("@/lib/actions");
    const owner = await mustGet("SELECT id, email FROM account WHERE role = 'owner'");

    const parentBody = `kid534 parent DM ${Date.now()}`;
    const fd = new FormData();
    fd.set("recipientId", String(owner.id));
    fd.set("body", parentBody);
    await expectActionRedirect(() => sendParentMessageAction(fd), "/child/messages");

    const staffBody = `kid534 staff DM reply ${Date.now()}`;
    sessionCookie.value = createSessionToken({
      accountId: String(owner.id),
      role: "owner",
      email: String(owner.email),
    } as never);
    const fd2 = new FormData();
    fd2.set("recipientId", parentId);
    fd2.set("body", staffBody);
    await expectActionRedirect(() => sendMessageAction(fd2), `/portal/messages?with=${parentId}`);

    sessionCookie.value = createSessionToken({
      accountId: parentId,
      role: "parent",
      email: "parent@example.test",
    } as never);
    const direct = await store.conversation(parentId, String(owner.id));
    expect(direct.map((m: any) => String(m.body))).toContain(parentBody);
    expect(direct.map((m: any) => String(m.body))).toContain(staffBody);
    const markup = await renderMessagesPage();
    expect(markup).toContain(parentBody);
    expect(markup).toContain(staffBody);
  });
});

/**
 * Captures a `redirect()` from a server action as its target string.
 */
async function expectActionRedirect(run: () => Promise<unknown>, target: string): Promise<void> {
  let captured = "";
  try {
    await run();
  } catch (err) {
    const digest = String((err as { digest?: unknown })?.digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) {
      captured = digest.split(";")[2] ?? "";
      if (captured === target) return;
      throw new Error(`action redirected to "${captured}", expected "${target}"`);
    }
    throw err;
  }
  throw new Error(`expected the action to redirect to "${target}", but it returned normally`);
}
