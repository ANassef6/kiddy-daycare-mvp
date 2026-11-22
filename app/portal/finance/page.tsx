import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listInstituteBilling, getInstitute } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { updateBillingStatusAction } from "@/lib/actions";
import { DEFAULT_CURRENCY, normalizeCurrency } from "@/lib/currency";
import { recordToolUsage } from "@/lib/tool-usage";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const TAB_IDS = ["invoices", "payers", "payouts", "payments", "deposits", "schedules", "reports"] as const;
const STATUS_KEYS = ["paid", "outstanding", "due", "past-due", "cancelled", "partially-paid", "in-process"] as const;

function money(v: unknown, currency: string): string {
  return `${currency} ${Number(v ?? 0).toFixed(2)}`;
}

function amountValue(b: any): number {
  // child_billing stores integer cents; fall back to a decimal `amount` if present.
  const direct = Number(b.amount ?? 0);
  if (direct > 0) return direct;
  return Number(b.amount_cents ?? 0) / 100;
}

// KID-53 #9: center-wide finance. Invoices are child_billing records mapped onto
// the commercial funnel's status cards. Tabs other than Invoices/Reports are
// visible (per design) but show a friendly pending-state panel since the billing
// data model doesn't cover payouts/deposits/schedules yet.
export default async function PortalFinancePage(
  props: {
    searchParams?: Promise<{ tab?: string; q?: string; status?: string; to?: string; from?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{tr(dict, "finance.noInstitute")}</p>;
  await recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "finance", source: "portal", metadata: null });
  // KID-489 item 1 (KID-490): display fallbacks follow the center's default
  // currency; each invoice row still shows its own stored currency first.
  const center = await getInstitute(instituteId);
  const centerCurrency = normalizeCurrency(center?.default_currency, DEFAULT_CURRENCY);
  const bills = await listInstituteBilling(instituteId);

  const tab = (TAB_IDS.find((t) => t === searchParams?.tab) ?? "invoices") as (typeof TAB_IDS)[number];
  const q = (searchParams?.q ?? "").toLowerCase();
  const statusFilter = searchParams?.status ?? "";

  const statusOf = (b: any): string => {
    const s = String(b.status ?? "pending");
    if (s === "paid") return "paid";
    if (s === "cancelled") return "cancelled";
    if (s === "overdue") return "past-due";
    if (s === "approved") return "partially-paid";
    return "outstanding";
  };

  const TAB_LABEL: Record<string, string> = {
    invoices: tr(dict, "finance.tabInvoices"),
    payers: tr(dict, "finance.tabPayers"),
    payouts: tr(dict, "finance.tabPayouts"),
    payments: tr(dict, "finance.tabPayments"),
    deposits: tr(dict, "finance.tabDeposits"),
    schedules: tr(dict, "finance.tabSchedules"),
    reports: tr(dict, "finance.tabReports"),
  };
  const STATUS_LABEL: Record<string, string> = {
    paid: tr(dict, "finance.statusPaid"),
    outstanding: tr(dict, "finance.statusOutstanding"),
    due: tr(dict, "finance.statusDue"),
    "past-due": tr(dict, "finance.statusPastDue"),
    cancelled: tr(dict, "finance.statusCancelled"),
    "partially-paid": tr(dict, "finance.statusPartiallyPaid"),
    "in-process": tr(dict, "finance.statusInProcess"),
  };
  const STATUS_TONE: Record<string, string> = {
    paid: "badge-green",
    outstanding: "badge-gray",
    due: "badge",
    "past-due": "badge-red",
    cancelled: "badge-gray",
    "partially-paid": "badge badge-accent",
    "in-process": "badge badge-accent",
  };

  const grouped: Record<string, any[]> = {};
  for (const k of STATUS_KEYS) grouped[k] = [];
  for (const b of bills) {
    grouped[statusOf(b)].push(b);
  }
  const totals: Record<string, number> = {};
  for (const [k, rows] of Object.entries(grouped)) {
    totals[k] = rows.reduce((s, r) => s + amountValue(r), 0);
  }
  const allTotal = bills.reduce((s, r) => s + amountValue(r), 0);
  const outstandingTotal = ["outstanding", "due", "past-due", "partially-paid", "in-process"].reduce((s, k) => s + (totals[k] ?? 0), 0);

  let rows = bills;
  if (q) {
    rows = rows.filter(
      (r) =>
        `${r.first_name} ${r.last_name} ${r.payer ?? ""} ${r.reference ?? r.id} ${r.period ?? ""}`.toLowerCase().includes(q)
    );
  }
  if (statusFilter) rows = rows.filter((r) => statusOf(r) === statusFilter);

  const payerTotals = new Map<string, number>();
  for (const r of bills) {
    const raw = r.payer;
    const name = String(raw || `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || tr(dict, "profile.unknown"));
    payerTotals.set(name, (payerTotals.get(name) ?? 0) + amountValue(r));
  }

  return (
    <div>
      <h1 className="title">{tr(dict, "nav.finance")}</h1>
      <p className="subtitle">{tr(dict, "finance.subtitle", { currency: centerCurrency })}</p>

      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 16, borderBottom: "2px solid var(--color-border)" }}>
        {TAB_IDS.map((t) => (
          <Link
            key={t}
            href={`/portal/finance?tab=${t}`}
            className={`btn ${tab === t ? "btn-primary" : "btn-ghost"} small`}
            style={{ textDecoration: "none", borderRadius: 0, borderBottom: tab === t ? "3px solid var(--brand-primary)" : "3px solid transparent" }}
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        {STATUS_KEYS.map((k) => {
          const n = grouped[k].length;
          // KID-86 #12: every status card is a clickable filter — clicking the
          // active one clears it and shows all invoices again.
          const selected = statusFilter === k;
          const href = selected ? `/portal/finance?tab=${tab}` : `/portal/finance?tab=${tab}&status=${k}`;
          return (
            <Link
              key={k}
              href={href}
              aria-pressed={selected}
              className={`card${selected ? " active" : ""}`}
              style={{
                textAlign: "center",
                padding: "12px 10px",
                textDecoration: "none",
                color: "inherit",
                border: selected ? "2px solid var(--brand-primary)" : undefined,
                boxShadow: selected ? "0 0 0 3px color-mix(in srgb, var(--brand-primary) 15%, transparent)" : undefined,
              }}
            >
              <div className="muted small">{STATUS_LABEL[k]}{selected ? " ✓" : ""}</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{n}</div>
              <div className="small">{money(totals[k], centerCurrency)}</div>
            </Link>
          );
        })}
      </div>
      <div className="small muted mt-2">
        {tr(dict, "finance.totalsSummary", { outstanding: money(outstandingTotal, centerCurrency), all: money(allTotal, centerCurrency) })}
      </div>

      {tab === "invoices" && (
        <div className="card mt-4">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <form method="get" className="row" style={{ gap: 8 }}>
                <input type="hidden" name="tab" value="invoices" />
                <input className="input" name="q" defaultValue={searchParams?.q ?? ""} placeholder={tr(dict, "finance.searchPlaceholder")} style={{ minWidth: 220 }} />
                <select className="select" name="status" defaultValue={statusFilter} style={{ maxWidth: 150 }}>
                  <option value="">{tr(dict, "finance.allStatuses")}</option>
                  {STATUS_KEYS.map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
                </select>
                <button className="btn btn-ghost small" type="submit">{tr(dict, "finance.apply")}</button>
              </form>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Link className="btn btn-ghost small" href={`/api/export?type=billing&status=${statusFilter}`}>{tr(dict, "finance.export")}</Link>
              <Link className="btn btn-primary small" href="/portal/children">{tr(dict, "finance.bulkInvoice")}</Link>
            </div>
          </div>

          <div className="table-scroll mt-3">
          <table className="data">
            <thead>
              <tr>
                <th>{tr(dict, "finance.colRef")}</th><th>{tr(dict, "common.child")}</th><th>{tr(dict, "finance.colPayer")}</th><th>{tr(dict, "accountBilling.colDue")}</th><th>{tr(dict, "finance.colPeriod")}</th>
                <th>{tr(dict, "common.status")}</th><th>{tr(dict, "finance.colDiscounts")}</th><th>{tr(dict, "finance.colFundings")}</th><th>{tr(dict, "finance.colGross")}</th><th>{tr(dict, "finance.colTotal")}</th><th>{tr(dict, "finance.colPayments")}</th><th>{tr(dict, "common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={12} className="muted small">{tr(dict, "finance.empty")}</td></tr>}
              {rows.map((b: any) => (
                <tr key={b.id}>
                  <td className="small">{b.reference ?? String(b.id).slice(0, 8)}</td>
                  <td><Link href={`/portal/children/${b.child_id}`} style={{ color: "inherit", fontWeight: 700 }}>{b.first_name} {b.last_name}</Link></td>
                  <td className="small">{b.payer ?? "—"}</td>
                  <td className="small">{b.due_date ?? "—"}</td>
                  <td className="small">{b.period ?? "—"}</td>
                  <td><span className={`badge ${STATUS_TONE[statusOf(b)]}`}>{STATUS_LABEL[statusOf(b)]}</span></td>
                  <td className="small">{b.discount ? money(Number(b.discount) / 100, String(b.currency ?? centerCurrency)) : "—"}</td>
                  <td className="small">—</td>
                  <td className="small">{money(amountValue(b), String(b.currency ?? centerCurrency))}</td>
                  <td className="small"><strong>{money(amountValue(b), String(b.currency ?? centerCurrency))}</strong></td>
                  <td className="small">—</td>
                  <td>
                    <form action={updateBillingStatusAction} className="row" style={{ gap: 6, alignItems: "center" }}>
                      <input type="hidden" name="billingId" value={String(b.id)} />
                      <input type="hidden" name="childId" value={String(b.child_id)} />
                      <select className="select small" name="status" defaultValue={String(b.status ?? "pending")} style={{ maxWidth: 110 }}>
                        <option value="pending">{tr(dict, "finance.rowPending")}</option>
                        <option value="paid">{tr(dict, "finance.rowPaid")}</option>
                        <option value="overdue">{tr(dict, "finance.rowOverdue")}</option>
                        <option value="cancelled">{tr(dict, "finance.rowCancelled")}</option>
                      </select>
                      <button className="btn btn-ghost small" type="submit">{tr(dict, "finance.set")}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {tab === "payers" && (
        <div className="card mt-4">
          <h3 className="subtitle">{tr(dict, "finance.tabPayers")}</h3>
          {payerTotals.size === 0 && <p className="muted small">{tr(dict, "finance.emptyPayers")}</p>}
          <table className="data">
            <thead><tr><th>{tr(dict, "finance.colPayer")}</th><th>{tr(dict, "finance.colOutstandingInvoices")}</th><th>{tr(dict, "finance.colTotalBilled")}</th></tr></thead>
            <tbody>
              {Array.from(payerTotals.entries()).map(([name, total]) => (
                <tr key={name}>
                  <td><strong>{name}</strong></td>
                  <td className="small">{bills.filter((b) => (b.payer ?? "") === name && statusOf(b) !== "paid" && statusOf(b) !== "cancelled").length}</td>
                  <td className="small">{money(total, centerCurrency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {["payouts", "payments", "deposits", "schedules"].includes(tab) && (
        <div className="card mt-4">
          <h3 className="subtitle">{TAB_LABEL[tab]}</h3>
          <p className="muted small">
            {tr(dict, "finance.pendingTabNote", { tab: TAB_LABEL[tab] })}
          </p>
        </div>
      )}

      {tab === "reports" && (
        <div className="card mt-4">
          <h3 className="subtitle">{tr(dict, "finance.reportsTitle")}</h3>
          <div className="grid">
            <a className="card" href="/portal/report-center" style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ fontWeight: 700 }}>{tr(dict, "nav.reportCenter")}</div>
              <div className="muted small mt-1">{tr(dict, "finance.reportCenterHint")}</div>
            </a>
            <a className="card" href="/api/export?type=billing" style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ fontWeight: 700 }}>{tr(dict, "finance.billingCsv")}</div>
              <div className="muted small mt-1">{tr(dict, "finance.billingCsvHint")}</div>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}