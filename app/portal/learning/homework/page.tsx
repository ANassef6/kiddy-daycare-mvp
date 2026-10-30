import { requireSession } from "@/lib/require";
import { listHomework, listChildren } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { assignHomeworkAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateFor, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-221: the Homework page (Learning group) was entirely English inside the
// translated shell — heading, assign form, placeholders and the per-item
// "for {child} · due {date}" lines. Localized with localized dates.
export default async function PortalHomeworkPage() {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{t("homework.noInstitute")}</p>;
  // KID-103: homework list and child picker are scoped to assigned classrooms.
  const [items, children] = await Promise.all([
    listHomework(instituteId, session.accountId),
    listChildren(instituteId, { accountId: session.accountId }),
  ]);
  const canAssignCenterWide = session.role === "owner" || session.role === "admin";

  return (
    <div>
      <h1 className="title">{t("homework.title")}</h1>
      <p className="subtitle">{t("homework.subtitle")}</p>

      <div className="card mb-4">
        <h3 className="subtitle">{t("homework.assignTitle")}</h3>
        <form action={assignHomeworkAction}>
          <div className="row">
            <div className="col field">
              <label className="label">{t("homework.child")}</label>
              <select className="select" name="childId">
                {canAssignCenterWide && <option value="">{t("homework.allChildren")}</option>}
                {children.map((c: any) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </div>
            <div className="col field"><label className="label">{t("homework.dueDate")}</label><input className="input" type="date" name="dueDate" /></div>
          </div>
          <div className="col field"><label className="label">{t("homework.titleLabel")}</label><input className="input" name="title" required placeholder={t("homework.titlePlaceholder")} /></div>
          <div className="field"><label className="label">{t("homework.instructions")}</label><textarea className="textarea" name="description" placeholder={t("homework.instructionsPlaceholder")} /></div>
          <button className="btn btn-primary" type="submit">{t("homework.assign")}</button>
        </form>
      </div>

      {(items as any[]).length === 0 && (
        <div className="card"><p className="muted small">{t("homework.noHomework")}</p></div>
      )}
      {(items as any[]).map((h: any) => (
        <div className="card mb-2" key={h.id}>
          <div style={{ fontWeight: 700 }}>{h.title}</div>
          <div className="small muted">
            {h.first_name ? t("homework.forChild", { name: `${h.first_name} ${h.last_name}` }) : t("homework.forAll")}
            {h.due_date ? ` · ${t("homework.dueOn", { date: fmtDateFor(locale, h.due_date) })}` : ""}
          </div>
          {h.description && <p className="small mt-1">{h.description}</p>}
        </div>
      ))}
    </div>
  );
}
