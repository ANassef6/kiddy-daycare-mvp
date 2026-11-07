import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFamilyPage } from "@/lib/require";
import {
  getChild,
  isChildVisibleToAccount,
  todayStatus,
  reportFor,
  listContacts,
  newsfeedForChild,
  incidentsForChild,
  statusesForChild,
  familyAccessForAccount,
  familyLinkRoleForChild,
  parentCheckinEnabled,
  getPickupTime,
} from "@/lib/store";
import { CheckInButton } from "@/components/CheckInButton";
import Avatar from "@/components/Avatar";
import ContactBadges from "@/components/ContactBadges";
import DailyReportDateNav from "@/components/DailyReportDateNav";
import Attribution from "@/components/Attribution";
import { getBranding } from "@/lib/theme";
import { firstInstituteId, fmtDate } from "@/lib/helpers";
import { configuredReportDate, todayIso } from "@/lib/report-dates";
import { isPlatformOperatorRole } from "@/lib/platform";
import { toggleLikeAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ChildDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  // KID-472 item 4: ?date= selects which past day's report the parent reads.
  searchParams?: { date?: string };
}) {
  // KID-486: the shared access gate — pickup links are redirected to /child,
  // family links pass (view-only is enforced by actions), no_access never
  // reaches a parent page.
  const session = await requireFamilyPage(`/child/${params.id}`);
  const { dict, locale } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const child = await getChild(params.id);
  if (!child) notFound();

  // KID-372: a raw child id in the URL is not authorization. The portal twin
  // (app/portal/children/[id]/page.tsx) refuses out-of-scope children; this
  // parent surface used to render today's report, statuses, contacts and
  // incidents for ANY child id. Parents pass only through their own family
  // link, staff through the KID-103 classroom scope (lib/store.ts), and the
  // legacy first-institute fallback (empty request tenant) never renders a
  // child — fail closed exactly like the kid152/kid212 refusals.
  const requestIid = await firstInstituteId();
  const visible = requestIid
    ? await isChildVisibleToAccount(requestIid, session.accountId, String(child.id))
    : false;
  if (!visible && !(isPlatformOperatorRole(session.role) && requestIid)) notFound();

  // KID-486: the family-link access tier drives what this page allows.
  // Pickup links never reach here (isPathAllowedForPickup denies /child/:id);
  // family links read everything but see no check-in/out button, no like
  // button. A full parent link keeps its attendance loop — but only when the
  // center-wide parent check-in/out switch is on.
  const access =
    session.role === "parent" ? ((await familyAccessForAccount(session.accountId)) ?? "parent") : null;
  const canCheckInOut =
    access === "parent" &&
    !!requestIid &&
    (await parentCheckinEnabled(requestIid)) &&
    (await familyLinkRoleForChild(session.accountId, String(child.id))) === "parent";

  // KID-486: today's planned pickup rides the header so parents and staff
  // share the same schedule line (the pickup contact may still edit it).
  const today = todayIso();
  const plannedPickup = await getPickupTime(String(child.id), today);

  // KID-472 item 4: today stays the default; a `?date=` value the parent
  // navigates to is read-only for that day (validated server-side first).
  const reportDate = configuredReportDate(searchParams?.date, today);
  const status = await todayStatus(child.id);
  const checkedIn = !!status.checkedIn && !status.checkedOut;
  const [report, contacts, feed, incidents, statuses] = await Promise.all([
    reportFor(child.id, reportDate),
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
          {/* KID-486: the loop is parent-link + center-toggle only. Family
              links read attendance; the server actions refuse the rest. */}
          {canCheckInOut ? (
            <CheckInButton childId={child.id as string} checkedIn={checkedIn} dict={dict} />
          ) : access === "parent" ? (
            <p className="muted small">{t("child.checkinDisabled")}</p>
          ) : null}
        </div>

        <p className="muted small mt-2">
          {plannedPickup
            ? plannedPickup.note
              ? t("child.plannedPickupNote", { time: String(plannedPickup.pickup_time), note: String(plannedPickup.note) })
              : t("child.plannedPickup", { time: String(plannedPickup.pickup_time) })
            : t("child.noPlannedPickup")}
        </p>

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

      <h2 className="title mt-5">
        {reportDate === today
          ? t("child.todaysReport")
          : t("child.reportForDate", { date: fmtDate(reportDate) })}
      </h2>
      <DailyReportDateNav
        basePath={`/child/${child.id}`}
        date={reportDate}
        today={today}
        labels={{
          prev: t("child.reportPrevDay"),
          next: t("child.reportNextDay"),
          today: t("child.reportTodayChip"),
          pickDate: t("child.reportPickDate"),
        }}
      />
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
          <Attribution
            locale={locale}
            createdBy={report.created_by_name ?? null}
            createdAt={report.created_at ?? null}
            updatedBy={report.updated_by_name ?? null}
            updatedAt={report.updated_at ?? null}
          />
        </div>
      ) : (
        <p className="muted small">
          {reportDate === today ? t("child.noReportYet") : t("child.noReportForDate")}
        </p>
      )}

      <h2 className="title mt-5">{t("child.newsfeed")}</h2>
      {feed.length === 0 ? (
        <p className="muted small">{t("child.nothingPostedFor", { name: child.first_name })}</p>
      ) : (
        feed.map((post: any) => (
          <div className="card mb-4" key={post.id}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="small muted">{post.author_name} · {new Date(post.created_at).toLocaleString()}</div>
                {/* KID-486: likes are a business action — parent links only.
                    family/pickup keep the count as read-only text. */}
                {access === "parent" ? (
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
                ) : (
                  <span className={post.liked ? "badge badge-green" : "badge badge-gray"} style={{ fontSize: 12 }}>
                    {post.liked ? "♥" : "♡"} {post.like_count}
                  </span>
                )}
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
              <ContactBadges isPickup={c.is_pickup} isEmergency={c.is_emergency} dict={dict} />
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