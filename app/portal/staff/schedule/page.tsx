import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { staffIdForAccount } from "@/lib/auth";
import { isAdminRole } from "@/lib/role";
import { listRoomsScoped, listStaff, listStaffSchedules } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { createStaffScheduleAction, deleteStaffScheduleAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr, fmtDateFor, type Dict, type Locale } from "@/lib/i18n";

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
const ERROR_KEY: Record<string, string> = {
  date: "staff.errorDate",
  time: "staff.errorTime",
  range: "staff.errorRange",
  repeat: "staff.errorRepeat",
  rooms: "staff.errorRooms",
};

function roleLabel(dict: Dict, role: unknown): string {
  const key = ROLE_LABEL_KEY[String(role ?? "").toLowerCase()];
  return key ? tr(dict, key) : String(role ?? "");
}

function scheduleDayLabel(locale: Locale, dict: Dict, entry: any, timeZone: string): string {
  if (entry.schedule_date) return fmtDateFor(locale, entry.schedule_date, timeZone);
  const day = DAYS[Number(entry.day_of_week)];
  return day ? tr(dict, day.k) : String(entry.day_of_week);
}

export default async function PortalStaffSchedulePage(
  props: { searchParams: Promise<{ error?: string }> }
) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  // KID-2502: this admin surface is closed to non-admin staff — they keep
  // their own schedule on their profile's Calendar tab.
  if (!isAdminRole(session.role)) {
    const myStaffId = await staffIdForAccount(session.accountId);
    redirect(myStaffId ? `/portal/staff/${myStaffId}` : "/portal/staff");
  }
  const { dict, locale, timeZone } = await i18nForAccount(session.accountId);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{tr(dict, "learning.noInstitute")}</p>;

  const staff = await listStaff(instituteId);

  // KID-2483: admins assign any center room.
  const [schedules, rooms] = await Promise.all([
    Promise.all(staff.map((s: any) => listStaffSchedules(s.id))),
    listRoomsScoped(instituteId, session.accountId),
  ]);
  const byStaff: Record<string, any[]> = {};
  staff.forEach((s: any, i: number) => { byStaff[String(s.id)] = schedules[i] as any[]; });
  const errorKey = searchParams.error ? ERROR_KEY[searchParams.error] : undefined;

  return (
    <div>
      <h1 className="title">{tr(dict, "nav.staffSchedule")}</h1>
      <p className="subtitle">{tr(dict, "staff.scheduleSubtitle")}</p>

      {errorKey && (
        <p className="card small" style={{ color: "#B91C1C", fontWeight: 600 }}>
          {tr(dict, errorKey)}
        </p>
      )}

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
              <label className="label">{tr(dict, "staff.dateLabel")}</label>
              <input className="input" type="date" name="scheduleDate" />
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
          <p className="muted small" style={{ marginTop: -4 }}>{tr(dict, "staff.dateHint")}</p>

          <div className="field">
            <label className="label">{tr(dict, "staff.roomsLabel")}</label>
            {(rooms as any[]).length === 0 ? (
              <p className="muted small">{tr(dict, "staff.noRoomsAvailable")}</p>
            ) : (
              <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
                {(rooms as any[]).map((r: any) => (
                  <label key={r.id} className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" name="roomIds" value={String(r.id)} />
                    {String(r.name)}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="row">
            <div className="col field">
              <label className="label">{tr(dict, "staff.repeatLabel")}</label>
              <select className="select" name="repeat" defaultValue="none">
                <option value="none">{tr(dict, "staff.repeatNone")}</option>
                <option value="daily">{tr(dict, "staff.repeatDaily")}</option>
                <option value="weekly">{tr(dict, "staff.repeatWeekly")}</option>
              </select>
            </div>
            <div className="col field">
              <label className="label">{tr(dict, "staff.repeatUntilLabel")}</label>
              <input className="input" type="date" name="repeatUntil" />
            </div>
          </div>
          <p className="muted small" style={{ marginTop: -4 }}>{tr(dict, "staff.repeatHint")}</p>

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
              <span className="small">
                <span className={`badge ${sh.schedule_date ? "badge-green" : "badge-gray"}`} style={{ marginInlineEnd: 6 }}>
                  {tr(dict, sh.schedule_date ? "staff.specificDateBadge" : "staff.weeklyBadge")}
                </span>
                <strong>{scheduleDayLabel(locale, dict, sh, timeZone)}</strong> · {sh.start_time}–{sh.end_time}
                {Array.isArray(sh.room_names) && sh.room_names.length > 0
                  ? ` · ${tr(dict, "staff.roomsPrefix", { rooms: sh.room_names.join(", ") })}`
                  : ""}
                {sh.notes ? ` — ${sh.notes}` : ""}
              </span>
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
