import Link from "next/link";
import { requireSession } from "@/lib/require";
import {
  familiesForAccount,
  getChildPlan,
  invoicesForChild,
  paymentsForChild,
  accountPaymentMethods,
} from "@/lib/store";
import { recordPaymentAction, savePaymentMethodAction } from "@/lib/actions";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function ParentBillingPage() {
  const session = requireSession();
  const families = await familiesForAccount(session.accountId);
  const methods = await accountPaymentMethods(session.accountId);

  const rows = [];
  for (const child of families as any[]) {
    const [plan, invoices, payments] = await Promise.all([
      getChildPlan(String(child.id)),
      invoicesForChild(String(child.id)),
      paymentsForChild(String(child.id)),
    ]);
    rows.push({ child, plan, invoices, payments });
  }

  return (
    <div>
      <h1 className="title">Billing &amp; payments</h1>
      <p className="subtitle">
        Your invoices and recorded payments. Fees are set by {families.length ? "your daycare" : "the daycare"} —
        see invoices, track what&apos;s due, and record a payment you&apos;ve made.
      </p>

      {rows.length === 0 ? (
        <div className="card">
          <p className="muted small">
            You aren&apos;t linked to any children yet. Ask your daycare for an invite link.
          </p>
        </div>
      ) : (
        rows.map(({ child, plan, invoices, payments }: any) => {
          const due = invoices
            .filter((i: any) => i.status === "issued")
            .reduce((sum: number, i: any) => sum + Math.max(0, (i.amount_cents as number) - (i.paid_cents as number)), 0);
          const tx = [
            ...(invoices as any[]).map((i) => ({
              key: `inv-${i.id}`,
              date: i.due_date ?? i.created_at,
              desc: `${i.number} · ${i.description || "Invoice"}`,
              kind: "invoice",
              amount: (i.amount_cents as number) - (i.paid_cents as number),
              paid: i.paid_cents as number,
              total: i.amount_cents as number,
              status: i.status,
              invoice: i,
            })),
            ...(payments as any[]).map((p) => ({
              key: `pay-${p.id}`,
              date: p.paid_at,
              desc: `Payment — ${p.number}${p.reference ? ` (${p.reference})` : ""}`,
              kind: "payment",
              amount: -(p.amount_cents as number),
              paid: p.amount_cents as number,
              status: "paid",
            })),
          ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

          return (
            <div className="card mb-5" key={child.id}>
              <div className="status-card">
                <div>
                  <h3 className="title mb-1">
                    <Link href={`/child/${child.id}`}>{child.first_name} {child.last_name}</Link>
                  </h3>
                  <div className="small muted">
                    Plan: <strong>{String(plan?.plan_name ?? "Standard")}</strong> ·{" "}
                    {formatMoney(plan?.amount_cents) || "$0.00"} / {String(plan?.billing_period ?? "monthly")}
                  </div>
                </div>
                {due > 0 ? (
                  <span className="badge" style={{ background: "#fef3c7", color: "#b45309" }}>
                    {formatMoney(due)} due
                  </span>
                ) : (
                  <span className="badge badge-green">No balance due</span>
                )}
              </div>

              <h4 className="subtitle mb-2 mt-4">Transactions</h4>
              {tx.length === 0 ? (
                <p className="muted small">No transactions yet.</p>
              ) : (
                <table className="data">
                  <thead>
                    <tr><th>Date</th><th>Description</th><th>Amount</th><th></th></tr>
                  </thead>
                  <tbody>
                    {tx.map((t: any) => (
                      <tr key={t.key}>
                        <td className="small muted">{dateLabel(t.date)}</td>
                        <td className="small">{t.desc}</td>
                        <td className="small" style={{ fontWeight: 600, color: t.kind === "payment" ? "#047857" : "#0f172a" }}>
                          {t.kind === "payment" ? formatMoney(Math.abs(t.amount)) : formatMoney(t.amount)}
                        </td>
                        <td className="small">
                          {t.status === "void" && <span className="badge badge-gray">Void</span>}
                          {t.status === "paid" && <span className="badge badge-green">Paid</span>}
                          {t.status === "issued" && t.kind === "invoice" && (
                            <Reminder invoice={t.invoice} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {(invoices as any[]).some((i) => i.status === "issued" && (i.amount_cents as number) > (i.paid_cents as number)) && (
                <div className="card mt-3" style={{ background: "#f8fafc" }}>
                  <h4 className="subtitle mb-2">Record a payment</h4>
                  {(invoices as any[])
                    .filter((i: any) => i.status === "issued" && (i.amount_cents as number) > (i.paid_cents as number))
                    .map((inv: any) => {
                      const remaining = Math.max(0, (inv.amount_cents as number) - (inv.paid_cents as number));
                      return (
                        <form key={inv.id} action={recordPaymentAction} className="row mb-3" style={{ alignItems: "flex-end" }}>
                          <input type="hidden" name="invoiceId" value={String(inv.id)} />
                          <input type="hidden" name="origin" value="child" />
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label">{inv.number} — {inv.description || "Invoice"}</label>
                            <input className="input" name="amount" defaultValue={formatMoney(remaining)} inputMode="decimal" style={{ minWidth: 110 }} />
                          </div>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label">Method</label>
                            <select className="select" name="method">
                              <option value="bank transfer">Bank transfer</option>
                              <option value="card">Card</option>
                              <option value="cash">Cash</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label">Reference (optional)</label>
                            <input className="input" name="reference" placeholder="e.g. e-transfer #1234" />
                          </div>
                          <button className="btn btn-accent" type="submit">Record payment</button>
                        </form>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })
      )}

      <h2 className="title mt-5">Payment methods</h2>
      <div className="card">
        {methods.length === 0 ? (
          <p className="muted small mb-3">No saved payment methods.</p>
        ) : (
          methods.map((m: any) => (
            <div className="list-item" key={m.id}>
              <div>
                <strong>{m.label}</strong>{" "}
                <span className="muted small">
                  {m.provider}{m.last4 ? ` ·••• ${m.last4}` : ""}
                </span>
              </div>
              {m.is_default ? <span className="badge badge-green">Default</span> : null}
            </div>
          ))
        )}
        <form action={savePaymentMethodAction} className="row mt-3" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Label</label>
            <input className="input" name="label" defaultValue="Main card" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Card type</label>
            <select className="select" name="provider"><option>Bank account</option><option>Credit card</option><option>Debit card</option></select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Last 4 digits</label>
            <input className="input" name="last4" inputMode="numeric" maxLength={4} placeholder="4242" />
          </div>
          <label className="small row" style={{ alignItems: "center", gap: 6, marginBottom: 8 }}>
            <input type="checkbox" name="isDefault" /> Default
          </label>
          <button className="btn btn-ghost" type="submit">Save method</button>
        </form>
        <p className="muted small mt-3">
          No online payments — this just records how a payment was made so the daycare and you
          can keep a shared list of transactions.
        </p>
      </div>
    </div>
  );
}

function dateLabel(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function Reminder({ invoice }: { invoice: any }) {
  const remaining = Math.max(0, (invoice.amount_cents as number) - (invoice.paid_cents as number));
  return (
    <span className="badge" style={{ background: "#fef3c7", color: "#b45309" }}>
      {formatMoney(remaining)} due
    </span>
  );
}