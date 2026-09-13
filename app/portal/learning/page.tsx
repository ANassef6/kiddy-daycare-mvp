import { requireSession } from "@/lib/require";
import { listObservations, listChildren } from "@/lib/store";
import { ageGroupForDob, curriculumTree, ensureCurriculumSeeded } from "@/lib/curriculum";
import { firstInstituteId, cap } from "@/lib/helpers";
import ObservationForm from "@/components/ObservationForm";

export const dynamic = "force-dynamic";

export default async function PortalLearningPage() {
  requireSession();
  await ensureCurriculumSeeded();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const [observations, children, areas] = await Promise.all([
    listObservations(instituteId),
    listChildren(instituteId),
    curriculumTree(),
  ]);

  const learningPoints: any[] = [];
  for (const area of areas) {
    for (const lp of area.learning_points ?? []) {
      learningPoints.push({ ...lp, area_name: area.name });
    }
  }

  const ageByChild: Record<string, string> = {};
  for (const c of children) {
    const band = ageGroupForDob(c.dob);
    if (band) ageByChild[c.id] = band;
  }

  return (
    <div>
      <h1 className="title">Learning &amp; development</h1>
      <div className="subtitle">Log a learning observation, milestone, or goal for a child — pick the learning point, age group, and milestone from the curriculum. Parents see these on their side.</div>
      <div className="mb-4">
        <a className="small" href="/portal/learning/curriculum">View curriculum →</a>
      </div>

      <div className="card mb-4">
        <h3 className="subtitle">Record an observation</h3>
        <ObservationForm children={children as any} learningPoints={learningPoints} ageByChild={ageByChild} />
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