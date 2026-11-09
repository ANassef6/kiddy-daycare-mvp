import Link from "next/link";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { requireSession } from "@/lib/require";
import { i18nForAccount } from "@/lib/i18n-session";
import { feedCopyFor, fmtDateFor, fmtDateTimeFor, tr, type Dict, type Locale } from "@/lib/i18n";
import {
  listNotificationsFor,
  notificationViewCopy,
  recentActivityFeed,
  type ActivityItem,
  type NotificationPayload,
} from "@/lib/store";
import { markNotificationReadAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

const TYPE_ICONS: Record<string, string> = {
  newsfeed: "📰",
  homework: "📝",
  supplies: "📦",
  billing: "💳",
  attendance: "⏰",
  incidents: "⚠️",
  messages: "💬",
  daily_report: "📋",
};

function timeAgo(locale: Locale, dict: Dict, when: Date): string {
  const diffMs = Date.now() - when.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffMin < 1) return tr(dict, "parent.notificationsJustNow");
  if (diffMin < 60) return tr(dict, "parent.notificationsMinutesAgo", { count: diffMin });
  if (diffHour < 24) return tr(dict, "parent.notificationsHoursAgo", { count: diffHour });
  if (diffDay < 7) return tr(dict, "parent.notificationsDaysAgo", { count: diffDay });
  return fmtDateFor(locale, when);
}

// KID-685: staff deep links mirror the parent surface but land on the portal
// pages the role can actually open (threads open the portal messaging viewer;
// reports jump to the child's page; support replies open the staff inbox).
function staffHrefFor(kind: string, parsed: NotificationPayload): string | null {
  if (kind === "message") {
    const threadId = parsed.threadId ? String(parsed.threadId) : null;
    return threadId ? `/portal/messages?thread=${threadId}` : "/portal/messages";
  }
  if (kind === "announcement") return "/portal/newsfeed";
  if (kind === "daily_report") {
    const childId = parsed.childId ? String(parsed.childId) : "";
    return childId ? `/child/${childId}` : "/portal/children";
  }
  if (kind === "chatwoot_message") return "/portal/support-inbox";
  if (kind === "invoice_created") return "/portal/finance";
  if (kind === "test") return "/portal/notifications";
  return null;
}

function ActivityRow({ item, locale, dict }: { item: ActivityItem; locale: Locale; dict: Dict }) {
  const when = new Date(item.timestamp);
  const timeAgoText = timeAgo(locale, dict, when);
  return (
    <div className="list-item" style={{ alignItems: "flex-start", gap: 12 }}>
      <span style={{ fontSize: 20 }} aria-hidden="true">{TYPE_ICONS[item.type] ?? "•"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
          <Link href={item.link} className="small" style={{ fontWeight: 700, color: "var(--brand-primary)" }}>
            {item.title}
          </Link>
          <span className="small muted" title={fmtDateTimeFor(locale, item.timestamp)}>{timeAgoText}</span>
        </div>
        {item.body && <p className="small muted" style={{ margin: "4px 0 0", whiteSpace: "pre-line" }}>{item.body}</p>}
        {item.meta && <div className="small muted mt-1">{item.meta}</div>}
      </div>
    </div>
  );
}

export default async function PortalNotificationsPage() {
  const session = await requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const iid = await resolveTenantInstituteId();

  // KID-685 (KID-488 D8): the bell counts the durable `notification` rows for
  // the signed-in account, so this page lists exactly those rows — newest
  // first, with per-row read state and a server-scoped Mark-all-as-read —
  // instead of only the derived activity feed. The tenant filter mirrors
  // /child/notifications: a row from another center never lands on the page,
  // and the count the bell shows is always clearable here.
  const [rows, feed] = await Promise.all([
    listNotificationsFor(session.accountId, 50),
    iid ? recentActivityFeed(String(iid), session.accountId, 50, feedCopyFor(locale)) : [],
  ]);
  const filtered = rows.filter((r) => !r.institute_id || String(r.institute_id) === String(iid ?? ""));
  const copy = feedCopyFor(locale);

  return (
    <div>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h1 className="title">{t("notifications.title")}</h1>
        <Link className="btn btn-ghost small" href="/portal/account">{t("notifications.managePrefs")}</Link>
      </div>
      <p className="subtitle">{t("notifications.subtitle")}</p>

      {filtered.length > 0 && (
        <form action={markNotificationReadAction} className="mb-4">
          <input type="hidden" name="id" value="all" />
          <button className="btn btn-primary small" type="submit">
            {t("parent.notificationsMarkAll")}
          </button>
        </form>
      )}

      <div className="card">
        {filtered.length === 0 ? (
          <p className="muted">{t("parent.notificationsEmpty")}</p>
        ) : (
          <div>
            {filtered.map((row) => {
              const unread = row.read_at === null || row.read_at === undefined;
              let parsed: NotificationPayload = {};
              try {
                parsed = JSON.parse(String(row.payload ?? "{}"));
              } catch (err) {
                console.error("KID-685 malformed notification payload:", err, String(row.id ?? ""));
              }
              const kind = String(row.kind ?? "");
              const view = notificationViewCopy(kind, parsed, copy);
              const href = staffHrefFor(kind, parsed);
              const when = new Date(String(row.created_at));
              return (
                <div
                  key={String(row.id)}
                  className="list-item"
                  style={{
                    alignItems: "flex-start",
                    gap: 12,
                    borderLeft: unread ? "3px solid var(--brand-primary)" : undefined,
                    paddingLeft: unread ? 10 : 13,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                      {href ? (
                        <Link
                          href={href}
                          className="small"
                          style={{ fontWeight: unread ? 700 : 500, color: "var(--brand-primary)" }}
                        >
                          {view.title}
                        </Link>
                      ) : (
                        <span className="small" style={{ fontWeight: unread ? 700 : 500 }}>{view.title}</span>
                      )}
                      <span className="small muted" title={fmtDateTimeFor(locale, String(row.created_at))}>
                        {timeAgo(locale, dict, when)}
                      </span>
                    </div>
                    {view.body && <p className="small muted" style={{ margin: "4px 0 0", whiteSpace: "pre-line" }}>{view.body}</p>}
                    {view.meta && <div className="small muted mt-1">{view.meta}</div>}
                  </div>
                  {unread && (
                    <form action={markNotificationReadAction} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={String(row.id)} />
                      <button className="btn btn-ghost small" type="submit" aria-label={t("parent.notificationsUnreadAria")}>
                        {t("parent.notificationsMarkOne")}
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <h2 className="title mt-4" style={{ fontSize: 20 }}>{t("notifications.activityTitle")}</h2>
      <div className="card">
        {feed.length === 0 ? (
          <p className="muted">{tr(dict, "notifications.noActivity")}</p>
        ) : (
          <div>
            {feed.map((item) => (
              <ActivityRow key={`${item.type}-${item.id}`} item={item} locale={locale} dict={dict} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
