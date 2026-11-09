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
//
// KID-737: on this page every unpaid invoice (pending or overdue) also gets
// the platform-wide "Pay with Instapay" link (the operator sets it on
// /platform — one link for the whole platform, never a per-daycare one) and
// a payment-proof upload with an optional payment reference. The upload
// never changes the invoice status: the platform operator reviews the proof
// and keeps marking the invoice paid through the existing control.
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { isOwnerRole } from "@/lib/role";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { getInstitute } from "@/lib/store";
import { getDaycareBilling, listInvoices, type DaycareInvoice, type DaycareBilling } from "@/lib/billing";
import { getPlatformInstapayUrl } from "@/lib/platform-settings";
import { recordToolUsage } from "@/lib/tool-usage";
import { uploadDaycareInvoiceProofAction } from "@/lib/actions";

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

export default async function PortalAccountBillingPage(props: { searchParams?: Promise<{ proof?: string; proofError?: string }> }) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
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
  await recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "billing", source: "portal", metadata: null });
  const inst = await getInstitute(instituteId);
  if (!inst) redirect("/portal/dashboard");
  const [billing, invoices] = await Promise.all([
    getDaycareBilling(instituteId),
    listInvoices(instituteId),
  ]);
  // KID-737: the platform-wide Instapay link — one setting for the whole
  // platform. When it is unset the Pay links hide and the owner gets the
  // "will appear here" hint instead of a dead link.
  const platformInstapay = await getPlatformInstapayUrl();
  const proofSaved = searchParams?.proof === "uploaded";
  const PROOF_ERRORS: Record<string, string> = {
    paid: "proofErrorPaid",
    proofType: "proofErrorType",
    proofSize: "proofErrorSize",
    proofUpload: "proofErrorUpload",
  };
  const proofErrorKey = searchParams?.proofError ? (PROOF_ERRORS[searchParams.proofError] ?? "") : "";

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
      {/* KID-737: the upload outcome says exactly what happened and what
          comes next — the platform reviews the proof, the status is theirs. */}
      {proofSaved && (
        <div className="card mb-4 banner-success">
          {tr(dict, "accountBilling.proofSaved")}
        </div>
      )}
      {proofErrorKey && (
        <div className="card mb-4 banner-error">
          {tr(dict, `accountBilling.${proofErrorKey}`)}
        </div>
      )}
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
                {/* KID-737: the pay link + proof upload live at the row. */}
                <th className="label" style={{ padding: 8 }}>{tr(dict, "accountBilling.colPay")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "accountBilling.colProof")}</th>
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
                  {/* KID-737: "Pay with Instapay" — the platform-wide link,
                      only for an unpaid cycle, opened in a new tab. Nothing
                      renders when the operator has not set a link yet —
                      never a dead link. */}
                  <td style={{ padding: 8 }}>
                    {inv.status !== "paid" && platformInstapay ? (
                      <a
                        className="btn btn-accent"
                        href={platformInstapay}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {tr(dict, "accountBilling.payWithInstapay")}
                      </a>
                    ) : inv.status !== "paid" ? (
                      <span className="small muted">{tr(dict, "accountBilling.payNoLink")}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  {/* KID-737: the proof upload per unpaid invoice — PNG/JPG/
                      PDF up to 5 MB plus an optional reference. Re-uploading
                      before payment replaces the current proof; the status
                      column never moves from an upload. The current proof
                      (and the operator's review outcome) stays visible. */}
                  <td style={{ padding: 8 }}>
                    {inv.status !== "paid" ? (
                      <div style={{ minWidth: 220 }}>
                        {inv.paymentProofUrl && (
                          <div className="small" style={{ marginBottom: 6 }}>
                            <a href={inv.paymentProofUrl} target="_blank" rel="noreferrer">
                              {tr(dict, "accountBilling.proofView")}
                            </a>
                            {inv.paymentProofUploadedAt && (
                              <div className="small muted">
                                {tr(dict, "accountBilling.proofUploadedOn", {
                                  date: inv.paymentProofUploadedAt.slice(0, 10),
                                })}
                              </div>
                            )}
                            {inv.paymentReference && (
                              <div className="small muted">{inv.paymentReference}</div>
                            )}
                          </div>
                        )}
                        <form action={uploadDaycareInvoiceProofAction}>
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <div className="label small">{tr(dict, "accountBilling.proofUploadLabel")}</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
                            <input
                              className="input"
                              name="file"
                              type="file"
                              accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
                              required
                              style={{ maxWidth: 200 }}
                            />
                            <input
                              className="input"
                              name="paymentReference"
                              placeholder={tr(dict, "accountBilling.proofReferencePlaceholder")}
                              style={{ maxWidth: 180 }}
                            />
                            <button className="btn btn-ghost" type="submit">
                              {inv.paymentProofUrl
                                ? tr(dict, "accountBilling.proofReplaceBtn")
                                : tr(dict, "accountBilling.proofUploadBtn")}
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : (
                      <span className="small muted">
                        {inv.paymentProofUrl ? (
                          <a href={inv.paymentProofUrl} target="_blank" rel="noreferrer">
                            {tr(dict, "accountBilling.proofView")}
                          </a>
                        ) : (
                          "—"
                        )}
                      </span>
                    )}
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
