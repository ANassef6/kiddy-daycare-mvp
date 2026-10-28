// KID-258 A1 (KID-264): the daycare owner's "Enhancements requests" page
// under Tools (/portal/enhancements).
//
// Owner-only on BOTH surfaces: the sidebar tab rides the exact owner gate
// (components/PortalSidebar.tsx, same `role === "owner"` test as Account
// billing — KID-246, NOT isAdminRole), and this page re-checks the session so
// a direct URL visit by any other role is refused — the tab and the route can
// never drift apart.
//
// Submit = title + description ONLY (locked answer on KID-258: the Kiddy team
// sets priority/estimate/due date in Linear). The app NEVER calls Linear here
// (no app-side Linear token): the record starts 'queued' and the KID-258
// Linear sync agent (child task A2) picks it up, creating the Linear issue
// and writing priority/estimate/due_date/expected_delivery back through the
// authenticated write-back route (app/api/enhancements/write-back).
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { isOwnerRole } from "@/lib/role";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { getInstitute } from "@/lib/store";
import { listEnhancementRequests, type EnhancementRequest, type EnhancementStatus } from "@/lib/enhancements";
import { createEnhancementRequestAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<EnhancementStatus, string> = {
  queued: "statusQueued",
  linear_created: "statusLinearCreated",
  synced: "statusSynced",
  sync_error: "statusSyncError",
};

const STATUS_TONE: Record<EnhancementStatus, string> = {
  queued: "badge-amber",
  linear_created: "badge-gray",
  synced: "badge-green",
  sync_error: "badge-red",
};

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "priorityUrgent",
  high: "priorityHigh",
  medium: "priorityMedium",
  low: "priorityLow",
};

export default async function PortalEnhancementsPage({
  searchParams,
}: {
  searchParams: { submitted?: string; error?: string };
}) {
  const session = requireSession();
  if (!isOwnerRole(session.role)) {
    // Admins, staff and carers render the portal; parents have their own
    // shell. Nothing here is theirs to see — a redirect is a quiet refusal.
    redirect("/portal/dashboard");
  }
  const { dict, dir } = await i18nForAccount(session.accountId);
  const instituteId = await resolveTenantInstituteId();
  if (!instituteId) return <div><p>{tr(dict, "enhancements.noRequests")}</p></div>;
  const institute = await getInstitute(instituteId);
  if (!institute) redirect("/portal/dashboard");
  const requests = await listEnhancementRequests(instituteId);

  const submitted = searchParams.submitted === "1";
  const errorKey = searchParams.error === "duplicate" ? "duplicateError" : "";

  return (
    <div dir={dir}>
      <h1 className="title">{tr(dict, "enhancements.title")}</h1>
      <p className="subtitle">{tr(dict, "enhancements.subtitle")}</p>

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "enhancements.formCard")}</h3>
        <form action={createEnhancementRequestAction}>
          <input type="hidden" name="returnTo" value="/portal/enhancements" />
          <div className="field">
            <label className="label" htmlFor="enhancement-title">{tr(dict, "enhancements.fieldTitle")}</label>
            <input
              className="input"
              id="enhancement-title"
              name="title"
              required
              maxLength={80}
              placeholder={tr(dict, "enhancements.fieldTitlePlaceholder")}
            />
          </div>
          <div className="field mt-1">
            <label className="label" htmlFor="enhancement-description">{tr(dict, "enhancements.fieldDescription")}</label>
            <textarea
              className="input"
              id="enhancement-description"
              name="description"
              required
              rows={4}
              placeholder={tr(dict, "enhancements.fieldDescriptionPlaceholder")}
            />
          </div>
          <div className="small muted mt-1">
            {tr(dict, "enhancements.daycareLabel", { name: String(institute.name ?? "") })}
          </div>
          <button className="btn btn-primary mt-2" type="submit">
            {tr(dict, "enhancements.submit")}
          </button>
        </form>
        {submitted && (
          <p className="small mt-2" style={{ color: "#047857", fontWeight: 700 }}>
            {tr(dict, "enhancements.submitted")}
          </p>
        )}
        {errorKey && (
          <p className="small mt-2" style={{ color: "#b91c1c", fontWeight: 700 }}>
            {tr(dict, `enhancements.${errorKey}`)}
          </p>
        )}
      </div>

      <h2 className="h3 mb-2">{tr(dict, "enhancements.listCard")}</h2>
      {requests.length === 0 ? (
        <div className="card">{tr(dict, "enhancements.noRequests")}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="card" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="label" style={{ textAlign: dir === "rtl" ? "right" : "left", padding: 8 }}>
                  {tr(dict, "enhancements.colTitle")}
                </th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "enhancements.colStatus")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "enhancements.colPriority")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "enhancements.colEstimate")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "enhancements.colDue")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "enhancements.colDelivery")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "enhancements.colLinear")}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => requestRow(dict, dir, req))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function requestRow(dict: import("@/lib/i18n").Dict, dir: string, req: EnhancementRequest) {
  return (
    <tr key={req.id} style={{ borderTop: "1px solid #e5e7eb" }}>
      <td className="small" style={{ padding: 8, textAlign: dir === "rtl" ? "right" : "left" }}>
        <strong>{req.title}</strong>
        <div className="small muted">{req.description}</div>
        {req.status === "sync_error" && req.syncErrorDetail && (
          <div className="small muted" style={{ color: "#b91c1c" }}>{req.syncErrorDetail}</div>
        )}
      </td>
      <td style={{ padding: 8 }}>
        <span className={`badge ${STATUS_TONE[req.status]}`}>
          {tr(dict, `enhancements.${STATUS_LABEL[req.status]}`)}
        </span>
      </td>
      <td className="small" style={{ padding: 8 }}>
        {req.priority
          ? tr(dict, `enhancements.${PRIORITY_LABEL[req.priority] ?? req.priority}`)
          : "—"}
      </td>
      <td className="small" style={{ padding: 8 }}>{req.estimate ?? "—"}</td>
      <td className="small" style={{ padding: 8 }}>{req.dueDate || "—"}</td>
      <td className="small" style={{ padding: 8 }}>{req.expectedDelivery || "—"}</td>
      <td className="small" style={{ padding: 8 }}>
        {req.linearIssueUrl ? (
          <a href={req.linearIssueUrl} target="_blank" rel="noreferrer" title={req.linearIssueId}>
            {tr(dict, "enhancements.linearLink")}
          </a>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
