import { requireSession } from "@/lib/require";
import { reportCenterStats, staffPerformance, attendanceOn, listChildren, listRooms, recentReports } from "@/lib/store";
import { firstInstituteId, cap } from "@/lib/helpers";

export const dynamic = "force-dynamic";

export default async function PortalReportCenterPage({
  searchParams,
}: {
  searchParams: { child?: string; from?: string; to?: string; status?: string };
}) {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;

  const [stats, performance, children, rooms, dailyReports] = await Promise.all([
    reportCenterStats(instituteId),
    staffPerformance(instituteId),
    listChildren(instituteId),
    listRooms(instituteId),
    recentReports(instituteId),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const attendance = await attendanceOn(instituteId, today);
  // KID-52 #7: filtered-reports section moved here from the removed Reports
  // tab so billing/daily filters + exports live in one place.
  const q = (searchParams.child ?? "").toLowerCase();
  const filtered = (dailyReports as any[]).filter((r) => {
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
  const reportCoverage = stats.childrenCount ? `${((stats.reportsCount / stats.childrenCount) * 100).toFixed(0)}%` : "—";
  const perDay = stats.childrenCount ? Math.round(stats.reportsCount / Math.max(stats.childrenCount, 1)) : 0;

  return (
    <div>
      <h1 className="title">Report center</h1>
      <div className="subtitle">Center-wide analytics and staff performance dashboards.</div>

      <div className="card mb-4">
        <h3 className="subtitle">Quick access — downloadable reports (billing, attendance, smart lists)</h3>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <a className="btn btn-ghost small" href="/api/export?type=billing">Billing Excel (CSV)</a>
          <a className="btn btn-ghost small" href="/api/export?type=attendance">Attendance Excel (CSV)</a>
          <a className="btn btn-ghost small" href="/api/export?type=children">Children smart-list (CSV)</a>
          <a className="btn btn-ghost small" href="#filtered">Filtered reports ↓</a>
        </div>
      </div>

      <h3 className="subtitle">Center overview</h3>
      <div className="grid mb-4">
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{stats.childrenCount}</div><div className="muted">Children</div></div>
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{attendance.filter((a) => a.last_event === "in").length}</div><div className="muted">Checked in now</div></div>
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{stats.reportsCount}</div><div className="muted">Daily reports</div></div>
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{reportCoverage}</div><div className="muted">Report coverage / child</div></div>
      </div>

      <div className="grid mb-4">
        <div className="card"><div style={{ fontSize: 24, fontWeight: 700 }}>{stats.checkInsCount}</div><div className="muted">Total check-ins (all time)</div></div>
        <div className="card"><div style={{ fontSize: 24, fontWeight: 700 }}>{stats.observationCount}</div><div className="muted">Learning observations</div></div>
        <div className="card"><div style={{ fontSize: 24, fontWeight: 700 }}>{stats.newsfeedCount}</div><div className="muted">Newsfeed posts</div></div>
        <div className="card"><div style={{ fontSize: 24, fontWeight: 700 }}>{stats.mediaCount}</div><div className="muted">Photos &amp; videos</div></div>
        <div className="card"><div style={{ fontSize: 24, fontWeight: 700 }}>{stats.incidentCount}</div><div className="muted">Incident reports</div></div>
        <div className="card"><div style={{ fontSize: 24, fontWeight: 700 }}>{stats.consentsAnswered}</div><div className="muted">Consents answered</div></div>
      </div>

      <div className="card mb-4">
        <h3 className="subtitle">Rooms</h3>
        <table className="data">
          <thead><tr><th>Room</th><th>Capacity</th><th>Enrolled</th><th>Per-child daily reports</th></tr></thead>
          <tbody>
            {rooms.map((r: any) => {
              const enrolled = children.filter((c: any) => c.room_id === r.id).length;
              return (
                <tr key={r.id}>
                  <td>{r.name}</td><td>{r.capacity ?? "—"}</td><td>{enrolled}</td><td>{enrolled ? Math.round((stats.reportsCount * enrolled) / Math.max(stats.childrenCount, 1)) : 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 className="subtitle">Staff performance</h3>
        <table className="data">
          <thead><tr><th>Staff</th><th>Role</th><th>Reports authored</th><th>Check-ins</th><th>Incidents logged</th><th>Observations</th></tr></thead>
          <tbody>
            {performance.map((p: any) => (
              <tr key={p.account_id}>
                <td>{p.name}</td><td>{cap(p.role)}</td>
                <td><strong>{p.reports_authored}</strong></td>
                <td>{p.check_ins}</td>
                <td>{p.incidents_logged}</td>
                <td>{p.observations}</td>
              </tr>
            ))}
            {performance.length === 0 && <tr><td colSpan={6} className="muted">No staff accounts yet.</td></tr>}
          </tbody>
        </table>
        <p className="muted small mt-3">Per-day report pace across center: {perDay} report(s) per child recorded to date.</p>
      </div>

      <div className="card mt-4" id="filtered">
        <h3 className="subtitle">Filtered reports — billing section (filter by child, time frame, invoice status)</h3>
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

      <div className="card mt-4">
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