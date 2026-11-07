import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import {
  getChild,
  isChildVisibleToAccount,
  todayStatus,
  reportFor,
  listContacts,
  newsfeedForChild,
  incidentsForChild,
  statusesForChild,
  listChildBilling,
  latestBusEvent,
} from "@/lib/store";
import { CheckInButton } from "@/components/CheckInButton";
import Avatar from "@/components/Avatar";
import ContactBadges from "@/components/ContactBadges";
import DailyReportDateNav from "@/components/DailyReportDateNav";
import Attribution from "@/components/Attribution";
import { getBranding } from "@/lib/theme";
import { firstInstituteId, fmtDate } from "@/lib/helpers";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { configuredReportDate, todayIso } from "@/lib/report-dates";
import { isPlatformOperatorRole } from "@/lib/platform";
import { toggleLikeAction, uploadPaymentProofAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { recordToolUsage } from "@/lib/tool-usage";

export const dynamic = "force-dynamic";

export default async function ChildDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  // KID-472 item 4: ?date= selects which past day's report the parent reads.
  // KID-489 item 3 (KID-492): ?error= surfaces the upload rejection reason,
  // ?proof=uploaded surfaces the success state.
  searchParams?: { date?: string; error?: string; proof?: string };
}) {
  const session = requireSession();
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
  await recordToolUsage({ instituteId: String(child.institute_id ?? "") || null, accountId: session.accountId, toolKey: "children", source: "child", metadata: null });

  // KID-472 item 4: today stays the default; a `?date=` value the parent
  // navigates to is read-only for that day (validated server-side first).
  const today = todayIso();
  const reportDate = configuredReportDate(searchParams?.date, today);
  const status = await todayStatus(child.id);
  const checkedIn = !!status.checkedIn && !status.checkedOut;
  // KID-494: the parent sees the current bus status derived from the bus
  // ledger — the same write path the staff roster and the sweep use.
  const bus = await latestBusEvent(String(child.id), today);
  const onBus = bus ? String(bus.type) === "on" : false;
  const [report, contacts, feed, incidents, statuses, invoices] = await Promise.all([
    reportFor(child.id, reportDate),
    listContacts(child.id),
    newsfeedForChild(child.id, session.accountId),
    incidentsForChild(child.id),
    statusesForChild(child.id, today),
    // KID-489 item 2 (KID-491): the parent's own invoices for this child. The
    // KID-372 gate above already refused any child the account has no
    // family link to, so this read can only surface the viewer's own
    // family's billing data — never another daycare family's.
    listChildBilling(child.id),
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
          {/* KID-494: the parent-facing bus badge — On bus (green) while the
              child is riding the bus, Off bus (gray) once set by staff or by
              the close+2h sweep. */}
          {bus && (
            <span className={`badge ${onBus ? "badge-green" : "badge-gray"}`}>
              {onBus ? t("attendees.busOn") : t("attendees.busOff")}
            </span>
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

      <h2 className="title mt-5">{t("child.invoicesTitle")}</h2>
      {searchParams?.error?.startsWith("proof") && (
        <div role="alert" className="card mb-2" style={{ borderLeft: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>
            {searchParams.error === "proofSize"
              ? t("child.payProofErrorSize")
              : searchParams.error === "proofUpload"
                ? t("child.payProofErrorUpload")
                : t("child.payProofErrorType")}
          </p>
        </div>
      )}
      {searchParams?.proof === "uploaded" && (
        <div role="status" className="card mb-2" style={{ borderLeft: "4px solid #047857" }}>
          <p className="small" style={{ margin: 0 }}>{t("child.payProofPendingReview")}</p>
        </div>
      )}
      {invoices.length === 0 ? (
        <p className="muted small">{t("child.noInvoices")}</p>
      ) : (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {invoices.map((b: any) => (
            <div className="list-item small" key={b.id}>
              <div>
                <strong>{b.period ?? b.description}</strong>
                {b.due_date ? (
                  <div className="muted">{t("child.invoiceDue", { date: fmtDate(b.due_date) })}</div>
                ) : null}
              </div>
              <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 10 }}>
                <div>
                  <strong>
                    {String(b.currency ?? DEFAULT_CURRENCY)} {((Number(b.amount_cents) || 0) / 100).toFixed(2)}
                  </strong>
                  <div>
                    <span className={`badge ${b.status === "paid" ? "badge-green" : b.status === "overdue" ? "badge-red" : "badge-gray"}`}>{String(b.status ?? "pending")}</span>
                  </div>
                </div>
                {b.payment_link && (
                  <a className="btn btn-accent" href={String(b.payment_link)} target="_blank" rel="noreferrer">
                    {t("child.payWithInstapay")}
                  </a>
                )}
              </div>
              {b.status !== "paid" && (
                <div className="mt-2" style={{ borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
                  {b.payment_proof_url && (
                    <div className="mb-2">
                      <a className="small" href={String(b.payment_proof_url)} target="_blank" rel="noreferrer">
                        {t("child.payProofView")}
                      </a>
                      {b.payment_reference ? (
                        <span className="muted small"> · {String(b.payment_reference)}</span>
                      ) : null}
                    </div>
                  )}
                  <form action={uploadPaymentProofAction}>
                    <input type="hidden" name="childId" value={String(child.id)} />
                    <input type="hidden" name="billingId" value={String(b.id)} />
                    <label className="label small">{t("child.payProofUpload")}</label>
                    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input
                        className="input"
                        name="file"
                        type="file"
                        accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
                        required
                        style={{ maxWidth: 260 }}
                      />
                      <input
                        className="input"
                        name="paymentReference"
                        placeholder={t("child.payProofPlaceholder")}
                        style={{ maxWidth: 200 }}
                      />
                      <button className="btn btn-ghost small" type="submit">
                        {b.payment_proof_url ? t("child.payProofReplace") : t("child.payProofUpload")}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
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