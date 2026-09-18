import { requireSession } from "@/lib/require";
import { listHomework, listChildren } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { assignHomeworkAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PortalHomeworkPage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const [items, children] = await Promise.all([
    listHomework(instituteId),
    listChildren(instituteId),
  ]);

  return (
    <div>
      <h1 className="title">Homework</h1>
      <p className="subtitle">Assign take-home tasks to a child. Families see them in the parent app newsfeed thread.</p>

      <div className="card mb-4">
        <h3 className="subtitle">Assign homework</h3>
        <form action={assignHomeworkAction}>
          <div className="row">
            <div className="col field">
              <label className="label">Child</label>
              <select className="select" name="childId">
                <option value="">All children</option>
                {children.map((c: any) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </div>
            <div className="col field"><label className="label">Due date</label><input className="input" type="date" name="dueDate" /></div>
          </div>
          <div className="field"><label className="label">Title</label><input className="input" name="title" required placeholder="e.g. Read 10 pages" /></div>
          <div className="field"><label className="label">Instructions</label><textarea className="textarea" name="description" placeholder="Reading, practice papers, show-and-tell…" /></div>
          <button className="btn btn-primary" type="submit">Assign</button>
        </form>
      </div>

      {(items as any[]).length === 0 && (
        <div className="card"><p className="muted small">No homework assigned yet.</p></div>
      )}
      {(items as any[]).map((h: any) => (
        <div className="card mb-2" key={h.id}>
          <div style={{ fontWeight: 700 }}>{h.title}</div>
          <div className="small muted">
            {h.first_name ? `for ${h.first_name} ${h.last_name}` : "for all children"}
            {h.due_date ? ` · due ${String(h.due_date).slice(0, 10)}` : ""}
          </div>
          {h.description && <p className="small mt-1">{h.description}</p>}
        </div>
      ))}
    </div>
  );
}
