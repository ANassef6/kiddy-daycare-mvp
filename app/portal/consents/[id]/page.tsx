import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { getConsentBatch, listConsentRecipients } from "@/lib/store";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateTimeFor, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-2494: the founder needs to see WHO answered a consent, not only that it
// was answered. One send = one batch. This page lists every targeted child,
// grouped by classroom, with parent, response state, time and responder. The
// per-room line shows answered/pending at a glance. The same page serves a
// general ("All") send and a classroom send.
export default async function PortalConsentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const iid = await resolveTenantInstituteId();
  if (!iid) notFound();
  const batch = await getConsentBatch(iid, id);
  if (!batch) notFound();
  const recipients = await listConsentRecipients(iid, id);

  const statusBadge = (status: string) =>
    status === "approved"
      ? { css: "badge badge-green", label: t("consents.statusApproved") }
      : status === "denied"
        ? { css: "badge badge-red", label: t("consents.statusDenied") }
        : { css: "badge", label: t("consents.statusPending") };

  const answered = Number(batch.approved ?? 0) + Number(batch.denied ?? 0);
  const pending = Number(batch.pending ?? 0);
  const roomLabels = Array.from(
    new Set(
      recipients.map((row) =>
        row.child_id ? String(row.room_name ?? t("consents.noRoom")) : t("consents.generalAudience")
      )
    )
  );

  const groups = new Map<string, typeof recipients>();
  for (const row of recipients) {
    const key = row.child_id ? String(row.room_name ?? t("consents.noRoom")) : t("consents.generalAudience");
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  return (
    <div>
      <p className="small"><Link href="/portal/consents">← {t("consents.backToConsents")}</Link></p>
      <h1 className="title">{batch.title}</h1>
      <p className="muted small">
        {Number(batch.general_count ?? 0) > 0 && Number(batch.total ?? 0) === 1
          ? t("consents.generalAudience")
          : roomLabels.join(", ")}
        {" · "}
        {fmtDateTimeFor(locale, batch.created_at)}
        {" · "}
        {t("consents.answeredPending", { answered, pending })}
      </p>
      {batch.body ? <p className="card mb-4" dir="auto">{batch.body}</p> : null}

      <h2 className="subtitle">{t("consents.recipients")}</h2>
      {recipients.length === 0 ? (
        <p className="muted small">{t("consents.noRecipients")}</p>
      ) : (
        Array.from(groups.entries()).map(([roomLabel, rows]) => {
          const roomAnswered = rows.filter((r) => r.status !== "pending").length;
          const roomPending = rows.filter((r) => r.status === "pending").length;
          return (
            <div className="card mb-4" key={roomLabel}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 className="subtitle" style={{ margin: 0 }}>{roomLabel}</h3>
                <span className="muted small">
                  {t("consents.roomSummary", { room: roomLabel, answered: roomAnswered, pending: roomPending })}
                </span>
              </div>
              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr className="muted small" style={{ textAlign: "left" }}>
                      <th style={{ padding: "6px 8px" }}>{t("consents.childColumn")}</th>
                      <th style={{ padding: "6px 8px" }}>{t("consents.parentColumn")}</th>
                      <th style={{ padding: "6px 8px" }}>{t("consents.responseColumn")}</th>
                      <th style={{ padding: "6px 8px" }}>{t("consents.respondedByColumn")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const badge = statusBadge(String(row.status ?? "pending"));
                      const childName = row.first_name
                        ? `${row.first_name} ${row.last_name ?? ""}`.trim()
                        : t("consents.generalAudience");
                      return (
                        <tr key={String(row.id)} style={{ borderTop: "1px solid var(--color-border)" }}>
                          <td style={{ padding: "8px", fontWeight: 600 }}>{childName}</td>
                          <td style={{ padding: "8px" }} dir="auto">{row.parent_names ?? t("consents.awaitingResponse")}</td>
                          <td style={{ padding: "8px" }}>
                            <span className={badge.css}>{badge.label}</span>
                            {row.responded_at ? (
                              <div className="muted small">{fmtDateTimeFor(locale, row.responded_at)}</div>
                            ) : null}
                          </td>
                          <td style={{ padding: "8px" }} dir="auto">
                            {row.responded_by_name ?? t("consents.awaitingResponse")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
