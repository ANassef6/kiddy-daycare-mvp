import Link from "next/link";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { requireSession } from "@/lib/require";
import {attendanceOn, runAutoCheckoutSweep, scopedRoomIds, listRooms, busStatusByChild } from "@/lib/store";
import { AttendanceCheckIn } from "@/components/AttendanceCheckIn";
import { BusStatusButtons } from "@/components/BusStatusButtons";
import { recordToolUsage } from "@/lib/tool-usage";

export const dynamic = "force-dynamic";

export default async function PortalAttendancePage(
  props: {
    searchParams: Promise<{ day?: string; sweep?: string; q?: string; room?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const iid = await resolveTenantInstituteId();
  await recordToolUsage({ instituteId: String(iid ?? "") || null, accountId: session.accountId, toolKey: "attendance", source: "portal", metadata: null });
  const day = searchParams.day ?? new Date().toISOString().slice(0, 10);
  const q = searchParams.q ?? "";
  const roomId = searchParams.room ?? "";

  // Auto check-out sweep: anyone still checked-in 3h after closing gets
  // checked out by the system before attendance is rendered. KID-494: the
  // same sweep also auto-sets off-bus (close +2h) for children staff left on.
  const sweep = iid ? await runAutoCheckoutSweep(iid) : undefined;

  // Resolve the rooms this account may see.
  const allowedRoomIds = iid ? await scopedRoomIds(iid, session.accountId) : null;
  const allRooms = iid ? await listRooms(iid) : [];
  const visibleRooms =
    allowedRoomIds === null
      ? allRooms
      : allRooms.filter((r) => allowedRoomIds.includes(String(r.id)));

  // Validate the requested room filter is within scope.
  const effectiveRoomId =
    roomId && (allowedRoomIds === null || allowedRoomIds.includes(roomId)) ? roomId : "";

  const rows = iid
    ? await attendanceOn(iid, day, {
        accountId: session.accountId,
        roomId: effectiveRoomId || undefined,
        search: q || undefined,
      })
    : [];

  // KID-494: the current bus status per child, served in one indexed query.
  const busByChild = iid ? await busStatusByChild(iid, day) : {};

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
      {sweep && (sweep.children.length > 0 || sweep.staff.length > 0 || sweep.busOff.length > 0) && (
        <p className="small muted">
          Auto check-out run at {new Date(sweep.at).toLocaleTimeString()}:{" "}
          {sweep.children.map((c: any) => `${c.first_name} ${c.last_name}`).join(", ")}
          {sweep.children.length > 0 && sweep.staff.length > 0 ? " — " : ""}
          {sweep.staff.map((s: any) => `${s.full_name}`).join(", ")}
          {sweep.staff.length > 0 ? " (staff)" : ""} checked out by the system after closing +3h.
          {sweep.busOff.length > 0 && (
            <>
              {" "}Bus auto-off (closing +2h):{" "}
              {sweep.busOff.map((c: any) => `${c.first_name} ${c.last_name}`).join(", ")} — parents notified.
            </>
          )}
        </p>
      )}

      <form className="card mb-4" method="get">
        <input type="hidden" name="day" value={day} />
        <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <div className="col field" style={{ minWidth: 180 }}>
            <label className="label">Search by name</label>
            <input className="input" name="q" defaultValue={q} placeholder="e.g. Omar" />
          </div>
          <div className="col field" style={{ minWidth: 180 }}>
            <label className="label">Room</label>
            <select className="select" name="room" defaultValue={effectiveRoomId}>
              <option value="">All rooms</option>
              {visibleRooms.map((r: any) => (
                <option key={r.id} value={String(r.id)}>{String(r.name)}</option>
              ))}
            </select>
          </div>
          <div>
            <button className="btn btn-ghost" type="submit">Filter</button>
          </div>
          {(q || effectiveRoomId) && (
            <Link href="/portal/attendance" className="btn btn-ghost">Clear</Link>
          )}
        </div>
      </form>

      <table className="data">
        <thead>
          <tr>
            <th>Child</th>
            <th>Room</th>
            <th>Status</th>
            <th>Bus</th>
            <th>Checked in</th>
            <th>Checked out</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => {
            const bus = busByChild[String(r.id)];
            return (
              <tr key={r.id}>
                <td><strong>{r.first_name} {r.last_name}</strong></td>
                <td>{r.room_name ?? "—"}</td>
                <td>
                  {r.last_event === "in" ? <span className="badge badge-green">Checked in</span>
                  : r.last_event === "out" ? <span className="badge badge-gray">Checked out</span>
                  : <span className="badge">Absent</span>}
                </td>
                <td>
                  {bus?.type === "on" ? <span className="badge badge-green">On bus</span>
                  : bus?.type === "off" ? <span className="badge badge-gray">Off bus</span>
                  : <span className="badge">—</span>}
                </td>
                <td className="small">{time(r.checked_in_at)}</td>
                <td className="small">{time(r.checked_out_at)}</td>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <AttendanceCheckIn childId={r.id as string} lastEvent={r.last_event} />
                    <BusStatusButtons childId={r.id as string} busEvent={bus ? { type: String(bus.type), auto: Number(bus.auto) === 1 } : undefined} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted small mt-3">No children match the current filters.</p>}
    </div>
  );
}

function time(v?: unknown) {
  if (!v) return "—";
  return new Date(String(v)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
