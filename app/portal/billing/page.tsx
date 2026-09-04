import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listChildren, listInstitutes, listPlans, listInvoices } from "@/lib/store";
import { setChildPlanAction } from "@/lib/actions";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function PortalBillingPage() {
  requireSession();
  const institutes = await listInstitutes();
  const instituteId = institutes[0]?.id as string | undefined;
  const [children, plans, invoices] = await Promise.all([
    instituteId ? listChildren(instituteId) : Promise.resolve([]),
    instituteId ? listPlans(instituteId) : Promise.resolve([]),
    instituteId ? listInvoices(instituteId) : Promise.resolve([]),
  ]);

  const plansByChild = new Map(plans.map((p: any) => [String(p.child_id), p]));
  const balanceByChild = new Map<string, number>();
  for (const inv of invoices as any[]) {
    if (String(inv.status) === "void") continue;
    const outstanding = (inv.amount_cents as number) - (inv.paid_cents as number);
    balanceByChild.set(String(inv.child_id), (balanceByChild.get(String(inv.child_id)) ?? 0) + Math.max(0, outstanding));
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 className="title mb-2">Billing</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            One fee/plan per child, manual invoices, and recorded payments. Parents see invoices
            and payments in their transaction list.
          </p>
        </div>
        <Link className="btn btn-primary" href="/portal/billing/invoices">Invoices</Link>
      </div>

      <h2 className="title mt-5">Fees &amp; plans</h2>
      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>Child</th>
              <th>Plan</th>
              <th>Amount</th>
              <th>Period</th>
              <th>Outstanding</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {children.map((c: any) => {
              const plan = plansByChild.get(String(c.id));
              const outstanding = balanceByChild.get(String(c.id)) ?? 0;
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/portal/children/${c.id}`}><strong>{c.first_name} {c.last_name}</strong></Link>
                    <div className="small muted">{c.room_name ?? "—"}</div>
                  </td>
                  <td>
                    <form action={setChildPlanAction} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <input type="hidden" name="childId" value={String(c.id)} />
                      <input name="planName" className="input small" defaultValue={String(plan?.plan_name ?? "Standard")} style={{ minWidth: 110 }} />
                      <input name="billingPeriod" className="input small" defaultValue={String(plan?.billing_period ?? "monthly")} style={{ minWidth: 90 }} />
                      <button className="btn btn-ghost small" type="submit">Save</button>
                    </form>
                  </td>
                  <td>
                    <form action={setChildPlanAction} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <input type="hidden" name="childId" value={String(c.id)} />
                      <input type="hidden" name="planName" value={String(plan?.plan_name ?? "Standard")} />
                      <input type="hidden" name="billingPeriod" value={String(plan?.billing_period ?? "monthly")} />
                      <input name="amount" className="input small" defaultValue={plan ? formatMoney(plan.amount_cents) : "0.00"} style={{ minWidth: 90 }} inputMode="decimal" />
                      <button className="btn btn-ghost small" type="submit">Save</button>
                    </form>
                  </td>
                  <td className="small muted">{(plan?.billing_period as string) ?? "monthly"}</td>
                  <td className={outstanding > 0 ? "small" : "small muted"} style={outstanding > 0 ? { color: "#b45309", fontWeight: 600 } : undefined}>
                    {formatMoney(outstanding)}
                  </td>
                  <td className="small">
                    {!plan && <span className="badge badge-gray">No plan</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small mt-3">
          Plan and amount are set per child (no shared pricing groups). The amount shown in the plan
          column updates when you save; outstanding balance reflects invoices minus recorded payments.
        </p>
      </div>
    </div>
  );
}