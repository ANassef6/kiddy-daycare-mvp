import { requireSession } from "@/lib/require";
import { listForms, formResponses } from "@/lib/store";
import { firstInstituteId, safeJson, cap } from "@/lib/helpers";
import { createFormAction } from "@/lib/actions";

export const dynamic = "force-dynamic";
type Field = { id: string; label: string; type: string; required?: boolean; options?: string[] };

export default async function PortalFormsPage({ searchParams }: { searchParams: { view?: string } }) {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const forms = await listForms(instituteId);
  const viewId = searchParams.view;
  const active = forms.find((f: any) => f.id === viewId);
  const responses = active ? await formResponses(active.id) : [];

  return (
    <div>
      <h1 className="title">Forms, lists &amp; surveys</h1>

      <div className="card mb-4">
        <h3 className="subtitle">Create a form / survey / list</h3>
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
          <h4 className="subtitle">Questions (up to 20)</h4>
          {Array.from({ length: 5 }).map((_, i) => (
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
          <button className="btn btn-primary" type="submit">Create</button>
        </form>
      </div>

      <h3 className="subtitle">All forms</h3>
      <div className="grid">
        {forms.map((f: any) => (
          <div className="card" key={f.id}>
            <div style={{ fontWeight: 700 }}>{f.title}</div>
            <div className="muted small">{cap(f.kind)} · {f.response_count} responses{f.description ? ` — ${f.description}` : ""}</div>
            <div className="mt-3">
              <a className="btn btn-ghost small" href={`/portal/forms?view=${f.id}`}>View responses</a>
            </div>
          </div>
        ))}
      </div>

      {viewId && active && (
        <div className="card mt-4">
          <h3 className="subtitle">Responses to “{active.title}”</h3>
          {responses.length === 0 && <p className="muted small">No responses yet.</p>}
          {responses.map((r: any) => {
            const answers = safeJson<Record<string, string>>(r.answers_json, {});
            return (
              <div className="list-item" key={r.id}>
                <div className="small">
                  <strong>{r.respondent_name ?? "Anonymous"}</strong>
                  {r.first_name ? ` · for ${r.first_name} ${r.last_name}` : ""}
                  <div className="muted">{Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}