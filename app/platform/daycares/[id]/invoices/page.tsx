// KID-245: Finance/2 — the per-daycare invoice list a superadmin reaches from
// the billing settings page (and the /platform list row). Server-rendered
// like every other /platform surface: generation records per billed cycle,
// the operator's manual total override (with its note), and the mark-as-paid
// action that re-activates a billing-disabled daycare. Guarded by the same
// double check the other platform pages use: internal sentinel session AND
// the env allowlist (accessing is not a role, KID-199.4r).
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { isPlatformOperatorEmail, isPlatformOperatorRole } from "@/lib/platform";
import { getInstitute } from "@/lib/store";
import { getDaycareBilling, listInvoices, type DaycareInvoice } from "@/lib/billing";
import { markInvoicePaidAction, updateInvoiceAmountAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<DaycareInvoice["status"], string> = {
  pending: "invoiceStatusPending",
  paid: "invoiceStatusPaid",
  overdue: "invoiceStatusOverdue",
};

/** Friendly labels for the failures the invoice actions redirect back with
 *  (the engine error names, lib/billing.ts). */
const INVOICE_ERRORS: Record<string, string> = {
  "invoice-not-found": "That invoice no longer exists. Refresh the invoice list.",
  "invoice-paid-locked": "A paid invoice can no longer be edited.",
  "invoice-total-invalid": "The invoice total must be a number of at least zero.",
  unknown: "Something went wrong updating the invoice. Please try again.",
};

export default async function DaycareInvoicesPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { saved?: string; error?: string };
}) {
  const session = requireSession();
  if (!isPlatformOperatorRole(session.role) || !isPlatformOperatorEmail(session.email)) {
    redirect("/login");
  }
  const { dict, dir } = await i18nForAccount(session.accountId);
  const instituteId = String(params.id ?? "");
  const inst = await getInstitute(instituteId);
  if (!inst) redirect("/platform?error=missing-id");
  const [invoices, billing] = await Promise.all([
    listInvoices(instituteId),
    getDaycareBilling(instituteId),
  ]);
  const saved = searchParams.saved === "1";
  const error = searchParams.error ? (INVOICE_ERRORS[searchParams.error] ?? INVOICE_ERRORS.unknown) : "";
  const daycareActive = Number(inst.active ?? 1) === 1;

  return (
    <div dir={dir}>
      <h1 className="title">{tr(dict, "platform.invoiceTitle")}</h1>
      <p className="subtitle">{String(inst.name)}</p>

      <p className="small muted">
        <a href={`/platform/daycares/${instituteId}/billing`}>
          ← {tr(dict, "platform.invoiceBackToBilling")}
        </a>
        <span style={{ marginLeft: 12 }}>
          {tr(dict, "platform.billingCurrentPlan")}: <strong>{billing.plan}</strong>
        </span>
      </p>

      <p className="small muted">{tr(dict, "platform.invoiceSubtitle")}</p>

      {/* The enforcement state, stated where the operator can fix it: an
          overdue invoice disabled this daycare and marking it paid restores
          every user's access. */}
      {!daycareActive && invoices.some((i) => i.status === "overdue") && (
        <div className="card mb-4 banner-error">{tr(dict, "platform.invoiceDaycareBlocked")}</div>
      )}
      {saved && <div className="card mb-4 banner-success">{tr(dict, "platform.invoiceSaved")}</div>}
      {error && <div className="card mb-4 banner-error">{error}</div>}

      {invoices.length === 0 ? (
        <div className="card">{tr(dict, "platform.invoiceNone")}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="card" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="label" style={{ textAlign: dir === "rtl" ? "right" : "left", padding: 8 }}>
                  {tr(dict, "platform.invoiceCycle")}
                </th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.invoicePeak")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.invoiceBillable")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.invoiceFlat")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.invoiceIncremental")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.invoiceTotal")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.invoiceDue")}</th>
                <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.invoiceStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td className="small" style={{ padding: 8 }}>
                    <strong>{inv.cycleMonth}</strong>
                    <div className="small muted">
                      {tr(dict, "platform.invoicePlan")}: {inv.plan}
                    </div>
                  </td>
                  <td className="small" style={{ padding: 8 }}>
                    {inv.maxActiveChildren}
                    <div className="small muted" title={tr(dict, "platform.invoicePeakHint")}>
                      {inv.billableChildren} {tr(dict, "platform.invoiceBillable")}
                    </div>
                  </td>
                  <td className="small" style={{ padding: 8 }}>{inv.billableChildren}</td>
                  <td className="small" style={{ padding: 8 }}>{inv.flatRateAmount}</td>
                  <td className="small" style={{ padding: 8 }}>{inv.incrementalAmount}</td>
                  <td className="small" style={{ padding: 8 }}>
                    <strong>{inv.totalAmount}</strong> {inv.currency}
                    {inv.manualAdjustment && (
                      <div className="small muted">{inv.manualAdjustment}</div>
                    )}
                  </td>
                  <td className="small" style={{ padding: 8 }}>{inv.dueDate}</td>
                  <td className="small" style={{ padding: 8 }}>
                    {tr(dict, `platform.${STATUS_LABEL[inv.status]}`)}
                    {inv.status === "paid" && inv.paidAt && (
                      <div className="small muted">
                        {tr(dict, "platform.invoicePaidAt")}: {inv.paidAt.slice(0, 10)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-invoice operator forms: the manual total override (before
          payment only — a paid invoice is locked) and mark-as-paid, which
          lifts the billing block. */}
      {invoices
        .filter((inv) => inv.status !== "paid")
        .map((inv) => (
          <div className="card mt-4" key={`form-${inv.id}`}>
            <h3 className="subtitle">
              {tr(dict, "platform.invoiceCycle")} {inv.cycleMonth} — {tr(dict, "platform.invoiceEditTitle")}
            </h3>
            {inv.status === "overdue" && (
              <p className="small muted">{tr(dict, "platform.invoiceDaycareBlocked")}</p>
            )}
            <form action={updateInvoiceAmountAction} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
              <input type="hidden" name="invoiceId" value={inv.id} />
              <div className="field">
                <label className="label">{tr(dict, "platform.invoiceEditTotalLabel")}</label>
                <input
                  className="input"
                  name="totalAmountEgp"
                  type="number"
                  min={0}
                  defaultValue={inv.totalAmount}
                />
              </div>
              <div className="field" style={{ flexGrow: 1, minWidth: 240 }}>
                <label className="label">{tr(dict, "platform.invoiceNoteLabel")}</label>
                <input
                  className="input"
                  name="manualAdjustment"
                  defaultValue={inv.manualAdjustment}
                  placeholder={tr(dict, "platform.invoiceNoteHint")}
                />
              </div>
              <button className="btn btn-primary" type="submit">
                {tr(dict, "platform.invoiceSave")}
              </button>
            </form>
            <form action={markInvoicePaidAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="invoiceId" value={inv.id} />
              <button className="btn" type="submit">
                {tr(dict, "platform.invoiceMarkPaid")}
              </button>
            </form>
          </div>
        ))}

      {invoices.length > 0 && (
        <p className="small muted" style={{ marginTop: 12 }}>
          {tr(dict, "platform.invoiceLocked")}
        </p>
      )}
    </div>
  );
}
