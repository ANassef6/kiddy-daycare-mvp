import { requireSession } from "@/lib/require";
import { listSupplies } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { createSupplyAction, updateSupplyStatusAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PortalSuppliesPage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const items = await listSupplies(instituteId);

  return (
    <div>
      <h1 className="title">Supplies</h1>
      <p className="subtitle">Staff register supplies required from parents (tools, cloth, food, etc.) with quantities. Parents are notified of updates via the newsfeed.</p>

      <div className="card mb-4">
        <h3 className="subtitle">Request supplies</h3>
        <form action={createSupplyAction}>
          <div className="row">
            <div className="col field"><label className="label">Item</label><input className="input" name="title" required placeholder="e.g. Diapers, spare cloth" /></div>
            <div className="field"><label className="label">Qty</label><input className="input" type="number" name="quantity" defaultValue={1} min={1} style={{ maxWidth: 90 }} /></div>
            <div className="field"><label className="label">Unit</label><input className="input" name="unit" defaultValue="pcs" style={{ maxWidth: 110 }} /></div>
          </div>
          <div className="field"><label className="label">Notes for parents</label><input className="input" name="notes" placeholder="Size, brand, drop-off…" /></div>
          <button className="btn btn-primary" type="submit">Request</button>
        </form>
      </div>

      {(items as any[]).length === 0 && <div className="card"><p className="muted small">No supply requests yet.</p></div>}
      {(items as any[]).map((s: any) => (
        <div className="card mb-2" key={s.id}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>{s.title} <span className="muted small">× {s.quantity} {s.unit}</span></div>
            <span className={s.status === "fulfilled" ? "badge badge-green" : "badge"}>{s.status}</span>
          </div>
          {s.notes && <p className="small muted mt-1">{s.notes}</p>}
          <form action={updateSupplyStatusAction} className="row mt-2" style={{ gap: 6 }}>
            <input type="hidden" name="id" value={s.id} />
            <select className="select" name="status" defaultValue={s.status} style={{ maxWidth: 160 }}>
              <option value="needed">Needed</option>
              <option value="fulfilled">Fulfilled</option>
            </select>
            <button className="btn btn-ghost small" type="submit">Update</button>
          </form>
        </div>
      ))}
    </div>
  );
}
