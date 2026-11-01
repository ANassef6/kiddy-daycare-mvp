import Link from "next/link";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { requireSession } from "@/lib/require";
import { i18nForAccount } from "@/lib/i18n-session";
import { feedCopyFor, fmtDateFor, fmtDateTimeFor, tr, type Dict, type Locale } from "@/lib/i18n";
import { recentActivityFeed, type ActivityItem } from "@/lib/store";

export const dynamic = "force-dynamic";

const TYPE_ICONS: Record<string, string> = {
  newsfeed: "📰",
  homework: "📝",
  supplies: "📦",
  billing: "💳",
  attendance: "⏰",
  incidents: "⚠️",
};

// KID-221: two mixed-language leaks on this page — the English time-ago
// suffixes ("5m ago", "just now") and the English feed templates that
// lib/store emitted for the feed data. Both now follow the account locale:
// the time-ago is built from the `parent.notifications*` keys, and the feed
// receives FeedCopy for that locale.
function ActivityRow({ item, locale, dict }: { item: ActivityItem; locale: Locale; dict: Dict }) {
  const when = new Date(item.timestamp);
  const timeAgo = formatTimeAgo(locale, dict, when);
  return (
    <div className="list-item" style={{ alignItems: "flex-start", gap: 12 }}>
      <span style={{ fontSize: 20 }} aria-hidden="true">{TYPE_ICONS[item.type] ?? "•"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
          <Link href={item.link} className="small" style={{ fontWeight: 700, color: "var(--brand-primary)" }}>
            {item.title}
          </Link>
          <span className="small muted" title={fmtDateTimeFor(locale, item.timestamp)}>{timeAgo}</span>
        </div>
        {item.body && <p className="small muted" style={{ margin: "4px 0 0", whiteSpace: "pre-line" }}>{item.body}</p>}
        {item.meta && <div className="small muted mt-1">{item.meta}</div>}
      </div>
    </div>
  );
}

function formatTimeAgo(locale: Locale, dict: Dict, when: Date): string {
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

export default async function PortalNotificationsPage() {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const iid = await resolveTenantInstituteId();
  const feed = iid
    ? await recentActivityFeed(String(iid), session.accountId, 50, feedCopyFor(locale))
    : [];

  return (
    <div>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h1 className="title">{t("notifications.title")}</h1>
        <Link className="btn btn-ghost small" href="/portal/account">{t("notifications.managePrefs")}</Link>
      </div>
      <p className="subtitle">{t("notifications.subtitle")}</p>

      <div className="card">
        {feed.length === 0 ? (
          <p className="muted">{t("notifications.noActivity")}</p>
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
