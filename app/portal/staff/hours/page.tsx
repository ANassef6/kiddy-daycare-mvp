import { requireSession } from "@/lib/require";
import { staffIdForAccount } from "@/lib/auth";
import { isAdminRole } from "@/lib/role";
import { listInstitutes, listStaff, staffRooms, getInstitute } from "@/lib/store";
import { cap, safeJson } from "@/lib/helpers";

export const dynamic = "force-dynamic";

export default async function PortalStaffHoursPage() {
  const session = requireSession();
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const allStaff = iid ? await listStaff(iid) : [];

  // KID-105 #13: staff sees only their own working-hours row.
  let staff: any[];
  if (isAdminRole(session.role)) {
    staff = allStaff;
  } else {
    const myStaffId = await staffIdForAccount(session.accountId);
    const me = myStaffId ? allStaff.find((s: any) => String(s.id) === myStaffId) : undefined;
    staff = me ? [me] : [];
  }

  const institute = iid ? await getInstitute(iid) : undefined;
  const openingHours = safeJson<Record<string, string>>(institute?.opening_hours, {});
  const roomAccess = await Promise.all(staff.map((s: any) => staffRooms(s.id)));
  const roomByStaff = Object.fromEntries(roomAccess.map((r, i) => [staff[i].id, r]));

  return (
    <div>
      <h1 className="title">Working hours</h1>
      <p className="subtitle">
        Center opening hours and staff availability. Shifts are tracked here as the registry matures;
        center hours are configured on the Settings page.
      </p>

      <div className="card mb-4">
        <h3 className="subtitle">Center opening hours</h3>
        {Object.keys(openingHours).length === 0 && <p className="muted small">No opening hours configured.</p>}
        {Object.entries(openingHours).map(([day, hours]) => (
          <div className="list-item" key={day}>
            <span className="small" style={{ fontWeight: 600 }}>{cap(day)}</span>
            <span className="muted small">{hours}</span>
          </div>
        ))}
      </div>

      <table className="data">
        <thead>
          <tr><th>Staff</th><th>Role</th><th>Status</th><th>Rooms</th></tr>
        </thead>
        <tbody>
          {staff.map((s: any) => (
            <tr key={s.id}>
              <td style={{ fontWeight: 600 }}>{s.full_name}</td>
              <td>{cap(s.role)}</td>
              <td><span className={s.active ? "badge badge-green" : "badge badge-red"}>{s.active ? "Active" : "Inactive"}</span></td>
              <td className="small">{(roomByStaff[s.id] ?? []).map((r: any) => String(r.name)).join(", ") || "—"}</td>
            </tr>
          ))}
          {staff.length === 0 && <tr><td colSpan={4} className="muted">No staff yet.</td></tr>}
        </tbody>
      </table>
      <p className="muted small mt-3">
        Detailed working-hour tracking (clock in/out per staff) is a scheduled follow-up — listed with today&apos;s roster for reference.
      </p>
    </div>
  );
}