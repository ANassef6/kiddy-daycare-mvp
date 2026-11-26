import { requireSession } from "@/lib/require";
import { listHomework } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { assignHomeworkAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateFor, tr } from "@/lib/i18n";
import { recordToolUsage } from "@/lib/tool-usage";
import RecipientsPicker from "@/components/RecipientsPicker";
import { recipientPickerData } from "@/lib/recipients";

export const dynamic = "force-dynamic";

// KID-221: the Homework page (Learning group) was entirely English inside the
// translated shell — heading, assign form, placeholders and the per-item
// "for {child} · due {date}" lines. Localized with localized dates.
export default async function PortalHomeworkPage(props?: { searchParams?: Promise<{ error?: string }> }) {
  const session = await requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const params = (await props?.searchParams) ?? {};
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{t("homework.noInstitute")}</p>;
  await recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "learning", source: "portal", metadata: { view: "homework" } });
  // KID-103: homework list and recipients are scoped to assigned classrooms.
  // KID-2482: the composer uses the same classroom-aware picker as the
  // newsfeed and activities surfaces, so a teacher assigns to a room without
  // picking children one by one.
  const [items, picker] = await Promise.all([
    listHomework(instituteId, session.accountId),
    recipientPickerData(instituteId, session.accountId, session.role),
  ]);

  return (
    <div>
      <h1 className="title">{t("homework.title")}</h1>
      <p className="subtitle">{t("homework.subtitle")}</p>

      {params.error === "scope" && (
        <div role="alert" className="card mb-4" style={{ borderInlineStart: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{t("homework.errorScope")}</p>
        </div>
      )}

      <div className="card mb-4">
        <h3 className="subtitle">{t("homework.assignTitle")}</h3>
        <form action={assignHomeworkAction}>
          <div className="row">
            <div className="col field">
              <label className="label">{t("activities.recipients")}</label>
              <RecipientsPicker
                dict={dict}
                childOptions={picker.children}
                rooms={picker.rooms}
                role={session.role}
                assignedRoomIds={picker.assignedRoomIds}
              />
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
