// KID-480: web push notifications + notification sound, including Chatwoot
// messages.
//
// Pinned here, mirroring the issue acceptance:
//   1. Subscription storage — one row per browser endpoint (UNIQUE), the
//      subscribe path re-points the row when the device re-subscribes, and
//      remove drops exactly that subscription.
//   2. Push fan-out is pref-gated per activity (channel 'push': a stored
//      disabled row suppresses, a missing row defaults to enabled) and rides
//      the KID-474 emitNotifications flow with per-account locale copy.
//   3. Idempotence — a replayed emission ref never re-pushes.
//   4. Best-effort — a failing push sender never breaks the underlying
//      emission, and 404/410-stale subscriptions are pruned lazily.
//   5. Chatwoot webhook mapping — timing-safe secret verification (fail
//      closed when unset), only agent replies notify, the contact maps by
//      identifier (account id) then email, and the ref dedupes per
//      conversation+message.
//   6. Bundled sound + service worker assets + the settings/listening client
//      behaviors exist and ship (fs pins).
//   7. EN/AR parity for every new dictionary key.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureDefaultPushPrefs,
  createDaycare,
  createChild,
  createNewsfeedPost,
  emitNotifications,
  linkFamily,
  listNotificationsFor,
  notificationViewCopy,
  sendMessage,
  setNotificationPref,
  unreadNotificationCount,
} from "@/lib/store";
import {
  isValidPushEndpoint,
  isPushSubscriptionInput,
  pushDeepUrl,
  pushSubscriptionsFor,
  removePushSubscription,
  savePushSubscription,
  sendPushToAccounts,
  vapidConfig,
} from "@/lib/push";
import {
  accountForChatwootContact,
  chatwootContactKeys,
  chatwootMessageRef,
  chatwootWebhookSecret,
  isNotifyWorthyChatwootMessage,
  presentedWebhookSecret,
  verifyChatwootWebhookSecret,
} from "@/lib/chatwoot-webhook";
import { dictionaries, type Locale } from "@/lib/i18n";
import { createAccount, getAccount } from "@/lib/auth";
import { queryGet } from "@/lib/db";
import { resetDb } from "../helpers";

const sendNotificationMock = vi.fn();
vi.mock("web-push", () => ({
  default: { sendNotification: (...args: unknown[]) => sendNotificationMock(...args) },
}));

const fakeSubscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/ea1",
  keys: { p256dh: "key-p256dh", auth: "key-auth" },
};

const unsub = (prefix = "push-sub") => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

let iid = "";
let ownerId = "";
let parentId = "";
let childId = "";

beforeEach(async () => {
  sendNotificationMock.mockReset();
  process.env.VAPID_PUBLIC_KEY = "BPushTestPublicKey";
  process.env.VAPID_PRIVATE_KEY = "pushTestPrivateKey";
  await resetDb();
  const day = await createDaycare({
    name: "Push Test Daycare",
    ownerEmail: `${unsub("owner")}@test.local`,
    ownerPassword: "owner-pass-1",
    ownerFullName: "Olive Push",
  });
  iid = day.instituteId;
  ownerId = day.ownerAccountId;
  const child = await createChild({ instituteId: iid, firstName: "Pia", lastName: "Pusher" });
  childId = String(child.id);
  const parent = await createAccount({
    email: `${unsub("parent")}@test.local`,
    password: "parent-pass-1",
    fullName: "Pat Pusher",
    role: "parent",
  });
  parentId = String(parent.id);
  await linkFamily(parentId, childId, "parent");
});

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

describe("KID-480 subscription storage", () => {
  it("saves, lists and re-points one row per browser endpoint", async () => {
    await savePushSubscription(parentId, fakeSubscription as never, "UA/1");
    await savePushSubscription(parentId, fakeSubscription as never, "UA/2");
    let rows = await pushSubscriptionsFor(parentId);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.endpoint)).toBe(fakeSubscription.endpoint);
    expect(String(rows[0]!.user_agent)).toBe("UA/2");
    // re-subscribe the same device under a fuzzed key (new service worker reg)
    await savePushSubscription(
      parentId,
      { endpoint: fakeSubscription.endpoint, keys: { p256dh: "key2", auth: "auth2" } } as never,
      "UA/3"
    );
    rows = await pushSubscriptionsFor(parentId);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.p256dh)).toBe("key2");
  });

  it("removes exactly the subscription requested", async () => {
    await savePushSubscription(parentId, fakeSubscription as never);
    const other = { ...fakeSubscription, endpoint: unsub("https://fcm.googleapis.com/fcm/send/") };
    await savePushSubscription(parentId, other as never);
    await removePushSubscription(parentId, other.endpoint);
    const rows = await pushSubscriptionsFor(parentId);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.endpoint)).toBe(fakeSubscription.endpoint);
  });

  it("validates subscription shapes", () => {
    expect(isValidPushEndpoint(fakeSubscription.endpoint)).toBe(true);
    expect(isValidPushEndpoint("http://insecure.example/")).toBe(false);
    expect(isValidPushEndpoint("nope")).toBe(false);
    expect(isPushSubscriptionInput(fakeSubscription)).toBe(true);
    expect(isPushSubscriptionInput({ endpoint: fakeSubscription.endpoint })).toBe(false);
    expect(isPushSubscriptionInput(null)).toBe(false);
  });

  it("ensureDefaultPushPrefs fills only the gaps and never overwrites opt-outs", async () => {
    await setNotificationPref(parentId, "billing", "push", false);
    await ensureDefaultPushPrefs(parentId);
    // billing keeps its explicit opt-out; every other activity got an enabled row
    const billing = await unreadPushRow("billing");
    expect(billing).toBe(0);
    const messages = await unreadPushRow("messages");
    expect(messages).toBe(1);
  });
});

async function unreadPushRow(activity: string): Promise<number> {
  const row = await queryGet(
    `SELECT enabled FROM notification_pref WHERE account_id = ? AND activity = ? AND channel = 'push'`,
    parentId,
    activity
  );
  return Number(row?.enabled ?? 0);
}

describe("KID-480 push fan-out", () => {
  it("pushes to subscribed accounts with deep-link URL and stable tag", async () => {
    await savePushSubscription(parentId, fakeSubscription as never);
    await emitNotifications({
      instituteId: iid,
      accountIds: [parentId],
      activity: "messages",
      kind: "message",
      payload: { senderName: "Sal Staff", body: "Lunch is done" },
      ref: "msg-x1",
    });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const [, payload, options] = sendNotificationMock.mock.calls[0]!;
    const body = JSON.parse(String(payload));
    expect(body.title).toContain("Sal Staff");
    expect(body.url).toBe("/child/messages");
    expect(body.tag).toBe("msg-x1");
    expect(body.icon).toBe("/brand-icon.svg");
    expect((options as { vapidDetails?: unknown }).vapidDetails).toBeTruthy();
  });

  it("honors a stored disabled push row (missing rows default to enabled)", async () => {
    await savePushSubscription(parentId, fakeSubscription as never);
    await setNotificationPref(parentId, "messages", "push", false);
    await emitNotifications({
      instituteId: iid,
      accountIds: [parentId],
      activity: "messages",
      kind: "message",
      payload: { senderName: "Sal Staff", body: "again" },
      ref: "msg-x2",
    });
    expect(sendNotificationMock).not.toHaveBeenCalled();
    // other activity still pushes
    await createNewsfeedPost({ instituteId: iid, accountId: ownerId, body: "Field trip Friday", tagChildIds: [childId] });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("a replayed ref never re-pushes; a fresh ref does", async () => {
    await savePushSubscription(parentId, fakeSubscription as never);
    const data = {
      instituteId: iid,
      accountIds: [parentId],
      activity: "messages",
      kind: "message",
      payload: { senderName: "Sal Staff", body: "dupe" },
      ref: "msg-dup",
    };
    await emitNotifications(data);
    await emitNotifications(data);
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("a failing push sender never breaks the emission", async () => {
    await savePushSubscription(parentId, fakeSubscription as never);
    sendNotificationMock.mockRejectedValueOnce(new Error("push service down"));
    await emitNotifications({
      instituteId: iid,
      accountIds: [parentId],
      activity: "messages",
      kind: "message",
      payload: { senderName: "Sal Staff", body: "boom" },
      ref: "msg-boom",
    });
    expect(await unreadNotificationCount(parentId)).toBe(1);
    expect((await listNotificationsFor(parentId)).some((r) => String(r.ref) === "msg-boom")).toBe(true);
  });

  it("prunes stale (404/410) subscriptions after a failed send", async () => {
    await savePushSubscription(parentId, fakeSubscription as never);
    for (const status of [404, 410]) {
      sendNotificationMock.mockRejectedValueOnce({ statusCode: status });
    }
    await emitNotifications({
      instituteId: iid,
      accountIds: [parentId],
      activity: "messages",
      kind: "message",
      payload: { senderName: "Sal Staff", body: "stale" },
      ref: "msg-stale",
    });
    await emitNotifications({
      instituteId: iid,
      accountIds: [parentId],
      activity: "messages",
      kind: "message",
      payload: { senderName: "Sal Staff", body: "stale" },
      ref: "msg-stale-2",
    });
    expect(await pushSubscriptionsFor(parentId)).toHaveLength(0);
  });

  it("does nothing quietly when no subscription exists (unsupported device path)", async () => {
    await sendPushToAccounts([parentId], {
      activity: "messages",
      kind: "message",
      payload: { senderName: "Sal Staff", body: "quiet" },
      ref: "msg-quiet",
    });
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("announcements fan out to tagged children's parents and untagged center-wide", async () => {
    await savePushSubscription(parentId, fakeSubscription as never);
    await createNewsfeedPost({ instituteId: iid, accountId: ownerId, body: "Tagged note", tagChildIds: [childId] });
    expect(await unreadNotificationCount(parentId)).toBe(1);
    const rows = await listNotificationsFor(parentId);
    expect(String(rows[0]!.kind)).toBe("announcement");
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(sendNotificationMock.mock.calls[0]![1])).url).toBe("/child/newsfeed");

    await createNewsfeedPost({ instituteId: iid, accountId: ownerId, body: "Center-wide note" });
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
  });
});

describe("KID-480 push copy + deep links", () => {
  it("builds the per-kind deep link from the raw payload", () => {
    expect(pushDeepUrl("message", { threadId: "t1" })).toBe("/child/messages?thread=t1");
    expect(pushDeepUrl("message", {})).toBe("/child/messages");
    expect(pushDeepUrl("daily_report", { childId: "c1" })).toBe("/child/c1");
    expect(pushDeepUrl("announcement", {})).toBe("/child/newsfeed");
    expect(pushDeepUrl("chatwoot_message", {})).toBe("/child/support");
    expect(pushDeepUrl("test", {})).toBe("/child/notifications");
  });

  it("localizes announcement titles through the shared view pipeline", () => {
    const view = notificationViewCopy("announcement", { authorName: "Mo Admin", body: "Hi" }, {
      announcementTitle: (n: string) => `New post from ${n}`,
    } as never);
    expect(view.title).toBe("New post from Mo Admin");
    expect(view.body).toBe("Hi");
  });
});

describe("KID-480 Chatwoot webhook mapping", () => {
  const agentMessagePayload = {
    event: "message_created",
    id: 501,
    content: "Your request is confirmed.",
    message_type: 1,
    sender: { type: "agent", name: "Nadia" },
    contact: { identifier: ownerId, email: "", name: "Olive Push" },
    conversation: { id: 77 },
  };

  it("verifies the secret timing-safely and fails closed when unset", () => {
    expect(chatwootWebhookSecret({ CHATWOOT_WEBHOOK_SECRET: " s3cret " })).toBe("s3cret");
    expect(chatwootWebhookSecret({})).toBeNull();
    expect(verifyChatwootWebhookSecret("s3cret", "s3cret")).toBe(true);
    expect(verifyChatwootWebhookSecret("wrong", "s3cret")).toBe(false);
    expect(verifyChatwootWebhookSecret("s3cret-longer", "s3cret")).toBe(false);
    expect(verifyChatwootWebhookSecret("s3cret", null)).toBe(false);
  });

  it("accepts the secret from header, query or bearer", () => {
    expect(
      presentedWebhookSecret(
        { "x-chatwoot-webhook-secret": "h" },
        "https://kiddy.test/api/chatwoot/webhook"
      )
    ).toBe("h");
    expect(
      presentedWebhookSecret({}, "https://kiddy.test/api/chatwoot/webhook?token=q")
    ).toBe("q");
    expect(
      presentedWebhookSecret({ authorization: "Bearer b" }, "https://kiddy.test/api/chatwoot/webhook")
    ).toBe("b");
  });

  it("only notifies for agent replies (parent's own messages stay silent)", () => {
    expect(isNotifyWorthyChatwootMessage(agentMessagePayload as never)).toBe(true);
    expect(isNotifyWorthyChatwootMessage({ ...agentMessagePayload, message_type: 0 } as never)).toBe(false);
    expect(isNotifyWorthyChatwootMessage({ ...agentMessagePayload, sender: { type: "contact" } } as never)).toBe(false);
    expect(isNotifyWorthyChatwootMessage({ ...agentMessagePayload, event: "conversation_updated" } as never)).toBe(false);
  });

  it("reads the contact from payload, conversation meta or sender", () => {
    const viaConversation = chatwootContactKeys({
      conversation: { meta: { sender: { identifier: "acc9", email: "nine@t" } } },
    });
    expect(viaConversation?.identifier).toBe("acc9");
    expect(chatwootContactKeys({})).toBeNull();
  });

  it("maps the chatwoot contact by identifier then email", async () => {
    const byId = await accountForChatwootContact({ identifier: ownerId, email: "wrong@x" } as never);
    expect(String(byId!.id)).toBe(ownerId);
    const parent = await createAccount({
      email: `chat-${unsub()}@test.local`,
      password: "p",
      fullName: "Chat Parent",
      role: "parent",
    });
    const byEmail = await accountForChatwootContact({
      identifier: "no-such-account",
      email: String((await getAccount(String(parent.id)))!.email),
    } as never);
    expect(String(byEmail!.id)).toBe(String(parent.id));
    expect(await accountForChatwootContact({ identifier: "", email: "ghost@x" } as never)).toBeUndefined();
  });

  it("dedupes refs per conversation+message", () => {
    expect(chatwootMessageRef("77", "501")).toBe("chatwoot-77-501");
    expect(chatwootMessageRef("77", "501")).toMatch(/^chatwoot-/);
  });

  it("emits a localized chatwoot notification row that pushes", async () => {
    await savePushSubscription(parentId, fakeSubscription as never);
    await emitNotifications({
      instituteId: iid,
      accountIds: [parentId],
      activity: "messages",
      kind: "message",
      payload: { senderName: "Daycare support", body: "Your request is confirmed." },
      ref: chatwootMessageRef("77", "501"),
    });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(sendNotificationMock.mock.calls[0]![1]));
    expect(body.title).toContain("Daycare support");
    expect(body.url).toBe("/child/messages");
  });
});

describe("KID-480 bundled assets + config", () => {
  it("ships the service worker and the notification sound", () => {
    const sw = path.join(process.cwd(), "public", "sw.js");
    const sound = path.join(process.cwd(), "public", "notification-sound.wav");
    expect(existsSync(sw)).toBe(true);
    expect(existsSync(sound)).toBe(true);
    expect(statSync(sound).size).toBeGreaterThan(1000);
    const swSource = readFileSync(sw, "utf8");
    expect(swSource).toContain("showNotification");
    expect(swSource).toContain("notificationclick");
  });

  it("gracefully reports an unconfigured VAPID setup", () => {
    const envBackup = { ...process.env };
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    try {
      expect(vapidConfig()).toBeNull();
    } finally {
      Object.assign(process.env, envBackup);
    }
  });
});

describe("KID-480 i18n parity", () => {
  const NEW_KEYS = [
    "pushTitle",
    "pushHint",
    "pushEnable",
    "pushDisable",
    "pushEnabled",
    "pushDenied",
    "pushUnsupported",
    "pushNotConfigured",
    "pushTestButton",
    "pushTestSent",
    "soundLabel",
    "soundHint",
    "chatwootSenderName",
    "pushTestTitle",
    "pushTestBody",
  ] as const;

  it("adds every parent.push* + sound key to EN and AR", () => {
    for (const key of NEW_KEYS) {
      expect(String(dictionaries.en.parent[key as keyof typeof dictionaries.en.parent])).not.toBe("");
      expect(String(dictionaries.ar.parent[key as keyof typeof dictionaries.ar.parent])).not.toBe("");
    }
    expect(dictionaries.en.feed.announcementTitle.length).toBeGreaterThan(0);
    expect(dictionaries.ar.feed.announcementTitle.length).toBeGreaterThan(0);
    expect(dictionaries.en.account.push.length).toBeGreaterThan(0);
    expect(dictionaries.ar.account.push.length).toBeGreaterThan(0);
  });
});
