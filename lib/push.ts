// KID-480: web push (VAPID) for the PWA/TWA parent surface.
// KID-487: the same pipeline is now the general rule — staff accounts
// subscribe from the portal and receive every emitted notification kind with
// role-resolved deep links; push rides emitNotifications for all kinds.
//
// Server-only module: it stores subscriptions, gates delivery on the
// account's `notification_pref` (channel 'push', mirroring the KID-474
// `inapp` channel) and sends VAPID pushes with the `web-push` library.
//
// Hard rules honored here:
//   * best-effort delivery — a push failure is logged, never thrown; the
//     underlying business write (message, report, announcement) must never
//     break because push is unavailable or misconfigured.
//   * a subscription endpoint is UNIQUE: parent permission is per browser,
//     so re-subscribing re-points the same row (migration 0032).
//   * stale subscription rows (404/410 from the push service) are deleted
//     lazily by the sender — no background cleanup job.
//   * VAPID keys never enter the repo; they arrive via env vars
//     (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, public key may also be set as
//     NEXT_PUBLIC_VAPID_PUBLIC_KEY) supplied through Paperclip secrets.
//   * unsupported devices degrade cleanly: no subscriptions means zero work,
//     and every caller survives the sender being unavailable.

import { queryAll, queryGet, queryRun, uid, type Row } from "./db";

export type VapidConfig = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  tag?: string;
};

/** Injectable sender so unit tests can observe sends without a network. */
export type PushSender = (args: {
  subscription: Row;
  payload: string;
  config: VapidConfig;
}) => Promise<void>;

/** The KID-474 view-copy pipeline: raw payload → account locale → title/body. */
export async function pushCopyFor(
  accountId: string,
  kind: string,
  payload: Record<string, unknown>
): Promise<{ title: string; body: string }> {
  let title = String(payload.title ?? "") || "Kiddy";
  let body = String(payload.body ?? "");
  try {
    const [{ i18nForAccount }, { notificationViewCopy }, { feedCopyFor }] = await Promise.all([
      import("./i18n-session"),
      import("./store"),
      import("./i18n"),
    ]);
    const { locale } = await i18nForAccount(accountId);
    const view = notificationViewCopy(kind, payload, feedCopyFor(locale));
    if (view.title) title = view.title;
    if (view.body) body = view.body;
    else if (view.meta) body = view.meta;
  } catch (err) {
    console.error(`KID-480 push copy fallback (account=${accountId}):`, err);
  }
  return { title, body };
}

// KID-487: the same event deep-links to the parent surface (/child/...) or the
// staff portal (/portal/...) depending on the receiving account's role. Staff
// roles: owner/admin/teacher/caregiver — everything else lands parent-side.
export const STAFF_ROLES = ["owner", "admin", "teacher", "caregiver"] as const;

export function isStaffRole(role: string | null | undefined): boolean {
  return (STAFF_ROLES as readonly string[]).includes(String(role ?? ""));
}

/** Deep link the service worker opens / focuses on notification click. */
export function pushDeepUrl(
  kind: string,
  payload: Record<string, unknown>,
  role?: string | null
): string {
  const childId = String(payload.childId ?? "");
  if (isStaffRole(role)) {
    if (kind === "message") {
      const threadId = String(payload.threadId ?? "");
      return threadId ? `/portal/messages?thread=${threadId}` : "/portal/messages";
    }
    if (kind === "daily_report") return childId ? `/portal/children/${childId}` : "/portal/reports";
    if (kind === "announcement" || kind === "newsfeed") return "/portal/newsfeed";
    if (kind === "chatwoot_message") return "/portal/support";
    if (kind === "attendance") return "/portal/attendance";
    // KID-486: the planned-pickup set/changed event (same emission pipeline).
    if (kind === "pickup_time") return childId ? `/portal/children/${childId}` : "/portal/attendance";
    if (kind === "incident") return "/portal/incidents";
    if (kind === "event") return "/portal/calendar";
    if (kind === "homework") return "/portal/learning/homework";
    if (kind === "supplies") return "/portal/supplies";
    if (kind === "billing") return "/portal/finance";
    if (kind === "test") return "/portal/notifications";
    return "/portal";
  }
  if (kind === "message") {
    const threadId = String(payload.threadId ?? "");
    return threadId ? `/child/messages?thread=${threadId}` : "/child/messages";
  }
  if (kind === "daily_report") return childId ? `/child/${childId}` : "/child";
  if (kind === "announcement" || kind === "newsfeed") return "/child/newsfeed";
  if (kind === "chatwoot_message") return "/child/support";
  if (kind === "attendance") return childId ? `/child/${childId}` : "/child";
  // KID-486: planned-pickup events are pickup-surface events; parents follow
  // the child profile.
  if (kind === "pickup_time") return childId ? `/child/${childId}` : "/child";
  if (kind === "incident") return "/child/incidents";
  if (kind === "event") return "/child/events";
  if (kind === "test") return "/child/notifications";
  return "/child/newsfeed";
}

/** Public VAPID key (browser-facing) — falls back to the server-side name. */
export function vapidPublicKey(env: Record<string, string | undefined> = process.env): string {
  return (env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? env.VAPID_PUBLIC_KEY ?? "").trim();
}

/** Server VAPID pair used to sign push requests; null when not configured. */
export function vapidConfig(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = vapidPublicKey(env);
  const privateKey = (env.VAPID_PRIVATE_KEY ?? "").trim();
  if (!publicKey || !privateKey) return null;
  const subject = (env.VAPID_SUBJECT ?? "").trim() || "mailto:kiddy-push@kiddy.local";
  return { subject, publicKey, privateKey };
}

export function isValidPushEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).protocol === "https:";
  } catch {
    return false;
  }
}

export function isPushSubscriptionInput(value: unknown): value is PushSubscriptionInput {
  const sub = value as PushSubscriptionInput | null;
  return (
    !!sub &&
    typeof sub.endpoint === "string" &&
    isValidPushEndpoint(sub.endpoint) &&
    typeof sub.keys?.p256dh === "string" &&
    typeof sub.keys.auth === "string"
  );
}

/** Insert-or-repoint by the unique browser endpoint. */
export async function savePushSubscription(
  accountId: string,
  sub: PushSubscriptionInput,
  userAgent?: string
): Promise<void> {
  await queryRun(
    `INSERT INTO push_subscription (id, account_id, endpoint, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    uid(),
    accountId,
    sub.endpoint,
    sub.keys.p256dh,
    sub.keys.auth,
    userAgent ?? null
  );
  await queryRun(
    `UPDATE push_subscription
       SET account_id = ?, p256dh = ?, auth = ?, user_agent = ?
     WHERE endpoint = ?`,
    accountId,
    sub.keys.p256dh,
    sub.keys.auth,
    userAgent ?? null,
    sub.endpoint
  );
}

export async function removePushSubscription(accountId: string, endpoint: string): Promise<void> {
  await queryRun(
    `DELETE FROM push_subscription WHERE account_id = ? AND endpoint = ?`,
    accountId,
    endpoint
  );
}

export async function pushSubscriptionsFor(accountId: string): Promise<Row[]> {
  return queryAll(
    `SELECT * FROM push_subscription WHERE account_id = ? ORDER BY created_at ASC`,
    accountId
  );
}

// The production sender; swapped via `sender` in sendPushToAccounts for tests.
const defaultSender: PushSender = async ({ subscription, payload, config }) => {
  const webpush = (await import("web-push")).default;
  await webpush.sendNotification(
    {
      endpoint: String(subscription.endpoint),
      keys: { p256dh: String(subscription.p256dh), auth: String(subscription.auth) },
    },
    payload,
    { vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey }, TTL: 60 * 60 * 24 * 2 }
  );
};

const isStaleSubscriptionError = (err: unknown): boolean => {
  const status = (err as { statusCode?: unknown })?.statusCode;
  return status === 404 || status === 410;
};

/** Push opt-out: a stored disabled `notification_pref` row suppresses push;
 *  a missing row defaults to enabled for accounts holding a subscription. */
export async function isPushEnabled(accountId: string, activity: string): Promise<boolean> {
  const row = await queryGet(
    `SELECT enabled FROM notification_pref
     WHERE account_id = ? AND activity = ? AND channel = 'push'`,
    accountId,
    activity
  );
  return !row || Number(row.enabled) !== 0;
}

/**
 * Best-effort push fan-out for freshly emitted notification rows.
 * Honors the account locale for the title/body, per-activity push opt-out,
 * and never throws (each failure is logged). Returns the number of delivered
 * pushes (0 when nothing is configured/subscribed — a plain no-op).
 */
export async function sendPushToAccounts(
  accountIds: string[],
  data: {
    activity: string;
    kind: string;
    payload: Record<string, unknown>;
    ref: string;
  },
  opts: { sender?: PushSender } = {}
): Promise<number> {
  const ids = [...new Set(accountIds.map(String))];
  if (ids.length === 0) return 0;
  const sender = opts.sender ?? defaultSender;
  let delivered = 0;
  for (const accountId of ids) {
    try {
      if (data.activity && !(await isPushEnabled(accountId, data.activity))) continue;
      const subscriptions = await pushSubscriptionsFor(accountId);
      if (subscriptions.length === 0) continue;
      const config = vapidConfig();
      if (!config) {
        console.error(
          `KID-480 push configured=false: VAPID keys missing, ${subscriptions.length} subscription(s) for account=${accountId} skipped (ref=${data.ref})`
        );
        continue;
      }
      const { title, body } = await pushCopyFor(accountId, data.kind, data.payload);
      // KID-487: the deep link follows the receiving account's surface — a
      // teacher/owner lands in the staff portal, a parent inside the PWA.
      const roleRow = await queryGet("SELECT role FROM account WHERE id = ?", accountId);
      const role = String(roleRow?.role ?? "parent");
      const payload: PushPayload = {
        title,
        body,
        icon: "/brand-icon.svg",
        url: pushDeepUrl(data.kind, data.payload, role),
        tag: data.ref,
      };
      for (const subscription of subscriptions) {
        try {
          await sender({ subscription, payload: JSON.stringify(payload), config });
          delivered += 1;
        } catch (err) {
          if (isStaleSubscriptionError(err)) {
            // The browser is gone/unsubscribed: drop the row so future sends
            // don't retry dead endpoints forever.
            await removePushSubscription(accountId, String(subscription.endpoint));
          } else {
            console.error(`KID-480 push send failed (endpoint ends ...${String(subscription.endpoint).slice(-16)}, ref=${data.ref}):`, err);
          }
        }
      }
    } catch (err) {
      console.error(`KID-480 push fan-out failed (account=${accountId}, ref=${data.ref}):`, err);
    }
  }
  return delivered;
}
