import { requireSession } from "@/lib/require";
import { listStaff, listRooms, listInstitutes, staffRooms } from "@/lib/store";
import { addStaffAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default function PortalStaffPage() {
  requireSession();
  const institutes = listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const staff = iid ? listStaff(iid) : [];
  const rooms = iid ? listRooms(iid) : [];

  return (
    <div>
      <h1 className="title">Staff</h1>
      <form className="card mb-4" action={addStaffAction}>
        <div className="row">
          <div className="col field"><label className="label">Full name</label><input className="input" name="fullName" required /></div>
          <div className="col field"><label className="label">Role</label>
            <select className="select" name="role"><option value="carer">Carer</option><option value="admin">Admin</option></select>
          </div>
        </div>
        <div className="field">
          <label className="label">Room access</label>
          <div className="row">
            {rooms.map((r) => (
              <label key={r.id} className="row small" style={{ gap: 6, alignItems: "center" }}>
                <input type="checkbox" name="roomIds" value={String(r.id)} /> {String(r.name)}
              </label>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" type="submit">Add staff</button>
      </form>

      <table className="data">
        <thead><tr><th>Name</th><th>Role</th><th>Rooms</th><th>Status</th></tr></thead>
        <tbody>
          {staff.map((s: any) => (
            <tr key={s.id}>
              <td><strong>{s.full_name}</strong></td>
              <td>{capital(s.role)}</td>
              <td className="small">{staffRooms(s.id).map((r) => String(r.name)).join(", ") || "—"}</td>
              <td><span className={s.active ? "badge badge-green" : "badge badge-red"}>{s.active ? "Active" : "Inactive"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function capital(s: unknown) { const v = String(s ?? ""); return v.charAt(0).toUpperCase() + v.slice(1); }
