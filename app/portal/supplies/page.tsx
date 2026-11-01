import { requireSession } from "@/lib/require";
import { listSupplies } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { createSupplyAction, updateSupplyStatusAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-221: the Supplies page was the full English page inside an Arabic shell
// (heading, request form, notes and status chips). Localized; the status
// select now carries translated options instead of the raw DB enum.
export default async function PortalSuppliesPage() {
  const session = requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{t("supplies.noInstitute")}</p>;
  const items = await listSupplies(instituteId);

  return (
    <div>
      <h1 className="title">{t("supplies.title")}</h1>
      <p className="subtitle">{t("supplies.subtitle")}</p>

      <div className="card mb-4">
        <h3 className="subtitle">{t("supplies.requestTitle")}</h3>
        <form action={createSupplyAction}>
          <div className="row">
            <div className="col field"><label className="label">{t("supplies.item")}</label><input className="input" name="title" required placeholder={t("supplies.itemPlaceholder")} /></div>
            <div className="field"><label className="label">{t("supplies.qty")}</label><input className="input" type="number" name="quantity" defaultValue={1} min={1} style={{ maxWidth: 90 }} /></div>
            <div className="field"><label className="label">{t("supplies.unit")}</label><input className="input" name="unit" defaultValue="pcs" style={{ maxWidth: 110 }} /></div>
          </div>
          <div className="field"><label className="label">{t("supplies.notesForParents")}</label><input className="input" name="notes" placeholder={t("supplies.notesPlaceholder")} /></div>
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
          {s.notes && <p className="small muted mt-1">{s.notes}</p>}
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
