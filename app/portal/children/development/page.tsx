import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listObservations, listChildren } from "@/lib/store";
import { firstInstituteId, cap } from "@/lib/helpers";

export const dynamic = "force-dynamic";

export default async function PortalChildrenDevelopmentPage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const [observations, children] = await Promise.all([
    listObservations(instituteId),
    listChildren(instituteId),
  ]);

  const byChild: Record<string, any[]> = {};
  for (const o of observations as any[]) {
    const key = String(o.child_id);
    (byChild[key] ??= []).push(o);
  }

  return (
    <div>
      <h1 className="title">Development</h1>
      <p className="subtitle">
        Each child&apos;s learning observations, milestones, and goals, grouped by child. Record new ones from the
        <Link href="/portal/learning" className="small" style={{ fontWeight: 600, marginLeft: 4 }}>Learning</Link> page.
      </p>

      {children.length === 0 && <div className="card"><p className="muted small">No children yet.</p></div>}

      {children.map((c: any) => {
        const obs = byChild[String(c.id)] ?? [];
        return (
          <div className="card mb-4" key={c.id}>
            <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <h3 className="subtitle" style={{ marginBottom: 0 }}>
                {c.first_name} {c.last_name}
              </h3>
              <Link href={`/portal/children/${c.id}`} className="small" style={{ fontWeight: 600 }}>
                Profile →
              </Link>
            </div>
            {obs.length === 0 && <p className="muted small">No observations recorded yet.</p>}
            {obs.map((o: any) => (
              <div className="list-item" key={o.id}>
                <div className="small">
                  <span className="badge">{cap(o.kind)}</span> {cap(o.recorded_at ?? o.created_at)}
                  {o.title ? ` — ${o.title}` : ""}
                  {(o.learning_point_name || o.milestone_name) && (
                    <div className="mt-1" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {o.learning_point_name && <span className="badge badge-gray">{o.area_name} · {o.learning_point_name}</span>}
                      {o.age_group && <span className="badge badge-gray">{o.age_group}</span>}
                      {o.milestone_name && <span className="badge badge-green">{o.milestone_name}</span>}
                    </div>
                  )}
                  <div className="muted mt-1">{o.body}</div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}