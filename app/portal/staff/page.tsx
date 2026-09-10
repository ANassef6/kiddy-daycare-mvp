import { requireSession } from "@/lib/require";
import { listStaff, listRooms, listInstitutes, staffRooms } from "@/lib/store";
import { addStaffAction, uploadPhotoAction } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import { getBranding } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function PortalStaffPage() {
  requireSession();
  const branding = await getBranding();
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const [staff, rooms] = await Promise.all([
    iid ? listStaff(iid) : Promise.resolve([]),
    iid ? listRooms(iid) : Promise.resolve([]),
  ]);
  const roomAccess = await Promise.all(staff.map((s) => staffRooms(s.id)));
  const roomByName = Object.fromEntries(roomAccess.map((rooms, i) => [staff[i].id, rooms]));

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
        <thead><tr><th>Name</th><th>Role</th><th>Rooms</th><th>Status</th><th>Photo</th></tr></thead>
        <tbody>
          {staff.map((s: any) => (
            <tr key={s.id}>
              <td className="row" style={{ alignItems: "center", gap: 10 }}>
                {/* #7b staff avatar placeholder */}
                <Avatar src={s.photo_url} name={s.full_name} size={32} color={branding.primaryColor} />
                <strong>{s.full_name}</strong>
              </td>
              <td>{capital(s.role)}</td>
              <td className="small">{(roomByName[s.id] ?? []).map((r: any) => String(r.name)).join(", ") || "—"}</td>
              <td><span className={s.active ? "badge badge-green" : "badge badge-red"}>{s.active ? "Active" : "Inactive"}</span></td>
              <td>
                <form action={uploadPhotoAction} className="row" style={{ gap: 6, alignItems: "center" }}>
                  <input type="hidden" name="entityType" value="staff" />
                  <input type="hidden" name="entityId" value={s.id} />
                  <input type="file" name="file" accept="image/*" required id={`staffphoto-${s.id}`} style={{ display: "none" }} />
                  <label htmlFor={`staffphoto-${s.id}`} className="btn btn-ghost" style={{ cursor: "pointer", fontSize: 12, padding: "4px 10px" }}>
                    {s.photo_url ? "Change" : "Add photo"}
                  </label>
                  <button className="btn btn-primary" type="submit" style={{ fontSize: 12, padding: "4px 10px" }}>Save</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function capital(s: unknown) { const v = String(s ?? ""); return v.charAt(0).toUpperCase() + v.slice(1); }
