import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import {
  getChild,
  todayStatus,
  reportFor,
  listContacts,
  newsfeedForChild,
  incidentsForChild,
  statusesForChild,
} from "@/lib/store";
import { CheckInButton } from "@/components/CheckInButton";
import Avatar from "@/components/Avatar";
import { getBranding } from "@/lib/theme";
import { toggleLikeAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ChildDetailPage({ params }: { params: { id: string } }) {
  const session = requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const child = await getChild(params.id);
  if (!child) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const status = await todayStatus(child.id);
  const checkedIn = !!status.checkedIn && !status.checkedOut;
  const [report, contacts, feed, incidents, statuses] = await Promise.all([
    reportFor(child.id, today),
    listContacts(child.id),
    newsfeedForChild(child.id, session.accountId),
    incidentsForChild(child.id),
    statusesForChild(child.id, today),
  ]);

  const meal = safeJson(report?.meal);
  const sleep = report?.sleep ? String(report.sleep) : "";
  const branding = await getBranding();

  return (
    <div>
      <Link className="small muted" href="/child">← {t("child.backToChildren")}</Link>

      <div className="card mt-3">
        <div className="status-card">
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            {/* #5a child avatar placeholder (photo upload later) */}
            <Avatar src={child.photo_url} name={`${child.first_name} ${child.last_name}`} size={56} color={branding.primaryColor} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 22 }}>
                {child.first_name} {child.last_name}
              </div>
              <div className="muted small">{child.dob ?? t("child.noDob")} · {child.room_name ?? t("child.noRoom")}</div>
            </div>
          </div>
          {checkedIn ? (
            <span className="badge badge-green">{t("attendees.checkedIn")}</span>
          ) : (
            <span className="badge">{t("attendees.notCheckedInYet")}</span>
          )}
        </div>

        <div className="mt-4">
          <CheckInButton childId={child.id as string} checkedIn={checkedIn} dict={dict} />
        </div>

        {status.lastEvent && (
          <p className="muted small mt-2">
            {status.checkedIn && t("attendees.checkedInAt", { time: time(status.checkedIn.recorded_at) })}
            {status.checkedIn && status.checkedOut && " · "}
            {status.checkedOut && t("attendees.checkedOutAt", { time: time(status.checkedOut.recorded_at) })}
          </p>
        )}
      </div>

      <h2 className="title mt-5">{t("child.todaysUpdates")}</h2>
      {statuses.length === 0 ? (
        <p className="muted small">{t("child.noUpdatesYet")}</p>
      ) : (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {statuses.map((s: any) => (
            <div className="list-item small" key={s.id}>
              <span className={`status-chip status-chip-${String(s.kind)}`}>{kindLabel(String(s.kind))}</span>
              <div>
                <strong>{statusValue(String(s.kind), String(s.value), t)}</strong>
                {s.note ? <span className="muted"> — {s.note}</span> : null}
              </div>
              <span className="muted">{time(s.recorded_at)}</span>
            </div>
          ))}
        </div>
      )}

      <h2 className="title mt-5">{t("child.todaysReport")}</h2>
      {report ? (
        <div className="card">
          {report.mood && (
            <p className="small"><strong>{t("child.mood")}:</strong> {capital(report.mood)}</p>
          )}
          {report.summary && <p className="mt-2">{report.summary}</p>}
          {report.observation && (
            <p className="muted small mt-2"><strong>{t("child.observation")}:</strong> {report.observation}</p>
          )}
          {meal?.breakfast || meal?.lunch || meal?.snack ? (
            <div className="row mt-3">
              {meal.breakfast && (<div className="col card small"><strong>{t("child.breakfast")}</strong><div>{meal.breakfast}</div></div>)}
              {meal.lunch && (<div className="col card small"><strong>{t("child.lunch")}</strong><div>{meal.lunch}</div></div>)}
              {meal.snack && (<div className="col card small"><strong>{t("child.snack")}</strong><div>{meal.snack}</div></div>)}
            </div>
          ) : null}
          {sleep && <p className="muted small mt-2"><strong>{t("child.sleep")}:</strong> {sleep}</p>}
          {report.diaper && <p className="muted small mt-2"><strong>{t("child.diaper")}:</strong> {report.diaper}</p>}
          {report.sick ? <p className="muted small mt-2" style={{ color: "#b91c1c" }}><strong>{t("child.sickToday")}</strong></p> : null}
          {report.note && <p className="muted small mt-2"><strong>{t("common.notes")}:</strong> {report.note}</p>}
        </div>
      ) : (
        <p className="muted small">{t("child.noReportYet")}</p>
      )}

      <h2 className="title mt-5">{t("child.newsfeed")}</h2>
      {feed.length === 0 ? (
        <p className="muted small">{t("child.nothingPostedFor", { name: child.first_name })}</p>
      ) : (
        feed.map((post: any) => (
          <div className="card mb-4" key={post.id}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="small muted">{post.author_name} · {new Date(post.created_at).toLocaleString()}</div>
              <form action={toggleLikeAction}>
                <input type="hidden" name="postId" value={post.id} />
                <button
                  type="submit"
                  className={post.liked ? "badge badge-green" : "badge badge-gray"}
                  style={{ cursor: "pointer", border: "none", fontSize: 12 }}
                  title={post.liked ? t("child.unlike") : t("child.like")}
                >
                  {post.liked ? "♥" : "♡"} {post.like_count}
                </button>
              </form>
            </div>
            <p className="mt-2">{post.body}</p>
            {post.media_url && <img src={post.media_url} alt="" style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 8, marginTop: 10 }} />}
          </div>
        ))
      )}

      <h2 className="title mt-5">{t("child.pickupContacts")}</h2>
      {contacts.length === 0 ? (
        <p className="muted small">{t("child.noContacts")}</p>
      ) : (
        contacts.map((c: any) => (
          <div className="list-item" key={c.id}>
            <div>
              <div style={{ fontWeight: 600 }}>{c.full_name} <span className="muted">({c.relationship})</span></div>
              <div className="muted small">{c.phone}{c.email ? ` · ${c.email}` : ""}</div>
            </div>
            <div>
              {c.is_pickup && <span className="badge">{t("child.pickup")}</span>}{" "}
              {c.is_emergency && <span className="badge badge-red">{t("child.emergency")}</span>}
            </div>
          </div>
        ))
      )}

      {incidents.length > 0 && (
        <>
          <h2 className="title mt-5">{t("child.incidentReports")}</h2>
          {incidents.map((i: any) => (
            <div className="card mb-3" key={i.id}>
              <div className="small muted">{capital(i.type)} · {new Date(i.created_at).toLocaleString()}</div>
              <p className="mt-2">{i.description}</p>
              <span className={i.acknowledged ? "badge badge-green" : "badge badge-red"}>
                {i.acknowledged ? t("child.acknowledged") : t("child.needsAcknowledgement")}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function safeJson(v: unknown): Record<string, string> {
  if (!v) return {};
  try {
    return JSON.parse(String(v)) as Record<string, string>;
  } catch {
    return {};
  }
}
function time(iso?: unknown): string {
  if (!iso) return "—";
  return new Date(String(iso)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function capital(s: unknown) {
  return capitalize(String(s ?? ""));
}
function kindLabel(kind: string): string {
  return capitalize(kind);
}
function statusValue(kind: string, value: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (kind === "sick" && value === "yes") return t("child.feelingSick");
  if (kind === "sick" && value === "no") return t("child.allGood");
  return capitalize(value);
}