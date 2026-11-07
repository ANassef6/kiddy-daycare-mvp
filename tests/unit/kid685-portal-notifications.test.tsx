// KID-685 (KID-488 D8): the admin/staff portal notification center.
//
// User report (KID-215): the portal bell showed 2 unread notifications but
// /portal/notifications had no list and no "Mark all as read" (the parent app
// had both), and a new admin notification arrived without sound.
//
// Pinned here, mirroring the issue acceptance:
//   1. /portal/notifications lists the signed-in account's durable
//      notification rows (the same table unreadNotificationCount counts), so
//      the bell count and the list finally agree — the old derived
//      activity feed stays on the page as a secondary "Recent activity"
//      section.
//   2. The list returns ONLY the caller's rows — the same account has
//      notification rows for other accounts, they never render.
//   3. Tenant isolation — a row emitted for the caller under a different
//      institute id (host tenant mismatch) is filtered out of the page.
//   4. The server-scoped mark-all-read action (markNotificationReadAction)
//      clears ONLY the caller's rows, drives the unread count to zero, and
//      revalidates BOTH shells (/portal/notifications and
//      /child/notifications) so a cleared badge never goes stale.
//   5. The KID-480 in-app sound watcher now rides the portal layout too, and
//      one genuinely new unread row triggers exactly ONE sound attempt
//      (mocked audio; a repeat count, the opt-out switch and the silent
//      baseline establish not making sounds).
//   6. EN + AR parity for the new/reused page keys.
//
// Harness: the kid472 mocked-headers pattern (SQLite fixture, no server);
// server pages rendered with renderToStaticMarkup. The sound watcher runs
// from the extracted startNotificationSoundWatcher loop with fake timers and
// a mocked fetch + audio factory.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createAccount, createSessionToken, type Session } from "@/lib/auth";
import {
  createDaycare,
  emitNotifications,
  listNotificationsFor,
  sendMessage,
  unreadNotificationCount,
} from "@/lib/store";
import { dictionaries, tr } from "@/lib/i18n";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";
import { startNotificationSoundWatcher } from "@/components/NotificationSoundWatcher";

const mockState = vi.hoisted(() => ({
  cookie: "" as string,
  host: "" as string,
  revalidatedPaths: [] as string[],
}));
vi.mock("next/headers", () => ({
  headers: () => {
    const entries: Record<string, string> = {};
    if (mockState.cookie) entries.cookie = mockState.cookie;
    if (mockState.host) entries.host = mockState.host;
    return new Headers(entries);
  },
  cookies: () => ({
    get: () =>
      mockState.cookie ? { name: "kiddy_sess", value: mockState.cookie.replace(/^kiddy_sess=/, "") } : undefined,
    set: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
  redirect: () => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockState.revalidatedPaths.push(p),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

function sessionCookieFor(accountId: string, role: string, email: string): string {
  const session: Session = { accountId, role, email, emailConfirmed: true };
  return `kiddy_sess=${createSessionToken(session)}`;
}

const unique = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}@test.local`;

let sunshineIid: string;
let ownerId: string;
let staffBId: string;
let parentAccountId: string;

beforeEach(async () => {
  await seedFixture();
  mockState.cookie = "";
  mockState.host = "";
  mockState.revalidatedPaths = [];
  sunshineIid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  ownerId = String((await queryGet("SELECT id FROM account WHERE role = 'owner'"))!.id);
  parentAccountId = String((await queryGet(`SELECT id FROM account WHERE email = 'parent@example.test'`))!.id);
  const staffB = await createAccount({
    email: unique("staffb"),
    password: "staffb-pass-1",
    fullName: "Bree Colleague",
    role: "staff",
  });
  staffBId = String(staffB.id);
});

async function renderNotificationsPage(accountId = ownerId): Promise<string> {
  const account = await queryGet("SELECT role, email FROM account WHERE id = ?", accountId);
  mockState.cookie = sessionCookieFor(accountId, String(account!.role), String(account!.email));
  const { default: Page } = await import("@/app/portal/notifications/page");
  return renderToStaticMarkup(await Page());
}

// The unread border the page pins per unread row (same constant the parent
// center renders), so "rows on the page" is countable from markup.
const UNREAD_MARK = 'border-left:3px solid var(--brand-primary)';
const countUnreadRowMarks = (html: string): number => html.split(UNREAD_MARK).length - 1;

// ---- 1. the list exists and the bell count agrees with it ---------------------
describe("the portal notification list (count vs list mismatch fixed)", () => {
  it("reproduces the report scenario: unread rows render, with Mark all as read", async () => {
    // The user report: 2 unread rows counted by the bell, but a page with no
    // list and no clearing action. Two message notifications for the admin
    // account are the same setup.
    await sendMessage({
      instituteId: sunshineIid,
      senderAccountId: parentAccountId,
      recipientAccountId: ownerId,
      body: "Can Maya stay late?",
    });
    await sendMessage({
      instituteId: sunshineIid,
      senderAccountId: parentAccountId,
      recipientAccountId: ownerId,
      body: "Second note",
    });
    expect(await unreadNotificationCount(ownerId)).toBe(2);

    const html = await renderNotificationsPage();
    // Both durable rows are listed, newest first, each with a per-row read
    // button and the unread marker — and the page's unread row count equals
    // the count the bell shows.
    expect(html).toContain("Message from");
    expect(html).toContain("Can Maya stay late?");
    expect(html).toContain("Second note");
    expect(html).toContain("Mark all as read");
    expect(countUnreadRowMarks(html)).toBe(2);
    expect(await unreadNotificationCount(ownerId)).toBe(2);
    expect(countUnreadRowMarks(html)).toBe(await unreadNotificationCount(ownerId));
  });

  it("keeps the derived activity feed as a secondary section", async () => {
    const html = await renderNotificationsPage();
    expect(html).toContain("Recent activity");
  });
});

// ---- 2. the list is scoped to the caller's account ---------------------------
describe("the list returns only the caller's rows", () => {
  it("another account's notification rows never render on my page", async () => {
    await emitNotifications({
      instituteId: sunshineIid,
      accountIds: [ownerId],
      activity: "messages",
      kind: "message",
      payload: { senderName: "Mine Sender", body: "row for the owner" },
      ref: "kid685-owner-row",
    });
    await emitNotifications({
      instituteId: sunshineIid,
      accountIds: [staffBId],
      activity: "messages",
      kind: "message",
      payload: { senderName: "Bree Sender", body: "row for the colleague" },
      ref: "kid685-staffb-row",
    });

    const html = await renderNotificationsPage();
    expect(html).toContain("row for the owner");
    expect(html).not.toContain("row for the colleague");

    const colleagueHtml = await renderNotificationsPage(staffBId);
    expect(colleagueHtml).toContain("row for the colleague");
    expect(colleagueHtml).not.toContain("row for the owner");
  });
});

// ---- 3. tenant isolation -------------------------------------------------------
describe("tenant isolation on the portal list", () => {
  it("a row tagged to another institute never renders, even for the same account", async () => {
    const other = await createDaycare({
      name: "Maple Grove Notifications",
      ownerEmail: unique("maple"),
      ownerPassword: "maple-owner-1",
      ownerFullName: "Maple Owner",
    });
    await emitNotifications({
      instituteId: sunshineIid,
      accountIds: [ownerId],
      activity: "messages",
      kind: "message",
      payload: { senderName: "Host Sender", body: "host tenant row" },
      ref: "kid685-host-row",
    });
    // Simulates a.cross-tenant row for the caller: stored under the account,
    // but tagged with ANOTHER institute's id — /child/notifications has always
    // filtered these, the portal list must too.
    await emitNotifications({
      instituteId: other.instituteId,
      accountIds: [ownerId],
      activity: "messages",
      kind: "message",
      payload: { senderName: "Foreign Sender", body: "foreign tenant row" },
      ref: "kid685-foreign-row",
    });

    const html = await renderNotificationsPage();
    expect(html).toContain("host tenant row");
    expect(html).not.toContain("foreign tenant row");
  });
});

// ---- 4. mark all as read: server-scoped, count reaches zero, both shells ------
describe("the mark-all-as-read action", () => {
  it("clears ONLY the caller's rows; the unread count reaches zero; both paths revalidate", async () => {
    await sendMessage({
      instituteId: sunshineIid,
      senderAccountId: parentAccountId,
      recipientAccountId: ownerId,
      body: "First",
    });
    await sendMessage({
      instituteId: sunshineIid,
      senderAccountId: parentAccountId,
      recipientAccountId: ownerId,
      body: "Second",
    });
    await sendMessage({
      instituteId: sunshineIid,
      senderAccountId: parentAccountId,
      recipientAccountId: staffBId,
      body: "Colleague stays unread",
    });
    expect(await unreadNotificationCount(ownerId)).toBe(2);
    expect(await unreadNotificationCount(staffBId)).toBe(1);

    // Signed-in as the owner: mark all of THEIR rows read via the same
    // server action the page's buttons post to.
    mockState.cookie = sessionCookieFor(ownerId, "owner", "trois4ever+admin@gmail.com");
    const { markNotificationReadAction } = await import("@/lib/actions");
    const formData = new FormData();
    formData.set("id", "all");
    await markNotificationReadAction(formData);

    expect(await unreadNotificationCount(ownerId)).toBe(0);
    // The colleague's unread row is untouched.
    expect(await unreadNotificationCount(staffBId)).toBe(1);
    // Both shells refresh: a cleared portal badge must not go stale, and the
    // parent center stays live for the same action.
    expect(mockState.revalidatedPaths).toContain("/portal/notifications");
    expect(mockState.revalidatedPaths).toContain("/child/notifications");
  });

  it("marks a single row read through the same scoped store call", async () => {
    await sendMessage({
      instituteId: sunshineIid,
      senderAccountId: parentAccountId,
      recipientAccountId: ownerId,
      body: "One",
    });
    await sendMessage({
      instituteId: sunshineIid,
      senderAccountId: parentAccountId,
      recipientAccountId: ownerId,
      body: "Two",
    });
    const rows = await listNotificationsFor(ownerId);
    const target = rows.find((r) => !r.read_at);
    expect(target).toBeDefined();
    expect(await unreadNotificationCount(ownerId)).toBe(2);

    // The per-row button path (id=<row>) — scoped to the caller's account by
    // the WHERE clause, proven at the store boundary the action delegates to.
    const { markNotificationRead } = await import("@/lib/store");
    await markNotificationRead(ownerId, String(target!.id));
    expect(await unreadNotificationCount(ownerId)).toBe(1);
  });
});

// ---- 5. the portal sound watcher ----------------------------------------------
describe("the in-app notification sound for the portal", () => {
  it("the portal layout mounts the same watcher the parent shell uses", () => {
    const layout = path.join(process.cwd(), "app", "portal", "layout.tsx");
    expect(existsSync(layout)).toBe(true);
    const source = readFileSync(layout, "utf8");
    expect(source).toContain("NotificationSoundWatcher");
  });

  it("a new unread row triggers exactly ONE sound attempt (mocked audio)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let unread = 0;
      const play = vi.fn();
      const audioInstances: Array<Record<string, unknown>> = [];
      const flush = () => new Promise((r) => setImmediate(r));
      const fetchFn = vi.fn(async () => ({
        ok: true,
        json: async () => ({ count: unread }),
      })) as never;

      const stop = startNotificationSoundWatcher({
        audioFactory: () => {
          // A mock Audio whose play() resolves like the real element and
          // fires onended, so the watcher re-arms after every playback.
          const audio: { play: unknown; onended: null; onerror: null } = {
            play: undefined,
            onended: null,
            onerror: null,
          };
          audio.play = () => {
            play();
            void Promise.resolve().then(() => {
              (audio.onended as (() => void) | null)?.();
            });
          };
          audioInstances.push(audio);
          return audio as never;
        },
        fetchFn,
        getSoundPref: () => null,
        getLastUnread: () => null,
        setLastUnread: () => undefined,
      });

      // Baseline: no count yet known, the first poll stays silent.
      await flush();
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(play).not.toHaveBeenCalled();

      // A new unread row arrives -> the next tick attempts the sound ONCE.
      unread = 1;
      await vi.advanceTimersByTimeAsync(45_000);
      await flush();
      expect(play).toHaveBeenCalledTimes(1);

      // No further new rows -> no repeat sound on the following ticks.
      await vi.advanceTimersByTimeAsync(45_000);
      await flush();
      await vi.advanceTimersByTimeAsync(45_000);
      await flush();
      expect(play).toHaveBeenCalledTimes(1);

      // One attempt per threshold crossing: 1 -> 3 plays once.
      unread = 3;
      await vi.advanceTimersByTimeAsync(45_000);
      await flush();
      expect(play).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the opt-out switch keeps the portal silent; sound needs a page interaction in real browsers", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let unread = 0;
      const play = vi.fn().mockResolvedValue(undefined);
      const flush = () => new Promise((r) => setImmediate(r));
      const fetchFn = vi.fn(async () => ({
        ok: true,
        json: async () => ({ count: unread }),
      })) as never;

      const stop = startNotificationSoundWatcher({
        audioFactory: () => ({ play, onended: null, onerror: null }) as never,
        fetchFn,
        // kiddy:notificationSound === "off" (the KID-480 settings switch).
        getSoundPref: () => "off",
        getLastUnread: () => null,
        setLastUnread: () => undefined,
      });
      await flush();
      unread = 2;
      await vi.advanceTimersByTimeAsync(45_000);
      await flush();
      expect(play).not.toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---- 6. EN + AR parity --------------------------------------------------------
describe("EN + AR parity for the portal notification page", () => {
  it("the new and reused page keys ship localized in both dictionaries", () => {
    const keys = [
      "notifications.subtitle",
      "notifications.activityTitle",
      "parent.notificationsMarkAll",
      "parent.notificationsMarkOne",
      "parent.notificationsEmpty",
      "parent.notificationsUnreadAria",
    ];
    for (const key of keys) {
      for (const locale of ["en", "ar"] as const) {
        const text = tr(dictionaries[locale], key);
        expect(text, `${locale} empty for ${key}`).not.toBe("");
        expect(text, `${locale} missing: ${key}`).not.toContain("MISSING:");
      }
    }
  });

  it("labels the new copy exactly", () => {
    expect(dictionaries.en.notifications.activityTitle).toBe("Recent activity");
    expect(dictionaries.ar.notifications.activityTitle).toBe("النشاط الحديث");
    expect(dictionaries.en.notifications.subtitle).toContain("your account");
    expect(dictionaries.ar.notifications.subtitle).toContain("حسابك");
  });
});
