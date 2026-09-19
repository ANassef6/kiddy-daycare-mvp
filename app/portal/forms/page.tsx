import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listForms, formResponses, formResponseStatusCounts, FORM_RESPONSE_STATUSES } from "@/lib/store";
import { firstInstituteId, cap } from "@/lib/helpers";
import { createFormAction, generateFormShareLinkAction, setFormResponseStatusAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

function stripHtml(v: unknown): string {
  return String(v ?? "").replace(/<[^>]*>/g, "");
}

export default async function PortalFormsPage({
  searchParams,
}: {
  searchParams: { view?: string; q?: string; status?: string; type?: string };
}) {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const forms = await listForms(instituteId);
  const viewId = searchParams.view;
  const active = forms.find((f: any) => f.id === viewId);

  // Funnel view: submissions with per-row statuses (New → Viewed → Contacted → Completed → Archived)
  const responses = active ? await formResponses(active.id) : [];
  const counts = active ? await formResponseStatusCounts(active.id) : {};
  const entered = responses.reduce((n, r) => n + (String(r.status) !== "archived" ? 1 : 0), 0);

  if (viewId && active) {
    const funnel = [
      ["new", "New submissions", counts.new ?? 0],
      ["viewed", "Viewed", counts.viewed ?? 0],
      ["contacted", "Contacted", counts.contacted ?? 0],
      ["completed", "Completed", counts.completed ?? 0],
      ["archived", "Archived", counts.archived ?? 0],
    ] as const;
    return (
      <div>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 className="title" style={{ marginBottom: 0 }}>Form funnel — {active.title}</h1>
            <Link className="small muted" href="/portal/forms">← All forms</Link>
          </div>
          <Link className="btn btn-ghost small" href={`/forms/f/${active.share_token}`} target="_blank">Open parent link</Link>
        </div>

        <div className="card mb-4">
          <h3 className="subtitle">Submission funnel</h3>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            {funnel.map(([key, label, n], idx) => (
              <div key={key} className="row" style={{ alignItems: "center", gap: 6 }}>
                <div className="card" style={{ minWidth: 130, textAlign: "center", padding: "12px 16px" }}>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>{n}</div>
                  <div className="muted small">{label}</div>
                </div>
                {idx < funnel.length - 1 && <span className="muted">→</span>}
              </div>
            ))}
          </div>
          <p className="small muted mt-2">{entered} open · {responses.length} total submissions</p>
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="subtitle">Submissions</h3>
            <span className="muted small">{responses.length} total</span>
          </div>
          {responses.length === 0 && <p className="muted small">No submissions yet.</p>}
          {responses.map((r: any) => {
            const answers = JSON.parse(String(r.answers_json ?? "{}")) as Record<string, string>;
            const snippet = Object.entries(answers).slice(0, 3).map(([k, v]) => `${stripHtml(k)}: ${String(v).slice(0, 60)}`).join(" · ");
            return (
              <div className="list-item" key={r.id}>
                <div className="small" style={{ flex: 1 }}>
                  <strong>{r.respondent_name ?? "Anonymous"}</strong>
                  {r.first_name ? ` · for ${r.first_name} ${r.last_name}` : ""}
                  <span className="muted"> · {new Date(r.created_at).toLocaleString()}</span>
                  <div className="muted mt-1">{snippet}</div>
                </div>
                <form action={setFormResponseStatusAction} className="row" style={{ gap: 6, alignItems: "center" }}>
                  <input type="hidden" name="responseId" value={String(r.id)} />
                  <input type="hidden" name="formId" value={String(active.id)} />
                  <select className="select small" name="status" defaultValue={String(r.status ?? "new")} style={{ maxWidth: 140 }}>
                    {FORM_RESPONSE_STATUSES.map((s) => (
                      <option key={s} value={s}>{cap(s)}</option>
                    ))}
                  </select>
                  <button className="btn btn-ghost small" type="submit">Set</button>
                </form>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const q = (searchParams.q ?? "").toLowerCase();
  const statusFilter = searchParams.status ?? "";
  const typeFilter = searchParams.type ?? "";
  const rows = forms.filter((f: any) => {
    if (typeFilter && f.kind !== typeFilter) return false;
    const publish = f.share_token ? "live" : "draft";
    if (statusFilter && publish !== statusFilter) return false;
    if (q && !`${f.title} ${f.kind}`.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="title" style={{ marginBottom: 0 }}>Forms, lists &amp; surveys</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>Publish parent forms, surveys, and sign-up lists — then track the submission funnel.</p>
        </div>
        <details style={{ position: "relative" }}>
          <summary className="btn btn-primary" style={{ cursor: "pointer", listStyle: "none" }}>Build new form</summary>
          <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", width: 560, maxWidth: "92vw", zIndex: 50 }}>
            <CreateFormCard />
          </div>
        </details>
      </div>

      <div className="card mb-4">
        <form method="get" className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="input" name="q" defaultValue={searchParams.q ?? ""} placeholder="Search by title…" style={{ minWidth: 240 }} />
          <select className="select" name="type" defaultValue={typeFilter} style={{ maxWidth: 160 }}>
            <option value="">All types</option>
            <option value="form">Form</option>
            <option value="survey">Survey</option>
            <option value="list">List</option>
          </select>
          <select className="select" name="status" defaultValue={statusFilter} style={{ maxWidth: 150 }}>
            <option value="">Any publish state</option>
            <option value="live">Live</option>
            <option value="draft">Draft</option>
          </select>
          <button className="btn btn-ghost small" type="submit">Apply</button>
          <Link className="btn btn-ghost small" href="/portal/forms">Clear</Link>
        </form>
      </div>

      <div className="card">
        <table className="data">
          <thead>
            <tr><th>Title</th><th>Payment</th><th>Form type</th><th>Submissions</th><th>Created by</th><th>Publish</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="muted small">No forms match.</td></tr>}
            {rows.map((f: any) => {
              const published = !!f.share_token;
              return (
                <tr key={f.id}>
                  <td><strong>{f.title}</strong>{f.description ? <div className="muted small">{f.description}</div> : null}</td>
                  <td className="small muted">—</td>
                  <td className="small">{cap(f.kind)}</td>
                  <td className="small"><Link href={`/portal/forms?view=${f.id}`} className="badge" style={{ textDecoration: "none" }}>{f.response_count}</Link></td>
                  <td className="small">{f.created_by_name ?? "—"}</td>
                  <td className="small">
                    <span className={published ? "badge badge-green" : "badge badge-gray"}>{published ? "Live" : "Draft"}</span>
                  </td>
                  <td className="small">
                    {f.share_token ? <a className="small muted" href={`/forms/f/${f.share_token}`} target="_blank">/forms/f/{String(f.share_token).slice(0, 10)}…</a> : "Not published"}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Link className="btn btn-ghost small" href={`/portal/forms?view=${f.id}`}>View submissions</Link>
                      <form action={generateFormShareLinkAction}>
                        <input type="hidden" name="formId" value={String(f.id)} />
                        <button className="btn btn-ghost small" type="submit">{published ? "Regenerate link" : "Publish"}</button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateFormCard() {
  return (
    <div className="card">
      <form action={createFormAction}>
        <div className="row">
          <div className="col field"><label className="label">Title</label><input className="input" name="title" required /></div>
          <div className="col field">
            <label className="label">Kind</label>
            <select className="select" name="kind">
              <option value="form">Form</option>
              <option value="survey">Survey</option>
              <option value="list">List / sign-up</option>
            </select>
          </div>
        </div>
        <div className="field"><label className="label">Description</label><input className="input" name="description" /></div>
        <h4 className="subtitle">Questions (up to 5 in this panel)</h4>
        {Array.from({ length: 3 }).map((_, i) => (
          <div className="row" key={i}>
            <div className="col field"><label className="label">Question #{i + 1}</label><input className="input" name={`field_${i}_label`} placeholder="Leave blank to skip" /></div>
            <div className="field">
              <label className="label">Type</label>
              <select className="select" name={`field_${i}_type`} style={{ minWidth: 110 }}>
                <option value="text">Text</option>
                <option value="textarea">Long text</option>
                <option value="select">Choice</option>
                <option value="checkbox">Yes/No</option>
              </select>
            </div>
            <div className="field">
              <label className="label">Options (comma-separated)</label>
              <input className="input" name={`field_${i}_options`} placeholder="Red, Blue, Green" />
            </div>
            <div className="field" style={{ marginTop: 24 }}><label className="label small"><input type="checkbox" name={`field_${i}_required`} /> Required</label></div>
          </div>
        ))}
        <button className="btn btn-primary" type="submit">Create form</button>
      </form>
    </div>
  );
}