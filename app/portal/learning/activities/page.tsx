import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listMedia, listEvents, listNewsfeed } from "@/lib/store";
import { createEventAction } from "@/lib/actions";
import { firstInstituteId, cap } from "@/lib/helpers";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalActivitiesPage() {
  const session = requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{t("learning.noInstitute")}</p>;

  const [media, events, newsfeed] = await Promise.all([
    listMedia(instituteId),
    listEvents(instituteId, true),
    listNewsfeed(instituteId),
  ]);

  const recentMedia = (media as any[]).slice(0, 10);
  const recentPosts = (newsfeed as any[]).slice(0, 5);

  return (
    <div>
      <h1 className="title">{t("activities.title")}</h1>
      <p className="subtitle">
        {t("activities.subtitle")}
        <Link href="/portal/events" className="small" style={{ fontWeight: 600, marginLeft: 4 }}>
          {t("activities.eventsAndVideo")}
        </Link>
        {t("activities.subtitleTail")}
      </p>

      <form className="card mb-4" action={createEventAction}>
        <h3 className="subtitle">{t("activities.newActivity")}</h3>
        <input type="hidden" name="returnTo" value="/portal/learning/activities" />
        <div className="row">
          <div className="col field"><label className="label">{t("activities.titleLabel")}</label><input className="input" name="title" required placeholder="e.g. Water play morning" /></div>
          <div className="col field"><label className="label">{t("activities.dateLabel")}</label><input className="input" name="eventDate" type="date" required /></div>
        </div>
        <div className="row">
          <div className="col field"><label className="label">{t("activities.start")}</label><input className="input" name="startTime" type="time" /></div>
          <div className="col field"><label className="label">{t("activities.end")}</label><input className="input" name="endTime" type="time" /></div>
          <div className="col field"><label className="label">{t("common.location")}</label><input className="input" name="location" placeholder="e.g. Garden" /></div>
        </div>
        <div className="field"><label className="label">{t("activities.description")}</label><textarea className="textarea" name="description" placeholder={t("activities.whatWillChildrenDo")} /></div>
        <button className="btn btn-primary" type="submit">{t("activities.createActivity")}</button>
      </form>

      {recentMedia.length > 0 && (
        <div className="card mb-4">
          <h3 className="subtitle">{t("activities.recentMedia")}</h3>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {recentMedia.map((m: any) => (
              <div key={m.id} style={{ width: 120 }}>
                <Link href={m.url} target="_blank" rel="noreferrer">
                  {m.kind === "video" ? (
                    <div style={{ width: 120, height: 80, borderRadius: 8, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#64748b" }}>▶ {t("activities.video")}</div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt={m.caption ?? ""} width={120} height={80} style={{ objectFit: "cover", borderRadius: 8 }} />
                  )}
                </Link>
                {m.caption && <div className="muted small mt-1" style={{ fontSize: 11 }}>{m.caption}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card mb-4">
        <h3 className="subtitle">{t("activities.upcomingEvents")}</h3>
        {events.length === 0 && <p className="muted small">{t("activities.noUpcomingEvents")}</p>}
        {(events as any[]).slice(0, 3).map((e: any) => (
          <div className="list-item" key={e.id}>
            <div className="small">
              <span className="badge">{cap(e.event_date)}</span> {e.title}
              {e.location ? <span className="muted"> · {e.location}</span> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="subtitle">{t("activities.recentNewsfeed")}</h3>
        {recentPosts.length === 0 && <p className="muted small">{t("activities.noPostsYet")}</p>}
        {recentPosts.map((p: any) => (
          <div className="list-item" key={p.id}>
            <div className="small">
              <strong>{p.author_name ?? t("activities.admin")}</strong> · {cap(p.created_at)}
              <div className="muted mt-1">{p.body?.slice(0, 120)}{p.body?.length > 120 ? "…" : ""}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}