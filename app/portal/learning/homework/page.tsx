import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listForms } from "@/lib/store";
import { firstInstituteId, cap } from "@/lib/helpers";

export const dynamic = "force-dynamic";

export default async function PortalHomeworkPage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const forms = await listForms(instituteId);
  const reminders = forms.filter((f: any) => f.kind === "list" || f.kind === "survey");

  return (
    <div>
      <h1 className="title">Homework</h1>
      <p className="subtitle">
        Plan and share simple take-home tasks — reading, practice papers, show-and-tell — with families.
        Create homework via the
        <Link href="/portal/forms" className="small" style={{ fontWeight: 600, marginLeft: 4 }}>Smart form</Link> page,
        or use an existing form below as a reminder.
      </p>

      {reminders.length === 0 && (
        <div className="card">
          <p className="muted small">No forms or sign-up lists yet. Create one from the Smart form page to use as a homework reminder.</p>
        </div>
      )}

      {reminders.map((f: any) => (
        <div className="card mb-4" key={f.id}>
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{f.title}</div>
            <span className="badge">{cap(f.kind)}</span>
          </div>
          {f.description && <p className="small muted mt-1">{f.description}</p>}
          <div className="small muted mt-2">{f.response_count ?? 0} response(s)</div>
        </div>
      ))}
    </div>
  );
}