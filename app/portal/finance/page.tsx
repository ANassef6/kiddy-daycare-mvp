import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listInstituteBilling } from "@/lib/store";
import { firstInstituteId, cap } from "@/lib/helpers";
import { updateBillingStatusAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

const TAB_IDS = ["invoices", "payers", "payouts", "payments", "deposits", "schedules", "reports"] as const;
const STATUS_KEYS = ["paid", "outstanding", "due", "past-due", "cancelled", "partially-paid", "in-process"] as const;

function money(v: unknown, currency?: string | null): string {
  return `${currency ?? "AED"} ${Number(v ?? 0).toFixed(2)}`;
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
export default async function PortalFinancePage({
  searchParams,
}: {
  searchParams?: { tab?: string; q?: string; status?: string; to?: string; from?: string };
}) {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
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

  const STATUS_LABEL: Record<string, string> = {
    paid: "Paid",
    outstanding: "Outstanding",
    due: "Due",
    "past-due": "Past Due",
    cancelled: "Cancelled",
    "partially-paid": "Partially Paid",
    "in-process": "Payment in process",
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
    const name = String(raw || `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unknown");
    payerTotals.set(name, (payerTotals.get(name) ?? 0) + amountValue(r));
  }

  return (
    <div>
      <h1 className="title">Finance</h1>
      <p className="subtitle">Billing, payers, and payouts for the whole center. Amounts shown in AED.</p>

      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 16, borderBottom: "2px solid var(--color-border)", marginLeft: 0, marginRight: 0 }}>
        {TAB_IDS.map((t) => (
          <Link
            key={t}
            href={`/portal/finance?tab=${t}`}
            className={`btn ${tab === t ? "btn-primary" : "btn-ghost"} small`}
            style={{ textDecoration: "none", borderRadius: 0, borderBottom: tab === t ? "3px solid var(--brand-primary)" : "3px solid transparent" }}
          >
            {cap(t)}
          </Link>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        {STATUS_KEYS.map((k) => {
          const n = grouped[k].length;
          return (
            <div className={`card${n === 0 ? " muted" : ""}`} key={k} style={{ textAlign: "center", padding: "12px 10px" }}>
              <div className="muted small">{STATUS_LABEL[k]}</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{n}</div>
              <div className="small">{money(totals[k], "AED")}</div>
            </div>
          );
        })}
      </div>
      <div className="small muted mt-2">
        Outstanding balance: <strong>{money(outstandingTotal, "AED")}</strong> · All invoices: <strong>{money(allTotal, "AED")}</strong>. “Due” and “Payment in process” have no live records yet — mapped from pending/approved where applicable.
      </div>

      {tab === "invoices" && (
        <div className="card mt-4">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <form method="get" className="row" style={{ gap: 8 }}>
                <input type="hidden" name="tab" value="invoices" />
                <input className="input" name="q" defaultValue={searchParams?.q ?? ""} placeholder="Search invoice, child, payer…" style={{ minWidth: 220 }} />
                <select className="select" name="status" defaultValue={statusFilter} style={{ maxWidth: 150 }}>
                  <option value="">All statuses</option>
                  {STATUS_KEYS.map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
                </select>
                <button className="btn btn-ghost small" type="submit">Apply</button>
              </form>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Link className="btn btn-ghost small" href={`/api/export?type=billing&status=${statusFilter}`}>Export</Link>
              <Link className="btn btn-primary small" href="/portal/children">Bulk invoice</Link>
            </div>
          </div>

          <table className="data mt-3">
            <thead>
              <tr>
                <th>Trans. Ref</th><th>Child</th><th>Payer</th><th>Due date</th><th>Inv. period</th>
                <th>Status</th><th>Discounts</th><th>Fundings</th><th>Gross</th><th>Total</th><th>Payments</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={12} className="muted small">No invoices match.</td></tr>}
              {rows.map((b: any) => (
                <tr key={b.id}>
                  <td className="small">{b.reference ?? String(b.id).slice(0, 8)}</td>
                  <td><Link href={`/portal/children/${b.child_id}`} style={{ color: "inherit", fontWeight: 700 }}>{b.first_name} {b.last_name}</Link></td>
                  <td className="small">{b.payer ?? "—"}</td>
                  <td className="small">{b.due_date ?? "—"}</td>
                  <td className="small">{b.period ?? "—"}</td>
                  <td><span className={`badge ${STATUS_TONE[statusOf(b)]}`}>{STATUS_LABEL[statusOf(b)]}</span></td>
                  <td className="small">{b.discount ? money(Number(b.discount) / 100, "AED") : "—"}</td>
                  <td className="small">—</td>
                  <td className="small">{money(amountValue(b), "AED")}</td>
                  <td className="small"><strong>{money(amountValue(b), "AED")}</strong></td>
                  <td className="small">—</td>
                  <td>
                    <form action={updateBillingStatusAction} className="row" style={{ gap: 6, alignItems: "center" }}>
                      <input type="hidden" name="billingId" value={String(b.id)} />
                      <input type="hidden" name="childId" value={String(b.child_id)} />
                      <select className="select small" name="status" defaultValue={String(b.status ?? "pending")} style={{ maxWidth: 110 }}>
                        <option value="pending">Pending</option>
                        <option value="paid">Paid</option>
                        <option value="overdue">Overdue</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                      <button className="btn btn-ghost small" type="submit">Set</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "payers" && (
        <div className="card mt-4">
          <h3 className="subtitle">Payers</h3>
          {payerTotals.size === 0 && <p className="muted small">No payers yet.</p>}
          <table className="data">
            <thead><tr><th>Payer</th><th>Outstanding invoices</th><th>Total billed</th></tr></thead>
            <tbody>
              {Array.from(payerTotals.entries()).map(([name, total]) => (
                <tr key={name}>
                  <td><strong>{name}</strong></td>
                  <td className="small">{bills.filter((b) => (b.payer ?? "") === name && statusOf(b) !== "paid" && statusOf(b) !== "cancelled").length}</td>
                  <td className="small">{money(total, "AED")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {["payouts", "payments", "deposits", "schedules"].includes(tab) && (
        <div className="card mt-4">
          <h3 className="subtitle">{cap(tab)}</h3>
          <p className="muted small">
            {cap(tab)} records are not part of the current billing data model yet. This tab is on screen per the design; it will light up once payouts, payment logs, and deposit schedules land in the billing module.
          </p>
        </div>
      )}

      {tab === "reports" && (
        <div className="card mt-4">
          <h3 className="subtitle">Finance reports</h3>
          <div className="grid">
            <a className="card" href="/portal/report-center" style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ fontWeight: 700 }}>Report center</div>
              <div className="muted small mt-1">Billing and attendance exports live here.</div>
            </a>
            <a className="card" href="/api/export?type=billing" style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ fontWeight: 700 }}>Billing CSV</div>
              <div className="muted small mt-1">Download every invoice as a spreadsheet.</div>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}