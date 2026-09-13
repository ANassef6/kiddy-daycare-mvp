import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import { getChild, observationsForChild } from "@/lib/store";
import { cap, fmtDate } from "@/lib/helpers";
import { ageGroupForDob } from "@/lib/curriculum";
import Avatar from "@/components/Avatar";

export const dynamic = "force-dynamic";

export default async function ChildDevelopmentPage({ params }: { params: { id: string } }) {
  requireSession();
  const child = await getChild(params.id);
  if (!child) notFound();
  const observations = await observationsForChild(child.id);
  const cohort = ageGroupForDob(child.dob as string);

  return (
    <div>
      <Link className="small muted" href={`/portal/children/${child.id}`}>← {child.first_name} {child.last_name}</Link>
      <div className="row mt-2" style={{ alignItems: "center", gap: 12 }}>
        <Avatar src={child.photo_url} name={`${child.first_name} ${child.last_name}`} size={52} />
        <div>
          <h1 className="title" style={{ margin: 0 }}>Development · {child.first_name} {child.last_name}</h1>
          <div className="subtitle">
            {cohort && `${cohort} cohort`}{cohort ? " · " : ""}Learning milestones against the Egyptian kindergarten curriculum.
          </div>
        </div>
      </div>

      <div className="mb-4">
        <Link className="btn btn-ghost small" href="/portal/learning">Log an observation →</Link>
      </div>

      {observations.length === 0 && <p className="muted">No observations recorded yet.</p>}
      {observations.map((o: any) => (
        <div className="card mb-2" key={o.id}>
          <div className="small">
            <span className="badge">{cap(o.kind)}</span>{" "}
            {o.title && <strong>{o.title}</strong>} <span className="muted">{fmtDate(o.recorded_at ?? o.created_at)}</span>
          </div>
          {(o.learning_point_name || o.age_group || o.milestone_name) && (
            <div className="mt-1" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {o.area_name && o.learning_point_name && <span className="badge badge-gray">{o.area_name} · {o.learning_point_name}</span>}
              {o.age_group && <span className="badge badge-gray">{o.age_group}</span>}
              {o.milestone_name && <span className="badge badge-green">{o.milestone_name}</span>}
            </div>
          )}
          {o.body && <p className="small mt-1">{o.body}</p>}
        </div>
      ))}
    </div>
  );
}