import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { staffIdForAccount } from "@/lib/auth";
import { isAdminRole } from "@/lib/role";
import {
  listStaff,
  staffRooms,
  getInstitute,
  listStaffSchedulesForStaffIds,
  staffStatusEventsBetween,
} from "@/lib/store";
import { normalizeWorkingHours, dayLabelFor } from "@/lib/working-hours";
import { localDayBoundsUtc, normalizeTimeZone, zonedDateKey } from "@/lib/timezone";
import {
  addDays,
  classifyStaffHours,
  computeStaffHoursRows,
  formatDurationParts,
  isDateKey,
  resolveHoursFilter,
  type ActualHours,
  type StaffHoursDelta,
  type StaffHoursStatus,
} from "@/lib/staff-hours";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr, fmtDateFor, type Dict } from "@/lib/i18n";

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
const HOURS_STATUS_KEY: Record<StaffHoursStatus, string> = {
  on_time: "staff.hoursStatusOnTime",
  short: "staff.hoursStatusShort",
  over: "staff.hoursStatusOver",
  absent: "staff.hoursStatusAbsent",
  unscheduled: "staff.hoursStatusUnscheduled",
  no_schedule: "staff.hoursStatusNoSchedule",
  upcoming: "staff.hoursStatusUpcoming",
};
const HOURS_STATUS_TONE: Record<StaffHoursStatus, string> = {
  on_time: "green",
  short: "amber",
  over: "amber",
  absent: "red",
  unscheduled: "gray",
  no_schedule: "gray",
  upcoming: "gray",
};

type StaffHoursRow = {
  staff: any;
  expected: number;
  actual: ActualHours;
  delta: StaffHoursDelta;
};

function roleLabel(dict: Dict, role: unknown): string {
  const key = ROLE_LABEL_KEY[String(role ?? "").toLowerCase()];
  return key ? tr(dict, key) : String(role ?? "");
}

function duration(dict: Dict, minutes: number): string {
  const parts = formatDurationParts(minutes);
  return tr(dict, "staff.durationHM", {
    h: parts.hours,
    m: String(parts.minutes).padStart(2, "0"),
  });
}

function deltaLabel(dict: Dict, minutes: number): string {
  if (minutes === 0) return duration(dict, 0);
  const sign = minutes > 0 ? "+" : "−";
  return `${sign}${duration(dict, Math.abs(minutes))}`;
}

export default async function PortalStaffHoursPage(
  props: {
    searchParams?: Promise<{ view?: string; date?: string; from?: string; to?: string }>;
  }
) {
  const searchParams = (await props.searchParams) ?? {};
  const session = await requireSession();
  // KID-2502: this admin surface is closed to non-admin staff — they keep
  // their own schedule on their profile's Calendar tab.
  if (!isAdminRole(session.role)) {
    const myStaffId = await staffIdForAccount(session.accountId);
    redirect(myStaffId ? `/portal/staff/${myStaffId}` : "/portal/staff");
  }
  const { dict, locale } = await i18nForAccount(session.accountId);
  const iid = await resolveTenantInstituteId();
  const staff = iid ? await listStaff(iid) : [];

  const institute = iid ? await getInstitute(iid) : undefined;
  const openingWeek = normalizeWorkingHours(institute?.opening_hours);
  const roomAccess = await Promise.all(staff.map((s: any) => staffRooms(s.id)));
  const roomByStaff = Object.fromEntries(roomAccess.map((r, i) => [staff[i].id, r]));

  const now = new Date();
  const timeZone = normalizeTimeZone(institute?.timezone);
  const today = zonedDateKey(now, timeZone);
  const filter = resolveHoursFilter(searchParams, today);
  const staffIds = staff.map((s: any) => String(s.id));

  const scheduleRows = await listStaffSchedulesForStaffIds(staffIds);
  const fromBounds = localDayBoundsUtc(filter.from, timeZone);
  const toBounds = localDayBoundsUtc(filter.to, timeZone);
  const statusRows = await staffStatusEventsBetween(
    staffIds,
    new Date(fromBounds.start.getTime() - 2 * 86_400_000),
    new Date(toBounds.end.getTime() + 86_400_000)
  );

  const scheduleByStaff: Record<string, any[]> = {};
  for (const row of scheduleRows) {
    const key = String(row.staff_id);
    (scheduleByStaff[key] ??= []).push(row);
  }
  const statusByStaff: Record<string, any[]> = {};
  for (const row of statusRows) {
    const key = String(row.staff_id);
    (statusByStaff[key] ??= []).push(row);
  }

  const upcoming = filter.from > filter.today;
  const computed = computeStaffHoursRows({
    staffIds,
    schedulesByStaff: scheduleByStaff,
    statusesByStaff: statusByStaff,
    days: filter.days,
    timeZone,
    now,
    rangeEnd: toBounds.end,
    upcoming,
  });
  const rows: StaffHoursRow[] = staff.map((s: any, i) => ({
    staff: s,
    expected: computed[i].expected,
    actual: computed[i].actual,
    delta: computed[i].delta,
  }));

  const totalExpected = computed.reduce((sum, r) => sum + r.expected, 0);
  const totalActual = computed.reduce((sum, r) => sum + r.actual.minutes, 0);
  const totalDelta = classifyStaffHours({
    expected: totalExpected,
    actual: totalActual,
    upcoming,
  });

  const dayValue = filter.view === "day" ? filter.from : isDateKey(searchParams.date) ? String(searchParams.date) : filter.today;
  const rangeFrom = filter.view === "range" ? filter.from : addDays(filter.today, -6);
  const rangeTo = filter.view === "range" ? filter.to : filter.today;

  return (
    <div>
      <h1 className="title">{tr(dict, "nav.workingHours")}</h1>
      <p className="subtitle">{tr(dict, "staff.hoursSubtitle")}</p>

      {filter.invalid && (
        <p className="small" style={{ color: "#92400e", fontWeight: 600 }}>
          {tr(dict, "staff.hoursInvalidFilter")}
        </p>
      )}
      {filter.clamped && (
        <p className="small" style={{ color: "#92400e", fontWeight: 600 }}>
          {tr(dict, "staff.hoursRangeClamped", { days: filter.days.length })}
        </p>
      )}

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "staff.hoursSingleDay")}</h3>
        <form method="get" className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <input type="hidden" name="view" value="day" />
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{tr(dict, "staff.hoursFilterDate")}</label>
            <input className="input" type="date" name="date" defaultValue={dayValue} />
          </div>
          <button className="btn btn-primary small" type="submit">
            {tr(dict, "staff.hoursFilterApply")}
          </button>
          <a className="small" href={`/portal/staff/hours?view=day&date=${filter.today}`}>
            {tr(dict, "staff.hoursFilterToday")}
          </a>
        </form>

        <h3 className="subtitle mt-3">{tr(dict, "staff.hoursRange")}</h3>
        <form method="get" className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <input type="hidden" name="view" value="range" />
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{tr(dict, "staff.hoursFilterFrom")}</label>
            <input className="input" type="date" name="from" defaultValue={rangeFrom} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{tr(dict, "staff.hoursFilterTo")}</label>
            <input className="input" type="date" name="to" defaultValue={rangeTo} />
          </div>
          <button className="btn btn-primary small" type="submit">
            {tr(dict, "staff.hoursFilterApply")}
          </button>
        </form>
      </div>

      <p className="small muted">
        {filter.view === "day"
          ? tr(dict, "staff.hoursShowingDay", { date: fmtDateFor(locale, filter.from, timeZone) })
          : tr(dict, "staff.hoursShowingRange", {
              from: fmtDateFor(locale, filter.from, timeZone),
              to: fmtDateFor(locale, filter.to, timeZone),
            })}
      </p>

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
          <tr>
            <th>{tr(dict, "common.staff")}</th>
            <th>{tr(dict, "staff.roleLabel")}</th>
            <th>{tr(dict, "staff.expectedHours")}</th>
            <th>{tr(dict, "staff.actualHours")}</th>
            <th>{tr(dict, "staff.difference")}</th>
            <th>{tr(dict, "common.status")}</th>
            <th>{tr(dict, "nav.rooms")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ staff: s, expected, actual, delta }) => (
            <tr key={s.id}>
              <td style={{ fontWeight: 600 }}>{s.full_name}</td>
              <td>{roleLabel(dict, s.role)}</td>
              <td>{expected > 0 ? duration(dict, expected) : <span className="muted">—</span>}</td>
              <td>
                {duration(dict, actual.minutes)}
                {actual.open && <span className="muted small"> •</span>}
                {actual.missingCheckout && <span className="muted small"> •</span>}
              </td>
              <td>
                {delta.status === "no_schedule" ? (
                  <span className="muted">—</span>
                ) : (
                  <span className={`badge badge-${HOURS_STATUS_TONE[delta.status]}`}>
                    {tr(dict, HOURS_STATUS_KEY[delta.status])} · {deltaLabel(dict, delta.minutes)}
                  </span>
                )}
              </td>
              <td>
                <span className={s.active ? "badge badge-green" : "badge badge-red"}>
                  {s.active ? tr(dict, "profile.active") : tr(dict, "staff.inactive")}
                </span>
              </td>
              <td className="small">
                {(roomByStaff[s.id] ?? []).map((r: any) => String(r.name)).join(", ") || "—"}
              </td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr style={{ fontWeight: 700 }}>
              <td colSpan={2}>{tr(dict, "staff.totalRow")}</td>
              <td>{duration(dict, totalExpected)}</td>
              <td>{duration(dict, totalActual)}</td>
              <td>
                {totalDelta.status === "no_schedule" ? (
                  <span className="muted">—</span>
                ) : (
                  <span className={`badge badge-${HOURS_STATUS_TONE[totalDelta.status]}`}>
                    {tr(dict, HOURS_STATUS_KEY[totalDelta.status])} · {deltaLabel(dict, totalDelta.minutes)}
                  </span>
                )}
              </td>
              <td colSpan={2} />
            </tr>
          )}
          {rows.length === 0 && <tr><td colSpan={7} className="muted">{tr(dict, "staff.noStaffYet")}</td></tr>}
        </tbody>
      </table>

      {rows.some((r) => r.actual.open) && (
        <p className="muted small mt-3">{tr(dict, "staff.hoursOpenShift")}</p>
      )}
      {rows.some((r) => r.actual.missingCheckout) && (
        <p className="muted small">{tr(dict, "staff.hoursMissingCheckout")}</p>
      )}
      <p className="muted small mt-3">{tr(dict, "staff.hoursSourceNote")}</p>
      <p className="muted small">{tr(dict, "staff.trackingNote")}</p>
    </div>
  );
}
