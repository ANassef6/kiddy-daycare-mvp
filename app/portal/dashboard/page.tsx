import { requireSession } from "@/lib/require";
import { getDb } from "@/lib/db";
import {
  listChildren,
  listRooms,
  listStaff,
  listInstitutes,
  attendanceOn,
  recentReports,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export default function PortalDashboard() {
  requireSession();
  const db = getDb();
  const institutes = listInstitutes();
  const instituteId = institutes[0]?.id as string | undefined;
  if (!instituteId) {
    return <p className="muted">No institute configured. Run <code>pnpm db:init</code> to seed.</p>;
  }
  const children = listChildren(instituteId);
  const rooms = listRooms(instituteId);
  const staff = listStaff(instituteId);
  const today = new Date().toISOString().slice(0, 10);
  const attendance = attendanceOn(instituteId, today);
  const checkedInNow = attendance.filter((a) => a.last_event === "in").length;
  const openConsents = (db.prepare("SELECT COUNT(*) c FROM consent_request WHERE status='pending'").get() as any).c;
  const openIncidents = (db.prepare("SELECT COUNT(*) c FROM incident_report WHERE acknowledged=0").get() as any).c;
  const latestReport = recentReports(instituteId, 1)[0];

  return (
    <div>
      <h1 className="title">Dashboard</h1>
      <div className="grid mb-4">
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{children.length}</div><div className="muted">Children</div></div>
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{checkedInNow}</div><div className="muted">Checked in now</div></div>
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{staff.length}</div><div className="muted">Staff</div></div>
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{rooms.length}</div><div className="muted">Rooms</div></div>
      </div>

      <div className="grid mb-4">
        <div className="card">
          <h3 className="subtitle">Pending consents</h3>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{openConsents}</div>
        </div>
        <div className="card">
          <h3 className="subtitle">Incidents to acknowledge</h3>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{openIncidents}</div>
        </div>
        <div className="card">
          <h3 className="subtitle">Latest daily report</h3>
          {latestReport ? (
            <p className="small mt-1">
              <strong>{latestReport.first_name} {latestReport.last_name}</strong> —{" "}
              {new Date(String(latestReport.report_date)).toDateString()}
            </p>
          ) : (
            <p className="muted small mt-1">None yet today.</p>
          )}
        </div>
      </div>
    </div>
  );
}
