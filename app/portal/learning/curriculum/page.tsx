import { requireSession } from "@/lib/require";
import { curriculumTree, ensureCurriculumSeeded } from "@/lib/curriculum";

export const dynamic = "force-dynamic";

export default async function PortalCurriculumPage() {
  requireSession();
  await ensureCurriculumSeeded();
  const areas = await curriculumTree();

  return (
    <div>
      <h1 className="title">Curriculum</h1>
      <div className="subtitle">
        Learning areas, points, and milestones that drive observations. Starter EYFS-style
        content — the founder&apos;s real curriculum imports in the same format without code changes.
      </div>

      {areas.length === 0 && <p className="muted">No curriculum areas seeded yet.</p>}

      {areas.map((area: any) => (
        <div className="card mb-4" key={area.id}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="subtitle" style={{ marginBottom: 0 }}>{area.name}</h3>
            <span className="badge badge-gray">{area.learning_points?.length ?? 0} learning points</span>
          </div>
          {area.learning_points?.map((lp: any) => (
            <div key={lp.id} className="mt-3">
              <div className="small" style={{ fontWeight: 600 }}>
                {lp.name} <span className="badge badge-gray">{lp.age_group}</span>
              </div>
              <ul className="muted small mt-1" style={{ listStyle: "none", paddingLeft: 0 }}>
                {(lp.milestones ?? []).map((m: any) => (
                  <li key={m.id}>
                    <span className="badge badge-green">{m.age_group}</span> {m.name}
                    {m.description ? <span className="muted"> — {m.description}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}