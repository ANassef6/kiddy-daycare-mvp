import { requireSession } from "@/lib/require";
import { familiesForAccount, observationsForChild } from "@/lib/store";
import { cap, fmtDate } from "@/lib/helpers";

export const dynamic = "force-dynamic";

export default async function ParentLearningPage() {
  const session = requireSession();
  const families = await familiesForAccount(session.accountId);
  const children = await Promise.all(
    families.map(async (c: any) => ({ child: c, observations: await observationsForChild(c.id) }))
  );

  return (
    <div>
      <h1 className="title">Learning &amp; observations</h1>
      <div className="subtitle">Milestones, goals, and observed learning moments, straight from the classroom.</div>
      {children.length === 0 && <p className="muted">No children linked yet.</p>}
      {children.map(({ child, observations }: any) => (
        <div className="card mb-4" key={child.id}>
          <h3 className="subtitle">{child.first_name} {child.last_name}</h3>
          {observations.length === 0 && <p className="muted small">Nothing recorded yet.</p>}
          {observations.map((o: any) => (
            <div className="list-item" key={o.id}>
              <div>
                <div className="small">
                  <span className="badge">{cap(o.kind)}</span>{" "}
                  {o.title && <strong>{o.title}</strong>} <span className="muted">{fmtDate(o.recorded_at ?? o.created_at)}</span>
                </div>
                {o.body && <p className="small mt-1">{o.body}</p>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}