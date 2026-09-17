import { requireSession } from "@/lib/require";
import { listStaff, listRooms, listInstitutes, staffRooms } from "@/lib/store";
import { queryAll } from "@/lib/db";
import { uploadPhotoAction } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import { getBranding } from "@/lib/theme";
import AddStaffForm from "./AddStaffForm";

export const dynamic = "force-dynamic";

export default async function PortalStaffPage({
  searchParams,
}: {
  searchParams?: { added?: string; email?: string };
}) {
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
  const logins = await queryAll("SELECT staff_id, email FROM account WHERE staff_id IS NOT NULL");
  const emailByStaff = Object.fromEntries(logins.map((l) => [String(l.staff_id), String(l.email)]));

  return (
    <div>
      <h1 className="title">Staff</h1>

      {searchParams?.added ? (
        <div className="card mb-4" role="status" style={{ borderColor: "var(--brand-accent)" }}>
          <strong>Staff added.</strong>{" "}
          <span className="muted small">
            {searchParams.email
              ? `Login created for ${searchParams.email}. Share the email and password you set with them.`
              : "No login email was provided — add one to let this staff member sign in."}
          </span>
        </div>
      ) : null}

      <AddStaffForm rooms={rooms.map((r) => ({ id: String(r.id), name: String(r.name) }))} />

      <table className="data">
        <thead><tr><th>Name</th><th>Role</th><th>Login</th><th>Rooms</th><th>Status</th><th>Photo</th></tr></thead>
        <tbody>
          {staff.map((s: any) => (
            <tr key={s.id}>
              <td className="row" style={{ alignItems: "center", gap: 10 }}>
                <Avatar src={s.photo_url} name={s.full_name} size={32} color={branding.primaryColor} />
                <strong>{s.full_name}</strong>
              </td>
              <td>{capital(s.role)}</td>
              <td className="small">
                {emailByStaff[s.id] ? (
                  emailByStaff[s.id]
                ) : (
                  <span className="muted">No login yet</span>
                )}
              </td>
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
