import { requireSession } from "@/lib/require";
import { familiesForAccount, observationsForChild } from "@/lib/store";
import { cap, fmtDate } from "@/lib/helpers";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ParentLearningPage() {
  const session = requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const families = await familiesForAccount(session.accountId);
  const children = await Promise.all(
    families.map(async (c: any) => ({ child: c, observations: await observationsForChild(c.id) }))
  );

  return (
    <div>
      <h1 className="title">{t("learning.parentTitle")}</h1>
      <div className="subtitle">{t("learning.parentSubtitle")}</div>
      {children.length === 0 && <p className="muted">{t("learning.noChildrenLinked")}</p>}
      {children.map(({ child, observations }: any) => (
        <div className="card mb-4" key={child.id}>
          <h3 className="subtitle">{child.first_name} {child.last_name}</h3>
          {observations.length === 0 && <p className="muted small">{t("learning.nothingRecorded")}</p>}
          {observations.map((o: any) => (
            <div className="list-item" key={o.id}>
              <div>
                <div className="small">
                  <span className="badge">{cap(o.kind)}</span>{" "}
                  {o.title && <strong>{o.title}</strong>} <span className="muted">{fmtDate(o.recorded_at ?? o.created_at)}</span>
                </div>
                {(o.learning_point_name || o.age_group || o.milestone_name) && (
                  <div className="mt-1" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {o.learning_point_name && <span className="badge badge-gray">{o.area_name} · {o.learning_point_name}</span>}
                    {o.age_group && <span className="badge badge-gray">{o.age_group}</span>}
                    {o.milestone_name && <span className="badge badge-green">{o.milestone_name}</span>}
                  </div>
                )}
                {o.body && <p className="small mt-1">{o.body}</p>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}