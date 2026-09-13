import { requireSession } from "@/lib/require";
import { listStaff, listRooms, staffRooms } from "@/lib/store";
import { firstInstituteId, cap } from "@/lib/helpers";

export const dynamic = "force-dynamic";

export default async function PortalStaffSchedulePage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const [staff, rooms] = await Promise.all([
    listStaff(instituteId),
    listRooms(instituteId),
  ]);
  const roomAccess = await Promise.all(staff.map((s: any) => staffRooms(s.id)));
  const roomByStaff = Object.fromEntries(roomAccess.map((r, i) => [staff[i].id, r]));

  return (
    <div>
      <h1 className="title">Staff schedule</h1>
      <p className="subtitle">
        Weekly room assignments at a glance. Room roster and attendance are managed on the
        <span className="small" style={{ fontWeight: 600 }}> Reports</span> page.
      </p>

      <table className="data">
        <thead>
          <tr><th>Staff</th><th>Role</th><th>Assigned rooms</th></tr>
        </thead>
        <tbody>
          {staff.map((s: any) => (
            <tr key={s.id}>
              <td style={{ fontWeight: 600 }}>{s.full_name}</td>
              <td>{cap(s.role)}</td>
              <td className="small">{(roomByStaff[s.id] ?? []).map((r: any) => String(r.name)).join(", ") || "—"}</td>
            </tr>
          ))}
          {staff.length === 0 && <tr><td colSpan={3} className="muted">No staff yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}