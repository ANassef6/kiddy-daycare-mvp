// KID-246: Finance/3 — the daycare owner's own "Account billing" page under
// Tools. The owner sees their daycare's subscription plan and current rates
// (read-only — the platform team manages them on /platform/daycares/[id]/
// billing), the invoice ledger (cycle, amount, due date, status, paid date)
// and the upcoming/overdue state.
//
// Owner-only on BOTH surfaces: the sidebar tab is rendered for the exact
// owner role (components/PortalSidebar.tsx), and this page re-checks the
// session so a direct URL visit by any other role is rejected — the tab and
// the route can never drift apart (lib/role.ts isOwnerRole).
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { isOwnerRole } from "@/lib/role";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { getInstitute } from "@/lib/store";
import { getDaycareBilling, listInvoices, type DaycareInvoice, type DaycareBilling } from "@/lib/billing";

export const dynamic = "force-dynamic";

const PLAN_LABEL: Record<DaycareBilling["plan"], string> = {
  demo: "planDemo",
  monthly: "planMonthly",
  annual: "planAnnual",
};

const STATUS_LABEL: Record<DaycareInvoice["status"], string> = {
  pending: "statusPending",
  paid: "statusPaid",
  overdue: "statusOverdue",
};

const STATUS_TONE: Record<DaycareInvoice["status"], string> = {
  pending: "badge-amber",
  paid: "badge-green",
  overdue: "badge-red",
};

export default async function PortalAccountBillingPage() {
  const session = requireSession();
  if (!isOwnerRole(session.role)) {
    // Admins, staff and carers render the portal; parents have their own
    // shell. Nothing here is theirs to see — a redirect is a quiet refusal.
    redirect("/portal/dashboard");
  }
  const { dict, dir } = await i18nForAccount(session.accountId);
  const instituteId = await resolveTenantInstituteId();
  if (!instituteId) {
    return (
      <div dir={dir}>
        <h1 className="title">{tr(dict, "accountBilling.title")}</h1>
        <p>{tr(dict, "accountBilling.noInvoices")}</p>
      </div>
    );
  }
  const inst = await getInstitute(instituteId);
  if (!inst) redirect("/portal/dashboard");
  const [billing, invoices] = await Promise.all([
    getDaycareBilling(instituteId),
    listInvoices(instituteId),
  ]);

  // Upcoming/overdue state: an unpaid invoice due within 3 days is the
  // pre-disable warning window, and an overdue invoice means the enforcement
  // sweep (lib/billing.ts applyOverdueEnforcement) has flipped or is about to
  // flip institute.active — the owner must act (notify the platform to pay).
  const todayIso = new Date().toISOString().slice(0, 10);
  const dueSoonCutoff = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const overdue = invoices.filter((i) => i.status === "overdue");
  const dueSoon = invoices.filter(
    (i) => i.status === "pending" && i.dueDate <= dueSoonCutoff && i.dueDate >= todayIso
  );
  const awaitingPayment = overdue.length + dueSoon.length > 0;

  const planName = tr(dict, `accountBilling.${PLAN_LABEL[billing.plan]}`);

  return (
    <div dir={dir}>
      <h1 className="title">{tr(dict, "accountBilling.title")}</h1>
      <p className="subtitle">{tr(dict, "accountBilling.subtitle")}</p>

      <div className="row mb-4">
        <div className="card col" style={{ minWidth: 220 }}>
          <div className="label">{tr(dict, "accountBilling.planCard")}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{planName}</div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {inst.name}
            {billing.firstCycleStart && (
              <>
                {" · "}
                {tr(dict, "accountBilling.firstBilledMonth")}: {billing.firstCycleStart.slice(0, 7)}
              </>
            )}
          </div>
        </div>
        <div className="card col" style={{ minWidth: 220, flex: 1 }}>
          <div className="label">{tr(dict, "accountBilling.ratesCard")}</div>
          {billing.plan === "monthly" && (
            <div className="small" style={{ marginTop: 4 }}>
              {tr(dict, "accountBilling.monthlyRate")}: <strong>{billing.monthlyRateEgp}</strong>
              <br />
              {tr(dict, "accountBilling.perChildRate")}: <strong>{billing.perChildRateEgp}</strong>
              <br />
              {tr(dict, "accountBilling.freeThreshold")}: <strong>{billing.freeChildThreshold}</strong>
            </div>
          )}
          {billing.plan === "annual" && (
            <div className="small" style={{ marginTop: 4 }}>
              {tr(dict, "accountBilling.annualAmount")}: <strong>{billing.annualAmountEgp}</strong>
            </div>
          )}
          {billing.plan === "demo" && (
            <div className="small muted" style={{ marginTop: 4 }}>
              {tr(dict, "accountBilling.demoNote")}
            </div>
          )}
          <div className="small muted mt-1">{tr(dict, "accountBilling.ratesReadOnly")}</div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="label mb-1">{tr(dict, "accountBilling.upcomingCard")}</div>
        {overdue.map((inv) => (
          <div key={`overdue-${inv.id}`} className="small" style={{ color: "#b91c1c", fontWeight: 700 }}>
            {tr(dict, "accountBilling.overdueWarning", {
              cycle: inv.cycleMonth,
              amount: String(inv.totalAmount),
            })}
          </div>
        ))}
        {dueSoon.map((inv) => (
          <div key={`due-${inv.id}`} className="small" style={{ color: "#92400e", fontWeight: 700 }}>
            {tr(dict, "accountBilling.dueSoon", { cycle: inv.cycleMonth, date: inv.dueDate })}
          </div>
        ))}
        {awaitingPayment && (
          <div className="small muted mt-1">{tr(dict, "accountBilling.autoDisableHint")}</div>
        )}
        {!awaitingPayment && !!invoices.length && (
          <div className="small muted">{tr(dict, "accountBilling.nothingDue")}</div>
        )}
        {invoices.length === 0 && billing.plan !== "demo" && (
          <div className="small muted">{tr(dict, "accountBilling.noInvoices")}</div>
        )}
        {invoices.length === 0 && billing.plan === "demo" && (
          <div className="small muted">{tr(dict, "accountBilling.demoNote")}</div>
        )}
      </div>

      <h2 className="h3 mb-2">{tr(dict, "accountBilling.invoicesCard")}</h2>
      {invoices.length === 0 ? (
        <div className="card">
          {billing.plan === "demo"
            ? tr(dict, "accountBilling.demoNote")
            : tr(dict, "accountBilling.noInvoices")}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="card" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="label" style={{ textAlign: dir === "rtl" ? "right" : "left", padding: 8 }}>
                  {tr(dict, "accountBilling.colCycle")}
                </th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "accountBilling.colAmount")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "accountBilling.colDue")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "accountBilling.colStatus")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "accountBilling.colPaid")}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td className="small" style={{ padding: 8 }}>
                    <strong>{inv.cycleMonth}</strong>
                    <div className="small muted">
                      {tr(dict, "accountBilling.breakdownMeta", {
                        children: String(inv.billableChildren),
                        base: String(inv.flatRateAmount),
                        extra: String(inv.incrementalAmount),
                        rate: String(inv.incrementalRate),
                      })}
                    </div>
                    {inv.manualAdjustment && (
                      <div className="small muted">
                        {tr(dict, "accountBilling.manualNote", { note: inv.manualAdjustment })}
                      </div>
                    )}
                  </td>
                  <td className="small" style={{ padding: 8 }}>
                    <strong>{inv.totalAmount}</strong> {inv.currency}
                  </td>
                  <td className="small" style={{ padding: 8 }}>{inv.dueDate}</td>
                  <td className="small" style={{ padding: 8 }}>
                    <span className={`badge ${STATUS_TONE[inv.status]}`}>
                      {tr(dict, `accountBilling.${STATUS_LABEL[inv.status]}`)}
                    </span>
                  </td>
                  <td className="small" style={{ padding: 8 }}>
                    {inv.status === "paid" ? inv.paidAt.slice(0, 10) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
