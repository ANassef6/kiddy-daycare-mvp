import { requireSession } from "@/lib/require";
import { reportCenterStats, staffPerformance, attendanceOn, listChildren, listRooms } from "@/lib/store";
import { firstInstituteId, cap } from "@/lib/helpers";

export const dynamic = "force-dynamic";

export default async function PortalReportCenterPage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;

  const [stats, performance, children, rooms] = await Promise.all([
    reportCenterStats(instituteId),
    staffPerformance(instituteId),
    listChildren(instituteId),
    listRooms(instituteId),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const attendance = await attendanceOn(instituteId, today);
  const reportCoverage = stats.childrenCount ? `${((stats.reportsCount / stats.childrenCount) * 100).toFixed(0)}%` : "—";
  const perDay = stats.childrenCount ? Math.round(stats.reportsCount / Math.max(stats.childrenCount, 1)) : 0;

  return (
    <div>
      <h1 className="title">Report center</h1>
      <div className="subtitle">Center-wide analytics and staff performance dashboards.</div>

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
    </div>
  );
}