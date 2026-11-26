import Link from "next/link";
import { storageSrcFor } from "@/lib/storage";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import { getChild, observationsForChild, isChildInScope } from "@/lib/store";
import { cap, firstInstituteId } from "@/lib/helpers";
import { ageGroupForDob } from "@/lib/curriculum";
import Avatar from "@/components/Avatar";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr, fmtDateFor, type Dict } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function kindLabel(dict: Dict, kind: unknown): string {
  const k = String(kind ?? "");
  if (k === "observation") return tr(dict, "learning.observation");
  if (k === "milestone") return tr(dict, "learning.milestone");
  if (k === "goal") return tr(dict, "learning.goal");
  if (k === "assessment") return tr(dict, "learning.assessment");
  return cap(k);
}

export default async function ChildDevelopmentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { dict, locale, timeZone } = await i18nForAccount(session.accountId);
  const child = await getChild((await params).id);
  if (!child) notFound();
  // KID-103: direct URLs to out-of-scope children are hidden.
  const iid = await firstInstituteId();
  if (iid && !(await isChildInScope(iid, session.accountId, String(child.id)))) {
    notFound();
  }
  // KID-1328 defense-in-depth: the rendered record itself must belong to the
  // request tenant — never render another institute's development data.
  if (iid && String(child.institute_id ?? "") !== iid) {
    notFound();
  }
  try {
    const { ensureCurriculumSeeded } = await import("@/lib/curriculum");
    await ensureCurriculumSeeded();
  } catch {}
  const observations = await observationsForChild(child.id);
  const cohort = ageGroupForDob(child.dob as string);

  return (
    <div>
      <Link className="small muted" href={`/portal/children/${child.id}`}>← {child.first_name} {child.last_name}</Link>
      <div className="row mt-2" style={{ alignItems: "center", gap: 12 }}>
        <Avatar src={await storageSrcFor(child.photo_url)} name={`${child.first_name} ${child.last_name}`} size={52} />
        <div>
          <h1 className="title" style={{ margin: 0 }}>{tr(dict, "childDevelopment.title", { name: `${child.first_name} ${child.last_name}` })}</h1>
          <div className="subtitle">
            {tr(dict, "childDevelopment.subtitle", { cohort: cohort ?? "" })}
          </div>
        </div>
      </div>

      <div className="mb-4">
        <Link className="btn btn-ghost small" href="/portal/learning">{tr(dict, "childDevelopment.logObservation")}</Link>
      </div>

      {observations.length === 0 && <p className="muted">{tr(dict, "childDevelopment.empty")}</p>}
      {observations.map((o: any) => (
        <div className="card mb-2" key={o.id}>
          <div className="small">
            <span className="badge">{kindLabel(dict, o.kind)}</span>{" "}
            {o.title && <strong>{o.title}</strong>} <span className="muted">{fmtDateFor(locale, o.recorded_at ?? o.created_at, timeZone)}</span>
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