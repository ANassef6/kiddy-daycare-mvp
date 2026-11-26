import { requireSession } from "@/lib/require";
import { resolveTenantInstituteId } from "@/lib/tenant";
import {listIncidents } from "@/lib/store";
import { recordToolUsage } from "@/lib/tool-usage";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateTimeFor, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalIncidentsPage() {
  const session = await requireSession();
  const { dict, locale, timeZone } = await i18nForAccount(session.accountId);
  const iid = await resolveTenantInstituteId();
  await recordToolUsage({ instituteId: String(iid ?? "") || null, accountId: session.accountId, toolKey: "incidents", source: "portal", metadata: null });
  const incidents = iid ? await listIncidents(iid) : [];

  return (
    <div>
      <h1 className="title">{tr(dict, "child.incidentReports")}</h1>
      {incidents.map((i: any) => (
        <div className="card mb-4" key={i.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="small muted">
              {tr(dict, i.type === "accident" ? "profile.accident" : "profile.incident")} · {i.first_name} {i.last_name} · {fmtDateTimeFor(locale, i.created_at, timeZone)} ·{" "}
              {tr(dict, "incidents.reportedBy", { name: i.reported_by })}
            </div>
            <span className={i.acknowledged ? "badge badge-green" : "badge badge-red"}>
              {i.acknowledged ? tr(dict, "incidents.parentAcknowledged") : tr(dict, "incidents.pendingAcknowledgement")}
            </span>
          </div>
          <p className="mt-2">{i.description}</p>
        </div>
      ))}
      {incidents.length === 0 && <p className="muted">{tr(dict, "incidents.empty")}</p>}
    </div>
  );
}
