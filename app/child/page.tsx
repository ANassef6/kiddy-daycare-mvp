import Link from "next/link";
import { requireSession } from "@/lib/require";
import { familiesForAccount, todayStatus } from "@/lib/store";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function MyChildrenPage() {
  const session = requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const families = await familiesForAccount(session.accountId);

  if (families.length === 0) {
    return (
      <div className="card mt-5">
        <h1 className="title">{t("child.noChildrenLinked")}</h1>
        <p className="subtitle">
          {t("child.noChildrenHint")}
          <a className="mt-3 btn btn-primary" href="/register">{t("child.activateInvite")}</a>
        </p>
      </div>
    );
  }

  const withStatus = await Promise.all(
    families.map(async (child: any) => {
      const status = await todayStatus(child.id);
      return { child, status };
    })
  );

  return (
    <div>
      <h1 className="title">{t("child.myChildren")}</h1>
      <div className="grid">
        {withStatus.map(({ child, status }: any) => {
          const seen = status.lastEvent?.type === "in";
          return (
            <Link key={child.id} href={`/child/${child.id}`} className="card" style={{ color: "var(--color-text)" }}>
              <div className="status-card">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>
                    {child.first_name} {child.last_name}
                  </div>
                  <div className="muted small">{child.room_name ?? t("child.noRoom")}</div>
                </div>
                {status.checkedIn && !status.checkedOut ? (
                  <span className="badge badge-green">{t("attendees.checkedIn")}</span>
                ) : status.checkedOut ? (
                  <span className="badge badge-gray">{t("attendees.checkedOut")}</span>
                ) : (
                  <span className="badge">{t("attendees.notCheckedInYet")}</span>
                )}
              </div>
              {status.lastEvent && (
                <div className="muted small mt-2">
                  {seen
                    ? t("attendees.checkedInAt", { time: time(status.checkedIn?.recorded_at) })
                    : t("attendees.checkedOutAt", { time: time(status.checkedOut?.recorded_at) })}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function time(iso?: unknown): string {
  if (!iso) return "—";
  return new Date(String(iso)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}