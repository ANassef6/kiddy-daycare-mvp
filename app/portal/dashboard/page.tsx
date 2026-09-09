import Link from "next/link";
import { requireSession } from "@/lib/require";
import { queryGet } from "@/lib/db";
import {
  listChildren,
  listRooms,
  listStaff,
  listInstitutes,
  checkedInNow,
  recentReports,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function PortalDashboard() {
  requireSession();
  const institutes = await listInstitutes();
  const instituteId = institutes[0]?.id as string | undefined;
  if (!instituteId) {
    return <p className="muted">No institute configured. Run <code>pnpm db:init</code> to seed.</p>;
  }
  const [children, rooms, staff, checkedIn] = await Promise.all([
    listChildren(instituteId),
    listRooms(instituteId),
    listStaff(instituteId),
    checkedInNow(instituteId),
  ]);
  const [consentCount, incidentCount] = await Promise.all([
    queryGet("SELECT COUNT(*) c FROM consent_request WHERE status='pending'"),
    queryGet("SELECT COUNT(*) c FROM incident_report WHERE acknowledged=0"),
  ]);
  const openConsents = ((consentCount as any)?.c as number) ?? 0;
  const openIncidents = ((incidentCount as any)?.c as number) ?? 0;
  const reports = await recentReports(instituteId, 1);
  const latestReport = reports[0];

  return (
    <div>
      <h1 className="title">Dashboard</h1>
      <div className="grid mb-4">
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{children.length}</div><div className="muted">Children</div></div>
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{checkedIn.length}</div><div className="muted">Checked in now</div></div>
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{staff.length}</div><div className="muted">Staff</div></div>
        <div className="card"><div style={{ fontSize: 28, fontWeight: 800 }}>{rooms.length}</div><div className="muted">Rooms</div></div>
      </div>

      <div className="grid mb-4">
        <div className="card">
          <h3 className="subtitle">Checked in right now</h3>
          {checkedIn.length === 0 ? (
            <p className="muted small">Nobody checked in yet today.</p>
          ) : (
            checkedIn.map((c: any) => (
              <div className="list-item" key={c.id}>
                <Link href={`/portal/children/${c.id}`} style={{ fontWeight: 600 }}>
                  {c.first_name} {c.last_name}
                </Link>
                <span className="small muted">
                  {c.room_name ?? "No room"} · {time(c.checked_in_at)}
                </span>
              </div>
            ))
          )}
          <Link className="small mt-2" href="/portal/attendance">View full attendance →</Link>
        </div>
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

function time(v?: unknown) {
  if (!v) return "—";
  return new Date(String(v)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}