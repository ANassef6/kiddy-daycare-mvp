import Link from "next/link";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import { getChild,listChildBilling, isChildInScope, getInstitute } from "@/lib/store";
import { addChildBillingAction, updateBillingStatusAction } from "@/lib/actions";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, normalizeCurrency } from "@/lib/currency";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr, fmtDateFor } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n";
import Attribution from "@/components/Attribution";
import { signedUrlsForRefs } from "@/lib/storage";

export const dynamic = "force-dynamic";

const STATUSES = ["pending", "paid", "overdue", "cancelled"] as const;

const STATUS_LABEL_KEYS: Record<string, string> = {
  pending: "childBilling.statusPending",
  paid: "childBilling.statusPaid",
  overdue: "childBilling.statusOverdue",
  cancelled: "childBilling.statusCancelled",
};

function billingStatusLabel(status: unknown, dict: Dict): string {
  return tr(dict, STATUS_LABEL_KEYS[String(status)] ?? "childBilling.statusPending");
}

function money(cents: number, currency: string): string {
  const v = (cents / 100).toFixed(2);
  return `${currency} ${v}`;
}

export default async function ChildBillingPage(
  props: {
    params: Promise<{ id: string }>;
    // KID-489 item 2 (KID-491): addChildBillingAction bounces an invalid
    // payment link back here as ?error=paymentlink for the banner below.
    searchParams?: Promise<{ error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const session = await requireSession();
  const { dict, locale: billingLocale } = await i18nForAccount(session.accountId);
  const iid = await resolveTenantInstituteId();
  // KID-489 item 1 (KID-490): the center's default currency seeds the form's
  // currency select and the display fallbacks below.
  const center = iid ? await getInstitute(iid) : undefined;
  const centerCurrency = normalizeCurrency(center?.default_currency, DEFAULT_CURRENCY);
  const child = await getChild(params.id);
  if (!child) notFound();
  // KID-103: direct URLs to out-of-scope children are hidden.
  if (iid && !(await isChildInScope(iid, session.accountId, String(child.id)))) {
    notFound();
  }
  // KID-1328 defense-in-depth: the rendered record itself must belong to the
  // request tenant — never render another institute's billing data.
  if (iid && String(child.institute_id ?? "") !== iid) {
    notFound();
  }
  const bills = child ? await listChildBilling(child.id) : [];
  // KID-1177: proof links resolve to short-lived signed URLs here; legacy
  // public URLs pass through unchanged.
  const proofHrefs = await signedUrlsForRefs(
    bills.map((b) => String(b.payment_proof_url ?? ""))
  );

  const totalPending = bills
    .filter((b) => b.status === "pending" || b.status === "overdue")
    .reduce((sum, b) => sum + (Number(b.amount_cents) || 0), 0);

  return (
    <div>
      <Link className="small muted" href={`/portal/children/${child.id}`}>{tr(dict, "childBilling.backToChild", { first: String(child.first_name), last: String(child.last_name) })}</Link>
      <h1 className="title mt-1">{tr(dict, "childBilling.pageTitle", { first: String(child.first_name), last: String(child.last_name) })}</h1>
      <p className="subtitle">
        {tr(dict, "childBilling.pageSubtitle")}
      </p>

      {searchParams?.error === "paymentlink" && (
        <div role="alert" className="card mb-4" style={{ borderLeft: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{tr(dict, "profile.paymentLinkInvalid")}</p>
        </div>
      )}

      {bills.length > 0 && (
        <div className="card mb-4" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="label">{tr(dict, "childBilling.outstandingBalance")}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: totalPending > 0 ? "#b91c1c" : "#047857" }}>
              {money(totalPending, bills[0]?.currency ?? centerCurrency)}
            </div>
          </div>
          <span className={totalPending > 0 ? "badge badge-red" : "badge badge-green"}>
            {totalPending > 0
              ? tr(dict, "childBilling.outstandingCount", { count: bills.filter((b) => b.status === "pending" || b.status === "overdue").length })
              : tr(dict, "childBilling.allClear")}
          </span>
        </div>
      )}

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "childBilling.addRecordHeading")}</h3>
        <form action={addChildBillingAction}>
          <input type="hidden" name="childId" value={child.id as string} />
          <div className="row">
            <div className="col field"><label className="label">{tr(dict, "common.description")}</label><input className="input" name="description" required placeholder={tr(dict, "childBilling.descriptionPlaceholder")} /></div>
            <div className="col field"><label className="label">{tr(dict, "childBilling.fieldAmount")}</label><input className="input" name="amountCents" type="number" step="0.01" min="0" required placeholder={tr(dict, "childBilling.amountPlaceholder")} /></div>
          </div>
          <div className="row">
            <div className="col field">
              <label className="label">{tr(dict, "childBilling.fieldPeriod")}</label>
              <input className="input" name="period" placeholder={tr(dict, "childBilling.periodPlaceholder")} />
            </div>
            <div className="col field">
              <label className="label">{tr(dict, "childBilling.fieldDueDate")}</label>
              <input className="input" name="dueDate" type="date" />
            </div>
            <div className="col field">
              <label className="label">{tr(dict, "childBilling.fieldCurrency")}</label>
              <select className="select" name="currency" defaultValue={centerCurrency}>
                {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="col field">
              <label className="label">{tr(dict, "common.status")}</label>
              <select className="select" name="status" defaultValue="pending">
                {STATUSES.map((s) => <option key={s} value={s}>{billingStatusLabel(s, dict)}</option>)}
              </select>
            </div>
            {/* KID-489 item 2 (KID-491): per-invoice payment link, prefilled
                from the center's Instapay URL so the daycare can override (or
                clear) it for one invoice without touching center settings. */}
            <div className="col field">
              <label className="label">{tr(dict, "profile.paymentLink")}</label>
              <input
                className="input"
                name="paymentLink"
                type="url"
                inputMode="url"
                defaultValue={String(center?.instapay_url ?? "")}
              />
            </div>
            <div className="col field" style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn btn-primary" type="submit">{tr(dict, "childBilling.addRecordBtn")}</button>
            </div>
          </div>
        </form>
      </div>

      {bills.length === 0 ? (
        <p className="muted small">{tr(dict, "childBilling.noBillingRecords")}</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>{tr(dict, "common.description")}</th>
              <th>{tr(dict, "childBilling.colAmount")}</th>
              <th>{tr(dict, "childBilling.colPeriod")}</th>
              <th>{tr(dict, "accountBilling.colDue")}</th>
              <th>{tr(dict, "common.status")}</th>
              <th>{tr(dict, "childBilling.colPay")}</th>
              <th>{tr(dict, "childBilling.colProof")}</th>
              <th>{tr(dict, "childBilling.colCreated")}</th>
              <th>{tr(dict, "childBilling.colBy")}</th>
            </tr>
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
                      {STATUSES.map((s) => <option key={s} value={s}>{billingStatusLabel(s, dict)}</option>)}
                    </select>
                    <button className="btn btn-ghost" type="submit" style={{ fontSize: 12, padding: "4px 10px" }}>{tr(dict, "childBilling.updateBtn")}</button>
                  </form>
                </td>
                <td className="small">
                  {b.payment_link ? (
                    <a href={String(b.payment_link)} target="_blank" rel="noreferrer">{tr(dict, "child.payWithInstapay")}</a>
                  ) : "—"}
                </td>
                <td className="small">
                  {/* KID-489 item 3 (KID-492): the parent's uploaded proof,
                      visible to the center admin — open the file, then keep
                      updating the invoice status through the control above.
                      KID-1177: the href resolves to a signed URL here. */}
                  {b.payment_proof_url && proofHrefs.get(String(b.payment_proof_url)) ? (
                    <div>
                      <a href={proofHrefs.get(String(b.payment_proof_url))!} target="_blank" rel="noreferrer">{tr(dict, "childBilling.viewProof")}</a>
                      {b.payment_proof_uploaded_at ? (
                        <div className="muted">{fmtDateFor(billingLocale, b.payment_proof_uploaded_at)}</div>
                      ) : null}
                      {b.payment_reference ? <div className="muted">{tr(dict, "childBilling.refLabel", { reference: String(b.payment_reference) })}</div> : null}
                    </div>
                  ) : "—"}
                </td>
                <td className="small">{fmtDateFor(billingLocale, b.created_at)}</td>
                <td>
                  <Attribution
                    locale={billingLocale}
                    createdBy={b.created_by_name ?? null}
                    createdAt={b.created_at ?? null}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}