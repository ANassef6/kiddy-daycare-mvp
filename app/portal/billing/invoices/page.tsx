import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listChildren, listInstitutes, listInvoices, listPaymentsForInvoice } from "@/lib/store";
import { createInvoiceAction, recordPaymentAction, voidInvoiceAction } from "@/lib/actions";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function PortalInvoicesPage() {
  requireSession();
  const institutes = await listInstitutes();
  const instituteId = institutes[0]?.id as string | undefined;
  const [children, invoices] = await Promise.all([
    instituteId ? listChildren(instituteId) : Promise.resolve([]),
    instituteId ? listInvoices(instituteId) : Promise.resolve([]),
  ]);

  const paymentsByInvoice = new Map<string, unknown[]>();
  for (const inv of invoices as any[]) {
    paymentsByInvoice.set(String(inv.id), await listPaymentsForInvoice(String(inv.id)));
  }

  return (
    <div>
      <Link className="small muted" href="/portal/billing">← Billing</Link>
      <h1 className="title mt-1">Invoices</h1>
      <p className="subtitle">
        Create a manual invoice for a child and record the payments that come in.
      </p>

      <h2 className="title mt-5">Create an invoice</h2>
      <form className="card mb-5" action={createInvoiceAction}>
        <div className="row">
          <div className="col field">
            <label className="label">Child</label>
            <select className="select" name="childId" required>
              <option value="">— select —</option>
              {children.map((c: any) => (
                <option key={c.id} value={String(c.id)}>{c.first_name} {c.last_name}</option>
              ))}
            </select>
          </div>
          <div className="col field">
            <label className="label">Amount ($)</label>
            <input className="input" name="amount" inputMode="decimal" placeholder="0.00" required />
          </div>
          <div className="col field">
            <label className="label">Due date</label>
            <input className="input" name="dueDate" type="date" />
          </div>
        </div>
        <div className="field">
          <label className="label">Description</label>
          <input className="input" name="description" placeholder="e.g. August tuition" />
        </div>
        <button className="btn btn-primary" type="submit">Create invoice</button>
      </form>

      <h2 className="title mt-5">All invoices</h2>
      {invoices.length === 0 ? (
        <div className="card"><p className="muted small">No invoices yet.</p></div>
      ) : (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>Number</th>
                <th>Child</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Paid</th>
                <th>Due</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(invoices as any[]).map((inv) => {
                const paid = inv.paid_cents as number;
                const balance = Math.max(0, (inv.amount_cents as number) - paid);
                const open = inv.status === "issued" && balance > 0;
                return (
                  <tr key={inv.id}>
                    <td className="small"><strong>{inv.number}</strong></td>
                    <td className="small">{inv.first_name} {inv.last_name}</td>
                    <td className="small">{inv.description}</td>
                    <td className="small">{formatMoney(inv.amount_cents)}</td>
                    <td className="small muted">{formatMoney(paid)}</td>
                    <td className="small">{inv.due_date ?? "—"}</td>
                    <td className="small">
                      {inv.status === "void" ? <span className="badge badge-gray">Void</span>
                        : inv.status === "paid" ? <span className="badge badge-green">Paid</span>
                        : <span className="badge">Issued</span>}
                    </td>
                    <td className="small">
                      {open ? <RecordPaymentForm invoice={inv} /> : null}
                      {inv.status === "issued" && paid === 0 ? (
                        <form action={voidInvoiceAction} style={{ display: "inline" }}>
                          <input type="hidden" name="invoiceId" value={String(inv.id)} />
                          <button className="btn btn-ghost small" style={{ marginLeft: 6 }} type="submit">Void</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="title mt-5">Recent payments</h2>
      <div className="grid">
        {(invoices as any[]).slice(0, 6).map((inv) => {
          const pays = (paymentsByInvoice.get(String(inv.id)) ?? []) as any[];
          if (pays.length === 0) return null;
          return (
            <div key={inv.id} className="card">
              <div className="small muted">{inv.number} · {inv.first_name} {inv.last_name}</div>
              {pays.map((p) => (
                <div className="list-item small" key={p.id}>
                  <div>
                    <strong>{formatMoney(p.amount_cents)}</strong>{" "}
                    <span className="muted">{p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
                  </div>
                  <div className="muted">{new Date(p.paid_at).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          );
        })}
        {[...paymentsByInvoice.values()].every((p) => p.length === 0) && (
          <div className="card"><p className="muted small">No payments recorded yet.</p></div>
        )}
      </div>
    </div>
  );
}

function RecordPaymentForm({ invoice }: { invoice: any }) {
  return (
    <form action={recordPaymentAction} className="row" style={{ gap: 4, alignItems: "center", flexWrap: "nowrap" }}>
      <input type="hidden" name="invoiceId" value={String(invoice.id)} />
      <input type="hidden" name="origin" value="portal" />
      <input className="input small" name="amount" defaultValue="0.00" inputMode="decimal" style={{ minWidth: 80, maxWidth: 96 }} />
      <select className="select small" name="method" style={{ minWidth: 90, width: "auto" }}>
        <option value="bank transfer">Bank transfer</option>
        <option value="card">Card</option>
        <option value="cash">Cash</option>
        <option value="other">Other</option>
      </select>
      <button className="btn btn-accent small" type="submit">Pay</button>
    </form>
  );
}