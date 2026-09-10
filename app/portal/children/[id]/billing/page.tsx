import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import { getChild, listInstitutes, listChildBilling } from "@/lib/store";
import { addChildBillingAction, updateBillingStatusAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

const STATUSES = ["pending", "paid", "overdue", "cancelled"] as const;

function money(cents: number, currency: string): string {
  const v = (cents / 100).toFixed(2);
  return `${currency} ${v}`;
}

export default async function ChildBillingPage({ params }: { params: { id: string } }) {
  requireSession();
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const child = await getChild(params.id);
  if (!child) notFound();
  const bills = child ? await listChildBilling(child.id) : [];

  const totalPending = bills
    .filter((b) => b.status === "pending" || b.status === "overdue")
    .reduce((sum, b) => sum + (Number(b.amount_cents) || 0), 0);

  return (
    <div>
      <Link className="small muted" href={`/portal/children/${child.id}`}>← {child.first_name} {child.last_name}</Link>
      <h1 className="title mt-1">Billing — {child.first_name} {child.last_name}</h1>
      <p className="subtitle">
        Child-level billing for admins. Track fees per child and mark them paid.
      </p>

      {bills.length > 0 && (
        <div className="card mb-4" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="label">Outstanding balance</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: totalPending > 0 ? "#b91c1c" : "#047857" }}>
              {money(totalPending, bills[0]?.currency ?? "CAD")}
            </div>
          </div>
          <span className={totalPending > 0 ? "badge badge-red" : "badge badge-green"}>
            {totalPending > 0 ? `${bills.filter((b) => b.status === "pending" || b.status === "overdue").length} outstanding` : "All clear"}
          </span>
        </div>
      )}

      <div className="card mb-4">
        <h3 className="subtitle">Add a billing record</h3>
        <form action={addChildBillingAction}>
          <input type="hidden" name="childId" value={child.id as string} />
          <div className="row">
            <div className="col field"><label className="label">Description</label><input className="input" name="description" required placeholder="e.g. January fees" /></div>
            <div className="col field"><label className="label">Amount (CAD)</label><input className="input" name="amountCents" type="number" step="0.01" min="0" required placeholder="0.00" /></div>
          </div>
          <div className="row">
            <div className="col field">
              <label className="label">Period (optional)</label>
              <input className="input" name="period" placeholder="e.g. Jan 2026" />
            </div>
            <div className="col field">
              <label className="label">Due date (optional)</label>
              <input className="input" name="dueDate" type="date" />
            </div>
            <div className="col field">
              <label className="label">Currency</label>
              <select className="select" name="currency"><option>CAD</option><option>USD</option></select>
            </div>
          </div>
          <div className="row">
            <div className="col field">
              <label className="label">Status</label>
              <select className="select" name="status" defaultValue="pending">
                {STATUSES.map((s) => <option key={s} value={s}>{capital(s)}</option>)}
              </select>
            </div>
            <div className="col field" style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn btn-primary" type="submit">Add record</button>
            </div>
          </div>
        </form>
      </div>

      {bills.length === 0 ? (
        <p className="muted small">No billing records yet.</p>
      ) : (
        <table className="data">
          <thead>
            <tr><th>Description</th><th>Amount</th><th>Period</th><th>Due date</th><th>Status</th><th>Created</th></tr>
          </thead>
          <tbody>
            {bills.map((b: any) => (
              <tr key={b.id}>
                <td><strong>{b.description}</strong></td>
                <td><strong>{money(Number(b.amount_cents) || 0, b.currency)}</strong></td>
                <td className="small">{b.period ?? "—"}</td>
                <td className="small">{b.due_date ?? "—"}</td>
                <td>
                  <form action={updateBillingStatusAction} className="row" style={{ gap: 6, alignItems: "center" }}>
                    <input type="hidden" name="billingId" value={b.id} />
                    <input type="hidden" name="childId" value={child.id} />
                    <select className="select" name="status" defaultValue={b.status} style={{ maxWidth: 120, padding: "4px 8px", fontSize: 13 }}>
                      {STATUSES.map((s) => <option key={s} value={s}>{capital(s)}</option>)}
                    </select>
                    <button className="btn btn-ghost" type="submit" style={{ fontSize: 12, padding: "4px 10px" }}>Update</button>
                  </form>
                </td>
                <td className="small">{new Date(b.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function capital(s: unknown): string {
  const v = String(s ?? "");
  return v.charAt(0).toUpperCase() + v.slice(1);
}