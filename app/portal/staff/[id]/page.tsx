import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { staffIdForAccount } from "@/lib/auth";
import { isAdminRole } from "@/lib/role";
import { listStaff, staffRooms, listStaffSchedules, staffStatusLog, staffActivity, listRooms } from "@/lib/store";
import { queryAll } from "@/lib/db";
import { uploadPhotoAction, updateStaffInfoAction } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import { cap } from "@/lib/helpers";
import ChildProfileTabs from "@/components/ChildProfileTabs";
import { StaffStatusForm } from "@/components/StaffStatusForm";

export const dynamic = "force-dynamic";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUS_KIND_LABEL: Record<string, string> = {
  checkin: "Checked in",
  out: "Checked out",
  sick: "Sick",
  vacation: "Vacation",
  absent: "Absent",
  child_sick: "Child sick",
};

export default async function StaffProfilePage({ params, searchParams }: { params: { id: string }; searchParams?: { edit?: string } }) {
  const session = requireSession();
  const { listInstitutes } = await import("@/lib/store");
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;

  // KID-105 #13: staff can only view their own profile.
  if (!isAdminRole(session.role)) {
    const myStaffId = await staffIdForAccount(session.accountId);
    if (myStaffId && myStaffId !== params.id) {
      redirect(`/portal/staff/${myStaffId}`);
    }
    if (!myStaffId) {
      return <p className="muted">No staff profile linked to this account.</p>;
    }
  }

  const staff = iid ? (await listStaff(iid)).find((s: any) => String(s.id) === params.id) : undefined;
  if (!staff) notFound();
  const [rooms, schedules, logins, statusLog, activity] = await Promise.all([
    staffRooms(staff.id),
    listStaffSchedules(staff.id),
    queryAll("SELECT email FROM account WHERE staff_id = ?", staff.id),
    staffStatusLog(staff.id),
    staffActivity(staff.id),
  ]);
  const email = staff.email ?? (logins[0] as any)?.email as string | undefined;

  const tabs = [
    { id: "profile", label: "Profile", node: profileTab(staff, rooms, email, statusLog, activity, searchParams?.edit) },
    { id: "calendar", label: "Calendar", node: calendarTab(schedules) },
  ];

  return (
    <div>
      <Link className="small muted" href="/portal/staff">← Staff</Link>
      <div className="row mt-2" style={{ alignItems: "center", gap: 12 }}>
        <Avatar src={staff.photo_url} name={staff.full_name} size={52} />
        <div style={{ flex: 1 }}>
          <h1 className="title" style={{ margin: 0 }}>{staff.full_name}</h1>
          <div className="subtitle">{cap(staff.role)} · {email ?? "No login yet"} · {(rooms as any[]).map((r: any) => r.name).join(", ") || "No rooms"}</div>
        </div>
        <form action={uploadPhotoAction} encType="multipart/form-data" className="row" style={{ gap: 8, alignItems: "center" }}>
          <input type="hidden" name="entityType" value="staff" />
          <input type="hidden" name="entityId" value={String(staff.id)} />
          <input type="file" name="file" accept="image/*" required style={{ maxWidth: 180 }} />
          <button className="btn btn-ghost small" type="submit">Upload photo</button>
        </form>
      </div>

      <div className="mt-3">
        <ChildProfileTabs tabs={tabs} />
      </div>
    </div>
  );
}

function statusCard(staff: any) {
  const current = STATUS_KIND_LABEL[staff.status] ?? (staff.active ? "Active" : "Inactive");
  const tone =
    staff.status === "checkin" ? "green"
    : staff.status === "out" ? "gray"
    : staff.status === "sick" || staff.status === "child_sick" ? "red"
    : staff.status ? "gray"
    : staff.active ? "green" : "red";
  return (
    <div className="card mb-4" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div className="small muted">Current status</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>
          <span className={`badge badge-${tone}`}>{current}</span>
        </div>
        {staff.status_note && <div className="muted small mt-1">{staff.status_note}</div>}
        {staff.status_at && <div className="muted small">Since {new Date(staff.status_at).toLocaleString()}</div>}
      </div>
      <StaffStatusForm staffId={String(staff.id)} current={staff.status ?? ""} />
    </div>
  );
}

function profileTab(staff: any, rooms: any[], email: string | undefined, statusLog: any[], activity: any, editing: string | undefined) {
  const infoRows: [string, any][] = [
    ["Full name", staff.full_name],
    ["Role", staff.role ? cap(staff.role) : "—"],
    ["Email", email ?? "—"],
    ["Phone", staff.phone ?? "—"],
    ["Assigned classrooms", rooms.map((r) => r.name).join(", ") || "—"],
    ["Bio", staff.bio || "—"],
    ["Member since", staff.created_at ? new Date(staff.created_at).toDateString() : "—"],
    ["Last date", staff.last_date ? new Date(staff.last_date).toDateString() : "—"],
  ];
  const openEdit = editing === "status" || editing === "info";
  return (
    <div>
      {statusCard(staff)}

      <div className="card mb-4">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="subtitle">Registration</h3>
          <details open>
            <summary className="btn btn-ghost small" style={{ cursor: "pointer", listStyle: "none" }}>{openEdit ? "Close editor" : "Edit basic info"}</summary>
            <form action={updateStaffInfoAction} className="mt-2">
              <input type="hidden" name="staffId" value={String(staff.id)} />
              <div className="row">
                <div className="col field"><label className="label">Full name</label><input className="input" name="fullName" defaultValue={staff.full_name} /></div>
                <div className="col field"><label className="label">Role</label>
                  <select className="select" name="role" defaultValue={staff.role ?? "carer"}>
                    <option value="carer">Carer</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
              </div>
              <div className="row">
                <div className="col field"><label className="label">Email</label><input className="input" name="email" type="email" defaultValue={email ?? ""} /></div>
                <div className="col field"><label className="label">Phone</label><input className="input" name="phone" defaultValue={staff.phone ?? ""} /></div>
              </div>
              <div className="field"><label className="label">Bio</label><textarea className="textarea" name="bio" defaultValue={staff.bio ?? ""} /></div>
              <div className="row">
                <div className="col field">
                  <label className="label">Last date</label>
                  <input className="input" name="lastDate" type="date" defaultValue={staff.last_date ? String(staff.last_date).slice(0, 10) : ""} />
                </div>
              </div>
              <p className="small muted">When the last date is reached this staff account can no longer sign in or use the portal.</p>
              <div className="field">
                <label className="label">Room access</label>
                <div className="row">
                  {rooms.length === 0 && <span className="muted small">No rooms configured.</span>}
                  {/* re-render via rooms prop; handled below */}
                </div>
              </div>
              <RoomsCheckboxes staffId={String(staff.id)} />
              <button className="btn btn-primary small" type="submit">Save changes</button>
            </form>
          </details>
        </div>
        <table className="table mt-2">
          <tbody>
            {infoRows.map(([k, v]) => (
              <tr key={k}>
                <td className="muted" style={{ width: 180 }}>{k}</td>
                <td><strong>{String(v)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid">
        <div className="card">
          <h3 className="subtitle">Status history</h3>
          {statusLog.length === 0 ? <p className="muted small">No status changes yet.</p> : null}
          {statusLog.map((s: any) => (
            <div className="list-item small" key={s.id}>
              <span className={`badge ${s.status === "checkin" ? "badge-green" : s.status === "sick" || s.status === "child_sick" ? "badge-red" : "badge-gray"}`}>
                {STATUS_KIND_LABEL[s.status] ?? cap(s.status)}
              </span>
              <span className="muted">{s.note ? `${s.note} · ` : ""}{s.changed_by_name ? `${s.changed_by_name} · ` : ""}{new Date(s.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3 className="subtitle">This year&apos;s activity</h3>
          {[
            ["Posts", activity.posts],
            ["Media", activity.media],
            ["Messages", activity.messages],
            ["Observations", activity.observations],
            ["Assessments", activity.assessments],
            ["2-year checks", activity.twoYearChecks],
            ["Reports", activity.reports],
            ["Check-ins", activity.checkIns],
            ["Incidents", activity.incidents],
          ].map(([k, v]) => (
            <div className="list-item small" key={String(k)}>
              <span><strong>{String(v ?? 0)}</strong> {k}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

async function RoomsCheckboxes({ staffId }: { staffId: string }) {
  const { listInstitutes } = await import("@/lib/store");
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const allRooms = iid ? await listRooms(iid) : [];
  const assigned = new Set((await staffRooms(staffId)).map((r) => String(r.id)));
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
      {allRooms.map((r) => (
        <label key={String(r.id)} className="row small" style={{ gap: 6, alignItems: "center" }}>
          <input type="checkbox" name="roomIds" value={String(r.id)} defaultChecked={assigned.has(String(r.id))} /> {String(r.name)}
        </label>
      ))}
    </div>
  );
}

function calendarTab(schedules: any[]) {
  return (
    <div className="card">
      <h3 className="subtitle">Weekly schedule</h3>
      {schedules.length === 0 && <p className="muted small">No shifts yet — add them on the schedule page.</p>}
      {schedules.map((s: any) => (
        <div className="list-item" key={s.id}>
          <span className="small"><strong>{DAYS[Number(s.day_of_week)] ?? s.day_of_week}</strong> · {s.start_time}–{s.end_time}{s.notes ? ` — ${s.notes}` : ""}</span>
        </div>
      ))}
      <Link className="btn btn-ghost small mt-2" href="/portal/staff/schedule">Manage schedule →</Link>
    </div>
  );
}