import { requireSession } from "@/lib/require";
import { listInstitutes, attendanceOn, runAutoCheckoutSweep } from "@/lib/store";
import { AttendanceCheckIn } from "@/components/AttendanceCheckIn";

export const dynamic = "force-dynamic";

export default async function PortalAttendancePage({
  searchParams,
}: {
  searchParams: { day?: string; sweep?: string };
}) {
  requireSession();
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const day = searchParams.day ?? new Date().toISOString().slice(0, 10);
  // Auto check-out sweep: anyone still checked-in 3h after closing gets
  // checked out by the system before attendance is rendered.
  const sweep = iid ? await runAutoCheckoutSweep(iid) : undefined;
  const rows = iid ? await attendanceOn(iid, day) : [];

  return (
    <div>
      <h1 className="title">Today&apos;s attendance</h1>
      <p className="subtitle">
        Viewing {new Date(day).toDateString()} — who is here and who has checked out.
      </p>
      {searchParams.sweep === "1" && (
        <p className="small" style={{ color: "#047857", fontWeight: 600 }}>
          Sweep complete — {(sweep?.children.length ?? 0) + (sweep?.staff.length ?? 0)} checked out
          automatically ({sweep?.children.length ?? 0} child, {sweep?.staff.length ?? 0} staff).
        </p>
      )}
      {sweep && (sweep.children.length > 0 || sweep.staff.length > 0) && (
        <p className="small muted">
          Auto check-out run at {new Date(sweep.at).toLocaleTimeString()}:{" "}
          {sweep.children.map((c: any) => `${c.first_name} ${c.last_name}`).join(", ")}
          {sweep.children.length > 0 && sweep.staff.length > 0 ? " — " : ""}
          {sweep.staff.map((s: any) => `${s.full_name}`).join(", ")}
          {sweep.staff.length > 0 ? " (staff)" : ""} checked out by the system after closing +3h.
        </p>
      )}
      <table className="data">
        <thead>
          <tr><th>Child</th><th>Room</th><th>Status</th><th>Checked in</th><th>Checked out</th><th>Action</th></tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id}>
              <td><strong>{r.first_name} {r.last_name}</strong></td>
              <td>{r.room_name ?? "—"}</td>
              <td>
                {r.last_event === "in" ? <span className="badge badge-green">Checked in</span>
                : r.last_event === "out" ? <span className="badge badge-gray">Checked out</span>
                : <span className="badge">Absent</span>}
              </td>
              <td className="small">{time(r.checked_in_at)}</td>
              <td className="small">{time(r.checked_out_at)}</td>
              <td>
                <AttendanceCheckIn childId={r.id as string} lastEvent={r.last_event} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function time(v?: unknown) {
  if (!v) return "—";
  return new Date(String(v)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
