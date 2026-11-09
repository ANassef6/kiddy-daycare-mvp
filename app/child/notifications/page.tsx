import Link from "next/link";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { requireSession } from "@/lib/require";
import { i18nForAccount } from "@/lib/i18n-session";
import { feedCopyFor, fmtDateFor, fmtDateTimeFor, tr, type Dict, type Locale } from "@/lib/i18n";
import {
  listNotificationsFor,
  notificationViewCopy,
  type NotificationPayload,
} from "@/lib/store";
import { markNotificationReadAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

// KID-474: the parent notification center — a chronological list over the
// durable `notification` table (0031) with per-account read state, served
// for any authenticated tenant account (parents get family/message/report
// emissions; staff keep the KID-221 derived feed at /portal/notifications).
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

export default async function ChildNotificationsPage() {
  const session = await requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const iid = await resolveTenantInstituteId();
  const rows = await listNotificationsFor(session.accountId, 50);
  const filtered = rows.filter((r) => !r.institute_id || String(r.institute_id) === String(iid ?? ""));
  const copy = feedCopyFor(locale);

  return (
    <div>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h1 className="title">{t("parent.notificationsTitle")}</h1>
        <Link className="btn btn-ghost small" href="/child/settings">
          {t("parent.notifPrefsTitle")}
        </Link>
      </div>
      <p className="subtitle">{t("parent.notificationsSubtitle")}</p>

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
                console.error("KID-474 malformed notification payload:", err, String(row.id ?? ""));
              }
              const view = notificationViewCopy(String(row.kind ?? ""), parsed, copy);
              // KID-474 deep links: threads open the parent messaging thread,
              // daily reports open the child's page with the report.
              let href = "/child";
              if (String(row.kind ?? "") === "message") {
                const threadId = parsed.threadId ? String(parsed.threadId) : null;
                href = threadId ? `/child/messages?thread=${threadId}` : "/child/messages";
              } else if (String(row.kind ?? "") === "daily_report") {
                const childId = parsed.childId ? String(parsed.childId) : "";
                href = childId ? `/child/${childId}` : "/child";
              } else if (String(row.kind ?? "") === "invoice_created") {
                // KID-684: a new invoice opens the parent's invoice section
                // on the child surface — the same role-correct deep link the
                // push payload carries.
                const childId = parsed.childId ? String(parsed.childId) : "";
                href = childId ? `/child/${childId}#invoices` : "/child";
              }
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
                      <Link href={href} className="small" style={{ fontWeight: unread ? 700 : 500, color: "var(--brand-primary)" }}>
                        {view.title}
                      </Link>
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
    </div>
  );
}
