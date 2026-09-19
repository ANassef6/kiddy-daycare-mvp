import { requireSession } from "@/lib/require";
import { listForms, formResponses } from "@/lib/store";
import { firstInstituteId, safeJson } from "@/lib/helpers";
import { createFormAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PortalSurveysPage({ searchParams }: { searchParams: { view?: string } }) {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const surveys = await listForms(instituteId, "survey");
  const viewId = searchParams.view;
  const active = surveys.find((f: any) => f.id === viewId);
  const responses = active ? await formResponses(active.id) : [];

  return (
    <div>
      <h1 className="title">Surveys</h1>
      <p className="subtitle">
        Create surveys and read their responses right here — no need to visit the Smart form tab.
      </p>

      {/* KID-52 #10: create + access surveys directly from the Surveys tab. */}
      <div className="card mb-4">
        <h3 className="subtitle">Create a survey</h3>
        <form action={createFormAction}>
          <input type="hidden" name="kind" value="survey" />
          <input type="hidden" name="returnTo" value="/portal/surveys" />
          <div className="row">
            <div className="col field"><label className="label">Title</label><input className="input" name="title" required placeholder="e.g. Parent satisfaction — September" /></div>
          </div>
          <div className="field"><label className="label">Description</label><input className="input" name="description" placeholder="What is this survey about?" /></div>
          <h4 className="subtitle">Questions (up to 5 here — edit the full set under Smart form if needed)</h4>
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
          <button className="btn btn-primary" type="submit">Create survey</button>
        </form>
      </div>

      <h3 className="subtitle">Created surveys &amp; their responses</h3>
      {surveys.length === 0 && (
        <div className="card">
          <p className="muted small">No surveys yet. Create your first one above.</p>
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
          <div className="mt-3 row" style={{ gap: 6 }}>
            <a className="btn btn-ghost small" href={`/portal/surveys?view=${f.id}`}>View responses</a>
            {f.share_token && (
              <span className="small muted">Parent link: <a href={`/forms/f/${f.share_token}`}>{`/forms/f/${f.share_token}`}</a></span>
            )}
          </div>
        </div>
      ))}

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
