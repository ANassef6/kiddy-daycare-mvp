import { requireSession } from "@/lib/require";
import { listStaff, listStaffSchedules } from "@/lib/store";
import { firstInstituteId, cap } from "@/lib/helpers";
import { createStaffScheduleAction, deleteStaffScheduleAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

const DAYS = [
  { v: 0, l: "Sunday" }, { v: 1, l: "Monday" }, { v: 2, l: "Tuesday" },
  { v: 3, l: "Wednesday" }, { v: 4, l: "Thursday" }, { v: 5, l: "Friday" }, { v: 6, l: "Saturday" },
];

export default async function PortalStaffSchedulePage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const staff = await listStaff(instituteId);
  const schedules = await Promise.all(staff.map((s: any) => listStaffSchedules(s.id)));
  const byStaff: Record<string, any[]> = {};
  staff.forEach((s: any, i: number) => { byStaff[String(s.id)] = schedules[i] as any[]; });

  return (
    <div>
      <h1 className="title">Staff schedule</h1>
      <p className="subtitle">Add, view and remove weekly shifts per staff member.</p>

      <div className="card mb-4">
        <h3 className="subtitle">Add a shift</h3>
        <form action={createStaffScheduleAction}>
          <div className="row">
            <div className="col field">
              <label className="label">Staff</label>
              <select className="select" name="staffId" required>
                {staff.map((s: any) => <option key={s.id} value={s.id}>{s.full_name} ({cap(s.role)})</option>)}
              </select>
            </div>
            <div className="col field">
              <label className="label">Day</label>
              <select className="select" name="dayOfWeek">
                {DAYS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
              </select>
            </div>
            <div className="col field"><label className="label">Start</label><input className="input" type="time" name="startTime" defaultValue="08:00" required /></div>
            <div className="col field"><label className="label">End</label><input className="input" type="time" name="endTime" defaultValue="16:00" required /></div>
          </div>
          <div className="field"><label className="label">Notes</label><input className="input" name="notes" placeholder="Room / duty…" /></div>
          <button className="btn btn-primary" type="submit">Add shift</button>
        </form>
      </div>

      {staff.map((s: any) => (
        <div className="card mb-4" key={s.id}>
          <h3 className="subtitle" style={{ marginBottom: 4 }}>{s.full_name} · {cap(s.role)}</h3>
          {(byStaff[String(s.id)] ?? []).length === 0 && <p className="muted small">No shifts yet.</p>}
          {(byStaff[String(s.id)] ?? []).map((sh: any) => (
            <div className="list-item" key={sh.id}>
              <span className="small"><strong>{DAYS[Number(sh.day_of_week)]?.l ?? sh.day_of_week}</strong> · {sh.start_time}–{sh.end_time}{sh.notes ? ` — ${sh.notes}` : ""}</span>
              <form action={deleteStaffScheduleAction}>
                <input type="hidden" name="id" value={sh.id} />
                <button className="btn btn-ghost small" type="submit">Remove</button>
              </form>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
