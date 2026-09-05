import { requireSession } from "@/lib/require";
import { listObservations, listChildren } from "@/lib/store";
import { firstInstituteId, cap } from "@/lib/helpers";
import { createObservationAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PortalLearningPage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const [observations, children] = await Promise.all([listObservations(instituteId), listChildren(instituteId)]);

  return (
    <div>
      <h1 className="title">Learning &amp; observations</h1>
      <div className="subtitle">Log a learning observation, milestone, or goal for a child. Parents see these on their side.</div>

      <div className="card mb-4">
        <h3 className="subtitle">Record an observation</h3>
        <form action={createObservationAction}>
          <div className="row">
            <div className="col field">
              <label className="label">Child</label>
              <select className="select" name="childId" required>
                {children.map((c: any) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </div>
            <div className="col field">
              <label className="label">Kind</label>
              <select className="select" name="kind">
                <option value="observation">Observation</option>
                <option value="milestone">Milestone</option>
                <option value="goal">Goal</option>
              </select>
            </div>
            <div className="col field"><label className="label">Date</label><input className="input" type="date" name="recordedAt" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
          </div>
          <div className="field"><label className="label">Title (optional)</label><input className="input" name="title" placeholder="e.g. First steps, Counting to ten" /></div>
          <div className="field"><label className="label">Note</label><textarea className="textarea" name="body" required /></div>
          <button className="btn btn-primary" type="submit">Record</button>
        </form>
      </div>

      <div className="card">
        <h3 className="subtitle">All observations</h3>
        {observations.length === 0 && <p className="muted small">Nothing recorded yet.</p>}
        {observations.map((o: any) => (
          <div className="list-item" key={o.id}>
            <div className="small">
              <span className="badge">{cap(o.kind)}</span>{" "}
              <strong>{o.first_name} {o.last_name}</strong> · {cap(o.recorded_at ?? o.created_at)}
              {o.title ? ` — ${o.title}` : ""}
              <div className="muted mt-1">{o.body}</div>
            </div>
            <span className="muted small">{o.recorded_by ?? "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}