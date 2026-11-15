import { requireSession } from "@/lib/require";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { staffIdForAccount } from "@/lib/auth";
import { isAdminRole } from "@/lib/role";
import {listStaff, staffRooms, getInstitute } from "@/lib/store";
import { normalizeWorkingHours, dayLabelFor } from "@/lib/working-hours";
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
const DAY_LABEL_KEY: Record<string, string> = {
  sunday: "settings.daySunday",
  monday: "settings.dayMonday",
  tuesday: "settings.dayTuesday",
  wednesday: "settings.dayWednesday",
  thursday: "settings.dayThursday",
  friday: "settings.dayFriday",
  saturday: "settings.daySaturday",
};

function roleLabel(dict: Dict, role: unknown): string {
  const key = ROLE_LABEL_KEY[String(role ?? "").toLowerCase()];
  return key ? tr(dict, key) : String(role ?? "");
}

export default async function PortalStaffHoursPage() {
  const session = await requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const iid = await resolveTenantInstituteId();
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
  const openingWeek = normalizeWorkingHours(institute?.opening_hours);
  const roomAccess = await Promise.all(staff.map((s: any) => staffRooms(s.id)));
  const roomByStaff = Object.fromEntries(roomAccess.map((r, i) => [staff[i].id, r]));

  return (
    <div>
      <h1 className="title">{tr(dict, "nav.workingHours")}</h1>
      <p className="subtitle">{tr(dict, "staff.hoursSubtitle")}</p>

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "staff.centerOpeningHours")}</h3>
        {Object.keys(openingWeek).length === 0 && <p className="muted small">{tr(dict, "staff.noOpeningHours")}</p>}
        {Object.entries(openingWeek).map(([day, hours]) => {
          const dayKey = DAY_LABEL_KEY[dayLabelFor(day).toLowerCase()];
          return (
            <div className="list-item" key={day}>
              <span className="small" style={{ fontWeight: 600 }}>{dayKey ? tr(dict, dayKey) : dayLabelFor(day)}</span>
              <span className="muted small">{`${hours.open} - ${hours.close}`}</span>
            </div>
          );
        })}
      </div>

      <table className="data">
        <thead>
          <tr><th>{tr(dict, "common.staff")}</th><th>{tr(dict, "staff.roleLabel")}</th><th>{tr(dict, "common.status")}</th><th>{tr(dict, "nav.rooms")}</th></tr>
        </thead>
        <tbody>
          {staff.map((s: any) => (
            <tr key={s.id}>
              <td style={{ fontWeight: 600 }}>{s.full_name}</td>
              <td>{roleLabel(dict, s.role)}</td>
              <td><span className={s.active ? "badge badge-green" : "badge badge-red"}>{s.active ? tr(dict, "profile.active") : tr(dict, "staff.inactive")}</span></td>
              <td className="small">{(roomByStaff[s.id] ?? []).map((r: any) => String(r.name)).join(", ") || "—"}</td>
            </tr>
          ))}
          {staff.length === 0 && <tr><td colSpan={4} className="muted">{tr(dict, "staff.noStaffYet")}</td></tr>}
        </tbody>
      </table>
      <p className="muted small mt-3">{tr(dict, "staff.trackingNote")}</p>
    </div>
  );
}
