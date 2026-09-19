import { requireSession } from "@/lib/require";
import { listObservations, listChildren } from "@/lib/store";
import { curriculumTree, ensureCurriculumSeeded } from "@/lib/curriculum";
import { firstInstituteId, cap } from "@/lib/helpers";
import { queryGet } from "@/lib/db";
import ObservationModalTrigger from "@/components/ObservationModalTrigger";

export const dynamic = "force-dynamic";

export default async function PortalLearningPage() {
  const session = requireSession();
  // KID-47 fix: seeding must never 500 the page on the live DB — a seeding
  // hiccup falls back to whatever curriculum already exists (dev pages already
  // use this pattern).
  try {
    await ensureCurriculumSeeded();
  } catch {}
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const [observations, children] = await Promise.all([
    listObservations(instituteId),
    listChildren(instituteId),
  ]);
  let areas: any[] = [];
  try {
    areas = await curriculumTree();
  } catch {
    areas = [];
  }

  const me = await queryGet("SELECT full_name, email FROM account WHERE id = ?", session.accountId);
  const byName = String(me?.full_name ?? me?.email ?? session.accountId);

  return (
    <div>
      <h1 className="title">Learning &amp; development</h1>
      <div className="subtitle">Log a learning observation, milestone, or goal for a child — attach curriculum goals from the Egyptian kindergarten curriculum. Parents see these on their side.</div>
      <div className="mb-4 row" style={{ gap: 8, alignItems: "center" }}>
        {/* KID-53 #4: observation modal with curriculum-goals picker */}
        <ObservationModalTrigger children={children as any} areas={areas} byName={byName} />
        <a className="small" href="/portal/learning/curriculum">View curriculum →</a>
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
              {(o.learning_point_name || o.age_group || o.milestone_name) && (
                <div className="mt-1" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {o.learning_point_name && <span className="badge badge-gray">{o.area_name} · {o.learning_point_name}</span>}
                  {o.age_group && <span className="badge badge-gray">{o.age_group}</span>}
                  {o.milestone_name && <span className="badge badge-green">{o.milestone_name}</span>}
                </div>
              )}
              <div className="muted mt-1">{o.body}</div>
            </div>
            <span className="muted small">{o.recorded_by ?? "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}