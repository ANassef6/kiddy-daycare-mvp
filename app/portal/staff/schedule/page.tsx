import { requireSession } from "@/lib/require";
import { staffIdForAccount } from "@/lib/auth";
import { isAdminRole } from "@/lib/role";
import { listStaff, listStaffSchedules } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { createStaffScheduleAction, deleteStaffScheduleAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr, type Dict } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const ROLE_LABEL_KEY: Record<string, string> = {
  owner: "roles.owner",
  admin: "roles.admin",
  teacher: "staff.roleTeacher",
  carer: "roles.carer",
  caregiver: "staff.roleCaregiver",
};
const DAYS = [
  { v: 0, k: "settings.daySunday" }, { v: 1, k: "settings.dayMonday" }, { v: 2, k: "settings.dayTuesday" },
  { v: 3, k: "settings.dayWednesday" }, { v: 4, k: "settings.dayThursday" }, { v: 5, k: "settings.dayFriday" }, { v: 6, k: "settings.daySaturday" },
];

function roleLabel(dict: Dict, role: unknown): string {
  const key = ROLE_LABEL_KEY[String(role ?? "").toLowerCase()];
  return key ? tr(dict, key) : String(role ?? "");
}

export default async function PortalStaffSchedulePage() {
  const session = await requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{tr(dict, "learning.noInstitute")}</p>;

  // KID-105 #13: staff sees only their own schedule.
  let staff: any[];
  if (isAdminRole(session.role)) {
    staff = await listStaff(instituteId);
  } else {
    const myStaffId = await staffIdForAccount(session.accountId);
    const me = myStaffId ? (await listStaff(instituteId)).find((s: any) => String(s.id) === myStaffId) : undefined;
    staff = me ? [me] : [];
  }

  const schedules = await Promise.all(staff.map((s: any) => listStaffSchedules(s.id)));
  const byStaff: Record<string, any[]> = {};
  staff.forEach((s: any, i: number) => { byStaff[String(s.id)] = schedules[i] as any[]; });

  return (
    <div>
      <h1 className="title">{tr(dict, "nav.staffSchedule")}</h1>
      <p className="subtitle">{tr(dict, "staff.scheduleSubtitle")}</p>

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "staff.addShiftTitle")}</h3>
        <form action={createStaffScheduleAction}>
          <div className="row">
            <div className="col field">
              <label className="label">{tr(dict, "common.staff")}</label>
              <select className="select" name="staffId" required>
                {staff.map((s: any) => <option key={s.id} value={s.id}>{s.full_name} ({roleLabel(dict, s.role)})</option>)}
              </select>
            </div>
            <div className="col field">
              <label className="label">{tr(dict, "settings.day")}</label>
              <select className="select" name="dayOfWeek">
                {DAYS.map((d) => <option key={d.v} value={d.v}>{tr(dict, d.k)}</option>)}
              </select>
            </div>
            <div className="col field"><label className="label">{tr(dict, "events.startLabel")}</label><input className="input" type="time" name="startTime" defaultValue="08:00" required /></div>
            <div className="col field"><label className="label">{tr(dict, "activities.end")}</label><input className="input" type="time" name="endTime" defaultValue="16:00" required /></div>
          </div>
          <div className="field"><label className="label">{tr(dict, "common.notes")}</label><input className="input" name="notes" placeholder={tr(dict, "staff.notesPlaceholder")} /></div>
          <button className="btn btn-primary" type="submit">{tr(dict, "staff.addShiftBtn")}</button>
        </form>
      </div>

      {staff.map((s: any) => (
        <div className="card mb-4" key={s.id}>
          <h3 className="subtitle" style={{ marginBottom: 4 }}>{tr(dict, "staff.perStaffHeading", { name: s.full_name, role: roleLabel(dict, s.role) })}</h3>
          {(byStaff[String(s.id)] ?? []).length === 0 && <p className="muted small">{tr(dict, "staff.emptyShifts")}</p>}
          {(byStaff[String(s.id)] ?? []).map((sh: any) => (
            <div className="list-item" key={sh.id}>
              <span className="small"><strong>{DAYS[Number(sh.day_of_week)] ? tr(dict, DAYS[Number(sh.day_of_week)].k) : sh.day_of_week}</strong> · {sh.start_time}–{sh.end_time}{sh.notes ? ` — ${sh.notes}` : ""}</span>
              <form action={deleteStaffScheduleAction}>
                <input type="hidden" name="id" value={sh.id} />
                <button className="btn btn-ghost small" type="submit">{tr(dict, "staff.removeBtn")}</button>
              </form>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
