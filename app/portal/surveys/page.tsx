import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listForms, formResponses } from "@/lib/store";
import { firstInstituteId, cap } from "@/lib/helpers";

export const dynamic = "force-dynamic";

export default async function PortalSurveysPage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const surveys = await listForms(instituteId, "survey");

  return (
    <div>
      <h1 className="title">Surveys</h1>
      <p className="subtitle">
        Ask families how they feel. Responses are shared with the
        <Link href="/portal/forms" className="small" style={{ fontWeight: 600, marginLeft: 4 }}>Smart form</Link> page,
        which is where new surveys are created.
      </p>

      {surveys.length === 0 && (
        <div className="card">
          <p className="muted small">No surveys yet. Use the Smart form page to create one.</p>
        </div>
      )}

      {surveys.map((f: any) => (
        <div className="card mb-4" key={f.id}>
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{f.title}</div>
            <span className="badge">{f.response_count ?? 0} response(s)</span>
          </div>
          {f.description && <p className="small muted mt-1">{f.description}</p>}
          {f.created_by_name && <div className="small muted mt-1">Asked by {f.created_by_name}</div>}
        </div>
      ))}
    </div>
  );
}