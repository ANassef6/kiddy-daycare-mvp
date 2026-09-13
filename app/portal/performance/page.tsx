import Link from "next/link";
import { requireSession } from "@/lib/require";
import { firstInstituteId } from "@/lib/helpers";

export const dynamic = "force-dynamic";

export default async function PortalPerformancePage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;

  return (
    <div>
      <h1 className="title">Performance</h1>
      <div className="subtitle">Attendance, development, and billing health at a glance — full exports live in the report center.</div>
      <div className="grid">
        <a className="card" href="/portal/report-center" style={{ textDecoration: "none", color: "inherit" }}>
          <div style={{ fontWeight: 700 }}>Report center</div>
          <div className="muted small mt-1">Generate and export reports across the center.</div>
        </a>
        <a className="card" href="/portal/children/development" style={{ textDecoration: "none", color: "inherit" }}>
          <div style={{ fontWeight: 700 }}>Development tracking</div>
          <div className="muted small mt-1">Review each child&apos;s learning milestones and goals.</div>
        </a>
        <a className="card" href="/portal/attendance" style={{ textDecoration: "none", color: "inherit" }}>
          <div style={{ fontWeight: 700 }}>Attendance</div>
          <div className="muted small mt-1">Today&apos;s check-ins and the attendance register.</div>
        </a>
      </div>
    </div>
  );
}