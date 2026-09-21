import Link from "next/link";
import { requireSession } from "@/lib/require";
import { queryGet } from "@/lib/db";
import {
  listChildren,
  listRoomsScoped,
  listStaff,
  listInstitutes,
  checkedInNow,
  recentReports,
  listContactRequests,
  runAutoCheckoutSweep,
} from "@/lib/store";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalDashboard() {
  const session = requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const institutes = await listInstitutes();
  const instituteId = institutes[0]?.id as string | undefined;
  if (!instituteId) {
    return (
      <p className="muted">
        {tr(dict, "dashboard.noInstitute", { cmd: "pnpm db:init" })}
      </p>
    );
  }
  // KID-58: auto check-out sweep also fires when the portal loads so nobody
  // stays checked-in past closing +3h even if a scheduler never runs.
  await runAutoCheckoutSweep(instituteId);
  // KID-103: dashboard cards reflect only the account's assigned classrooms.
  const [children, rooms, staff, checkedIn] = await Promise.all([
    listChildren(instituteId, { accountId: session.accountId }),
    listRoomsScoped(instituteId, session.accountId),
    listStaff(instituteId),
    checkedInNow(instituteId, session.accountId),
  ]);
  const [consentCount, incidentCount] = await Promise.all([
    queryGet("SELECT COUNT(*) c FROM consent_request WHERE status='pending'"),
    queryGet("SELECT COUNT(*) c FROM incident_report WHERE acknowledged=0"),
  ]);
  const inquiries = await listContactRequests(5);
  const openConsents = ((consentCount as any)?.c as number) ?? 0;
  const openIncidents = ((incidentCount as any)?.c as number) ?? 0;
  const reports = await recentReports(instituteId, 1, session.accountId);
  const latestReport = reports[0];

  return (
    <div>
      <h1 className="title">{tr(dict, "dashboard.title")}</h1>
      <div className="grid mb-4">
        <Link href="/portal/children" className="card" style={{ textDecoration: "none", color: "inherit" }}><div style={{ fontSize: 28, fontWeight: 800 }}>{children.length}</div><div className="muted">{tr(dict, "dashboard.children")}</div></Link>
        <Link href="/portal/attendance" className="card" style={{ textDecoration: "none", color: "inherit" }}><div style={{ fontSize: 28, fontWeight: 800 }}>{checkedIn.length}</div><div className="muted">{tr(dict, "dashboard.checkedInNow")}</div></Link>
        <Link href="/portal/staff" className="card" style={{ textDecoration: "none", color: "inherit" }}><div style={{ fontSize: 28, fontWeight: 800 }}>{staff.length}</div><div className="muted">{tr(dict, "dashboard.staff")}</div></Link>
        <Link href="/portal/rooms" className="card" style={{ textDecoration: "none", color: "inherit" }}><div style={{ fontSize: 28, fontWeight: 800 }}>{rooms.length}</div><div className="muted">{tr(dict, "dashboard.rooms")}</div></Link>
      </div>

      <div className="grid mb-4">
        <div className="card">
          <h3 className="subtitle">{tr(dict, "dashboard.checkedInRightNow")}</h3>
          {checkedIn.length === 0 ? (
            <p className="muted small">{tr(dict, "dashboard.noOneCheckedIn")}</p>
          ) : (
            checkedIn.map((c: any) => (
              <div className="list-item" key={c.id}>
                <Link href={`/portal/children/${c.id}`} style={{ fontWeight: 600 }}>
                  {c.first_name} {c.last_name}
                </Link>
                <span className="small muted">
                  {c.room_name ?? tr(dict, "dashboard.noRoom")} · {time(c.checked_in_at)}
                </span>
              </div>
            ))
          )}
          <Link className="small mt-2" href="/portal/attendance">{tr(dict, "dashboard.viewFullAttendance")} →</Link>
        </div>
      </div>

      <div className="grid mb-4">
        <Link href="/portal/consents" className="card" style={{ textDecoration: "none", color: "inherit" }}>
          <h3 className="subtitle">{tr(dict, "dashboard.pendingConsents")}</h3>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{openConsents}</div>
          <span className="small mt-2" style={{ fontWeight: 600 }}>{tr(dict, "dashboard.openConsents")} →</span>
        </Link>
        <Link href="/portal/incidents" className="card" style={{ textDecoration: "none", color: "inherit" }}>
          <h3 className="subtitle">{tr(dict, "dashboard.incidentsToAcknowledge")}</h3>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{openIncidents}</div>
          <span className="small mt-2" style={{ fontWeight: 600 }}>{tr(dict, "dashboard.openIncidents")} →</span>
        </Link>
        <Link href="/portal/report-center#filtered" className="card" style={{ textDecoration: "none", color: "inherit" }}>
          <h3 className="subtitle">{tr(dict, "dashboard.latestDailyReport")}</h3>
          {latestReport ? (
            <p className="small mt-1">
              <strong>{latestReport.first_name} {latestReport.last_name}</strong> —{" "}
              {new Date(String(latestReport.report_date)).toDateString()}
            </p>
          ) : (
            <p className="muted small mt-1">{tr(dict, "dashboard.noneYetToday")}</p>
          )}
          <span className="small mt-2" style={{ fontWeight: 600 }}>{tr(dict, "dashboard.openReports")} →</span>
        </Link>
      </div>

      <div className="grid mb-4">
        <div className="card">
          <h3 className="subtitle">{tr(dict, "dashboard.demoInquiries")}</h3>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{inquiries.length}</div>
          <p className="muted small mt-1">{tr(dict, "dashboard.newestSubmissions")}</p>
          <Link className="small mt-2" href="/portal/inquiries">{tr(dict, "dashboard.openInquiries")} →</Link>
        </div>
      </div>
    </div>
  );
}

function time(v?: unknown) {
  if (!v) return "—";
  return new Date(String(v)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}