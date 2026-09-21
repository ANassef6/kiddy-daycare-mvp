import Link from "next/link";
import { requireSession } from "@/lib/require";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { listInstitutes, recentActivityFeed, type ActivityItem } from "@/lib/store";

export const dynamic = "force-dynamic";

const TYPE_ICONS: Record<string, string> = {
  newsfeed: "📰",
  homework: "📝",
  supplies: "📦",
  billing: "💳",
  attendance: "⏰",
  incidents: "⚠️",
};

function ActivityRow({ item, dict }: { item: ActivityItem; dict: any }) {
  const when = new Date(item.timestamp);
  const timeAgo = formatTimeAgo(when);
  return (
    <div className="list-item" style={{ alignItems: "flex-start", gap: 12 }}>
      <span style={{ fontSize: 20 }} aria-hidden="true">{TYPE_ICONS[item.type] ?? "•"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
          <Link href={item.link} className="small" style={{ fontWeight: 700, color: "var(--brand-primary)" }}>
            {item.title}
          </Link>
          <span className="small muted" title={when.toLocaleString()}>{timeAgo}</span>
        </div>
        {item.body && <p className="small muted" style={{ margin: "4px 0 0", whiteSpace: "pre-line" }}>{item.body}</p>}
        {item.meta && <div className="small muted mt-1">{item.meta}</div>}
      </div>
    </div>
  );
}

function formatTimeAgo(when: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - when.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return when.toLocaleDateString();
}

export default async function PortalNotificationsPage() {
  const session = requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const feed = iid ? await recentActivityFeed(String(iid), session.accountId, 50) : [];

  return (
    <div>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h1 className="title">{tr(dict, "notifications.title")}</h1>
        <Link className="btn btn-ghost small" href="/portal/account">{tr(dict, "notifications.managePrefs")}</Link>
      </div>
      <p className="subtitle">{tr(dict, "notifications.subtitle")}</p>

      <div className="card">
        {feed.length === 0 ? (
          <p className="muted">{tr(dict, "notifications.noActivity")}</p>
        ) : (
          <div>
            {feed.map((item) => (
              <ActivityRow key={`${item.type}-${item.id}`} item={item} dict={dict} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
