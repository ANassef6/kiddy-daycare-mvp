// KID-477: the admin audit trail — every user-visible mutation the tenant's
// accounts performed, filterable by date range, actor and record type, and
// always tenant-scoped to the request's institute. Admins and owners only,
// same gate as the rest of the Tools group. The platform operator's
// operator-view session carries an admin-shaped session for its bound
// institute and passes unchanged (requireAdmin action semantics).
import { requireSession } from "@/lib/require";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { isAdminRole } from "@/lib/role";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateTimeFor, tr } from "@/lib/i18n";
import { redirect } from "next/navigation";
import {
  auditActors,
  auditEntityTypes,
  listAuditEvents,
} from "@/lib/audit";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type SearchParams = { [key: string]: string | string[] | undefined };

function param(sp: SearchParams, key: string): string | null {
  const v = sp[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

const VALID_TYPES = new Set([
  "child",
  "daily_report",
  "message",
  "newsfeed_post",
  "newsfeed_comment",
  "attendance",
  "consent_request",
  "incident_report",
  "supply_request",
  "room",
  "staff",
  "event",
  "event_media",
  "form_template",
  "form_response",
  "support_ticket",
  "child_billing",
  "invoice",
  "billing_settings",
  "institute_settings",
]);

function slugFor(entityType: string, entityId: string | null): string {
  if (!entityId) return entityType;
  return `${entityType} · ${entityId}`;
}

export default async function AuditTrailPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams> | SearchParams;
}) {
  const sp = (await searchParams) as SearchParams;
  const session = requireSession();
  if (!isAdminRole(session.role)) redirect("/portal/dashboard");
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const iid = await resolveTenantInstituteId();

  const from = param(sp, "from");
  const to = param(sp, "to");
  const actor = param(sp, "actor");
  const typeRaw = param(sp, "type");
  const entityType = typeRaw && VALID_TYPES.has(typeRaw) ? typeRaw : null;
  const page = Math.max(1, Number(param(sp, "page") ?? "1") || 1);

  if (!iid) {
    return (
      <div>
        <h1 className="title">{t("audit.title")}</h1>
        <p className="small muted">{t("supplies.noInstitute")}</p>
      </div>
    );
  }

  const [{ rows, total }, types, actors] = await Promise.all([
    listAuditEvents({
      instituteId: iid,
      from,
      to,
      actorAccountId: actor,
      entityType,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    auditEntityTypes(iid),
    auditActors(iid),
  ]);

  const pageFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageTo = Math.min(total, page * PAGE_SIZE);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const query = (overrides: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged: Record<string, string | null> = {
      from,
      to,
      actor,
      type: entityType,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) q.set(k, v);
    }
    const s = q.toString();
    return s ? `/portal/audit?${s}` : "/portal/audit";
  };

  return (
    <div>
      <h1 className="title">{t("audit.title")}</h1>
      <p className="small muted">{t("audit.subtitle")}</p>

      <form className="card mb-4" method="get" action="/portal/audit">
        <div className="row mt-3" style={{ gap: 12, flexWrap: "wrap" }}>
          <div className="field">
            <label className="label">{t("audit.from")}</label>
            <input className="input" type="date" name="from" defaultValue={from ?? ""} max={to ?? ""} />
          </div>
          <div className="field">
            <label className="label">{t("audit.to")}</label>
            <input className="input" type="date" name="to" defaultValue={to ?? ""} min={from ?? ""} />
          </div>
          <div className="field">
            <label className="label">{t("audit.actor")}</label>
            <select className="input" name="actor" defaultValue={actor ?? ""}>
              <option value="">{t("audit.allActors")}</option>
              {actors.map((a) => (
                <option key={String(a.actor_account_id)} value={String(a.actor_account_id)}>
                  {String(a.actor_name ?? a.actor_account_id)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">{t("audit.entityType")}</label>
            <select className="input" name="type" defaultValue={entityType ?? ""}>
              <option value="">{t("audit.allTypes")}</option>
              {types.map((ty) => (
                <option key={ty} value={ty}>
                  {ty}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row mt-2" style={{ gap: 8 }}>
          <button className="btn btn-primary" type="submit">
            {t("audit.apply")}
          </button>
          <a className="btn btn-ghost" href="/portal/audit">
            {t("audit.reset")}
          </a>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card">
          <p className="small muted">{t("audit.empty")}</p>
        </div>
      ) : (
        <div className="card">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: locale === "ar" ? "right" : "left", padding: 8 }}>{t("audit.thWhen")}</th>
                <th style={{ textAlign: locale === "ar" ? "right" : "left", padding: 8 }}>{t("audit.thActor")}</th>
                <th style={{ textAlign: locale === "ar" ? "right" : "left", padding: 8 }}>{t("audit.thEntity")}</th>
                <th style={{ textAlign: locale === "ar" ? "right" : "left", padding: 8 }}>{t("audit.thSummary")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)} style={{ borderTop: "1px solid rgba(148,163,184,0.25)" }}>
                  <td style={{ padding: 8, whiteSpace: "nowrap" }}>{fmtDateTimeFor(locale, row.created_at)}</td>
                  <td style={{ padding: 8 }}>{String(row.actor_name ?? row.actor_account_id ?? "—")}</td>
                  <td style={{ padding: 8 }}>
                    <span className="badge badge-gray">{String(row.action)}</span>{" "}
                    {slugFor(String(row.entity_type), row.entity_id ? String(row.entity_id) : null)}
                  </td>
                  <td style={{ padding: 8 }}>{String(row.summary ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="row mt-2" style={{ gap: 12, alignItems: "center" }}>
          <span className="small muted">{t("audit.pageOf", { from: pageFrom, to: pageTo, total })}</span>
          {page > 1 && (
            <a className="btn btn-ghost" href={query({ page: String(page - 1) })}>
              ← {t("audit.prev")}
            </a>
          )}
          {page < lastPage && (
            <a className="btn btn-ghost" href={query({ page: String(page + 1) })}>
              {t("audit.next")} →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
