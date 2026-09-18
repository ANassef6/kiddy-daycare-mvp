import { requireSession } from "@/lib/require";
import { listInstitutes, recentReports, listChildren } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function PortalReportsPage({
  searchParams,
}: {
  searchParams: { child?: string; from?: string; to?: string; status?: string };
}) {
  requireSession();
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const [reports, children] = await Promise.all([
    iid ? recentReports(iid) : Promise.resolve([]),
    iid ? listChildren(iid) : Promise.resolve([]),
  ]);
  const q = (searchParams.child ?? "").toLowerCase();
  const filtered = (reports as any[]).filter((r) => {
    if (q && !`${r.first_name} ${r.last_name}`.toLowerCase().includes(q)) return false;
    if (searchParams.from && String(r.report_date) < searchParams.from) return false;
    if (searchParams.to && String(r.report_date) > searchParams.to) return false;
    if (searchParams.status === "sick" && !r.sick) return false;
    return true;
  });
  const qs = new URLSearchParams({
    child: searchParams.child ?? "",
    from: searchParams.from ?? "",
    to: searchParams.to ?? "",
    status: searchParams.status ?? "",
  }).toString();

  return (
    <div>
      <h1 className="title">Reports</h1>
      <p className="subtitle">Sections with filters. Downloads are Excel-compatible CSV.</p>

      <div className="card mb-4">
        <h3 className="subtitle">Billing section — filter by child, time frame, invoice status</h3>
        <form method="get" className="row">
          <div className="col field"><label className="label">Child name</label><input className="input" name="child" defaultValue={searchParams.child ?? ""} placeholder="e.g. Ella" /></div>
          <div className="col field"><label className="label">From</label><input className="input" type="date" name="from" defaultValue={searchParams.from ?? ""} /></div>
          <div className="col field"><label className="label">To</label><input className="input" type="date" name="to" defaultValue={searchParams.to ?? ""} /></div>
          <div className="col field"><label className="label">Status</label><select className="select" name="status" defaultValue={searchParams.status ?? ""}><option value="">Any</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="sick">Sick (daily)</option></select></div>
          <div className="field" style={{ alignSelf: "flex-end" }}><button className="btn btn-primary" type="submit">Run filter</button></div>
        </form>
        <div className="row mt-2" style={{ gap: 8 }}>
          <a className="btn btn-ghost small" href={`/api/export?type=billing&${qs}`}>Download billing Excel (CSV)</a>
          <a className="btn btn-ghost small" href="/api/export?type=attendance">Download attendance Excel (CSV)</a>
        </div>
      </div>

      <div className="card mb-4">
        <h3 className="subtitle">Daily reports section</h3>
        <table className="data">
          <thead><tr><th>Date</th><th>Child</th><th>Mood</th><th>Summary</th><th>Sick</th></tr></thead>
          <tbody>
            {filtered.map((r: any) => (
              <tr key={r.id}>
                <td className="small">{new Date(String(r.report_date)).toDateString()}</td>
                <td><strong>{r.first_name} {r.last_name}</strong></td>
                <td>{capital(r.mood)}</td>
                <td className="small" style={{ maxWidth: 340 }}>{r.summary || "—"}</td>
                <td>{r.sick ? <span className="badge badge-red">Sick</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="muted mt-3">No reports match these filters.</p>}
        <p className="muted small mt-2">{children.length} children in scope.</p>
      </div>
    </div>
  );
}
function capital(s: unknown) { const v = String(s ?? ""); if (!v) return "—"; return v.charAt(0).toUpperCase() + v.slice(1); }
