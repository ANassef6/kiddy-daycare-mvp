import { requireSession } from "@/lib/require";
import { listInstitutes, attendanceOn } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function PortalAttendancePage({
  searchParams,
}: {
  searchParams: { day?: string };
}) {
  requireSession();
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const day = searchParams.day ?? new Date().toISOString().slice(0, 10);
  const rows = iid ? await attendanceOn(iid, day) : [];

  return (
    <div>
      <h1 className="title">Today&apos;s attendance</h1>
      <p className="subtitle">
        Viewing {new Date(day).toDateString()} — who is here and who has checked out.
      </p>
      <table className="data">
        <thead>
          <tr><th>Child</th><th>Room</th><th>Status</th><th>Checked in</th><th>Checked out</th></tr>
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
