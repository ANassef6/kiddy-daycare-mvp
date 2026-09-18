import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import { listStaff, staffRooms, listStaffSchedules } from "@/lib/store";
import { queryAll } from "@/lib/db";
import { uploadPhotoAction } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import { cap } from "@/lib/helpers";

export const dynamic = "force-dynamic";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function StaffProfilePage({ params }: { params: { id: string } }) {
  requireSession();
  const { listInstitutes } = await import("@/lib/store");
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const staff = iid ? (await listStaff(iid)).find((s: any) => String(s.id) === params.id) : undefined;
  if (!staff) notFound();
  const [rooms, schedules, logins] = await Promise.all([
    staffRooms(staff.id),
    listStaffSchedules(staff.id),
    queryAll("SELECT email FROM account WHERE staff_id = ?", staff.id),
  ]);
  const email = (logins[0] as any)?.email as string | undefined;

  return (
    <div>
      <Link className="small muted" href="/portal/staff">← Staff</Link>
      <div className="row mt-2" style={{ alignItems: "center", gap: 12 }}>
        <Avatar src={staff.photo_url} name={staff.full_name} size={52} />
        <div>
          <h1 className="title" style={{ margin: 0 }}>{staff.full_name}</h1>
          <div className="subtitle">{cap(staff.role)} · {email ?? "No login yet"} · {(rooms as any[]).map((r: any) => r.name).join(", ") || "No rooms"}</div>
        </div>
      </div>

      <div className="card mt-4">
        <h3 className="subtitle">Profile photo</h3>
        <p className="small muted">Photo upload lives here, inside the profile. Choosing a file uploads it immediately.</p>
        <form action={uploadPhotoAction} encType="multipart/form-data" className="row" style={{ gap: 8, alignItems: "center" }}>
          <input type="hidden" name="entityType" value="staff" />
          <input type="hidden" name="entityId" value={staff.id} />
          <input type="file" name="file" accept="image/*" required />
          <button className="btn btn-primary" type="submit">Upload photo</button>
        </form>
      </div>

      <div className="card mt-4">
        <h3 className="subtitle">Weekly schedule</h3>
        {(schedules as any[]).length === 0 && <p className="muted small">No shifts yet — add them on the schedule page.</p>}
        {(schedules as any[]).map((s: any) => (
          <div className="list-item" key={s.id}>
            <span className="small"><strong>{DAYS[Number(s.day_of_week)] ?? s.day_of_week}</strong> · {s.start_time}–{s.end_time}{s.notes ? ` — ${s.notes}` : ""}</span>
          </div>
        ))}
        <Link className="btn btn-ghost small mt-2" href="/portal/staff/schedule">Manage schedule →</Link>
      </div>
    </div>
  );
}
