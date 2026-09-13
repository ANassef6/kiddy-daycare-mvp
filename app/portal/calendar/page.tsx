import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listEvents } from "@/lib/store";
import { firstInstituteId, cap, fmtDate, fmtTime } from "@/lib/helpers";

export const dynamic = "force-dynamic";

export default async function PortalCalendarPage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const events = await listEvents(instituteId, true);

  return (
    <div>
      <h1 className="title">Calendar</h1>
      <p className="subtitle">Upcoming center events and field trips. Manage media and add events from the
        <Link href="/portal/events" className="small" style={{ fontWeight: 600, marginLeft: 4 }}>Events &amp; video</Link> page.</p>

      {events.length === 0 && (
        <div className="card">
          <p className="muted small">No upcoming events scheduled yet.</p>
        </div>
      )}

      {events.map((e: any) => (
        <div className="card mb-4" key={e.id}>
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{e.title}</div>
            <span className="badge">{cap(e.event_date)}</span>
          </div>
          <div className="muted small mt-1">
            {fmtDate(e.event_date)}
            {e.start_time ? <> · {fmtTime(e.start_time)}{e.end_time ? ` – ${fmtTime(e.end_time)}` : ""}</> : null}
            {e.location ? <> · 📍 {e.location}</> : null}
          </div>
          {e.description && <p className="small mt-2">{e.description}</p>}
        </div>
      ))}
    </div>
  );
}