import { requireSession } from "@/lib/require";
import { listSupplies, listChildren } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { createSupplyAction, updateSupplyStatusAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import Attribution from "@/components/Attribution";
import RecipientsPicker from "@/components/RecipientsPicker";
import { recipientPickerData } from "@/lib/recipients";
import { recordToolUsage } from "@/lib/tool-usage";

export const dynamic = "force-dynamic";

// KID-221: the Supplies page was the full English page inside an Arabic shell
// (heading, request form, notes and status chips). Localized; the status
// select now carries translated options instead of the raw DB enum.
// KID-2479: the request form gained an optional child dropdown so staff can
// tie a request to one child; the card shows that child's name.
export default async function PortalSuppliesPage() {
  const session = await requireSession();
  const { dict, locale, timeZone } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{t("supplies.noInstitute")}</p>;
  await recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "supplies", source: "portal", metadata: null });
  // KID-2482: supplies carries a recipients list (classrooms/children) so the
  // request notification reaches the families the staff member targets.
  // KID-2479: the optional child list is scoped exactly like every other
  // staff child picker (assigned classrooms), so the dropdown never leaks a
  // child outside the staff member's rooms.
  const [items, children, picker] = await Promise.all([
    listSupplies(instituteId, { accountId: session.accountId }),
    listChildren(instituteId, { accountId: session.accountId }),
    recipientPickerData(instituteId, session.accountId, session.role),
  ]);

  return (
    <div>
      <h1 className="title">{t("supplies.title")}</h1>
      <p className="subtitle">{t("supplies.subtitle")}</p>

      <div className="card mb-4">
        <h3 className="subtitle">{t("supplies.requestTitle")}</h3>
        <form action={createSupplyAction}>
          <div className="row">
            <div className="col field">
              <label className="label">{t("supplies.child")}</label>
              <select className="select" name="childId" defaultValue="">
                <option value="">{t("supplies.noChild")}</option>
                {(children as any[]).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                ))}
              </select>
            </div>
            <div className="col field"><label className="label">{t("supplies.item")}</label><input className="input" name="title" required placeholder={t("supplies.itemPlaceholder")} /></div>
            <div className="field"><label className="label">{t("supplies.qty")}</label><input className="input" type="number" name="quantity" defaultValue={1} min={1} style={{ maxWidth: 90 }} /></div>
            <div className="field"><label className="label">{t("supplies.unit")}</label><input className="input" name="unit" defaultValue="pcs" style={{ maxWidth: 110 }} /></div>
          </div>
          <div className="field"><label className="label">{t("supplies.notesForParents")}</label><input className="input" name="notes" placeholder={t("supplies.notesPlaceholder")} /></div>
          <div className="field" style={{ maxWidth: 480 }}>
            <label className="label">{t("activities.recipients")}</label>
            <RecipientsPicker
              dict={dict}
              childOptions={picker.children}
              rooms={picker.rooms}
              role={session.role}
              assignedRoomIds={picker.assignedRoomIds}
            />
          </div>
          <button className="btn btn-primary" type="submit">{t("supplies.request")}</button>
        </form>
      </div>

      {(items as any[]).length === 0 && <div className="card"><p className="muted small">{t("supplies.noRequests")}</p></div>}
      {(items as any[]).map((s: any) => (
        <div className="card mb-2" key={s.id}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>{s.title} <span className="muted small">× {s.quantity} {s.unit}</span></div>
            <span className={s.status === "fulfilled" ? "badge badge-green" : "badge"}>
              {s.status === "fulfilled" ? t("supplies.fulfilled") : t("supplies.needed")}
            </span>
          </div>
          <div className="small muted">
            {s.first_name ? t("supplies.forChild", { name: `${s.first_name} ${s.last_name}` }) : t("supplies.noChild")}
          </div>
        {s.notes && <p className="small muted mt-1">{s.notes}</p>}
        <Attribution locale={locale} timeZone={timeZone} createdBy={s.created_by_name ?? null} createdAt={s.created_at ?? null} />
        <form action={updateSupplyStatusAction} className="row mt-2" style={{ gap: 6 }}>
            <input type="hidden" name="id" value={s.id} />
            <select className="select" name="status" defaultValue={s.status} style={{ maxWidth: 160 }}>
              <option value="needed">{t("supplies.needed")}</option>
              <option value="fulfilled">{t("supplies.fulfilled")}</option>
            </select>
            <button className="btn btn-ghost small" type="submit">{t("supplies.update")}</button>
          </form>
        </div>
      ))}
    </div>
  );
}
