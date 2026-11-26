import Link from "next/link";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { requireSession } from "@/lib/require";
import {attendanceOn, runAutoCheckoutSweep, scopedRoomIds, listRooms, busStatusByChild, busPhaseForCount, parentCheckInOutAllowed, centerToday, AUTO_CHECKOUT_SOURCE } from "@/lib/store";
import { AttendanceCheckIn } from "@/components/AttendanceCheckIn";
import { BusStatusButtons } from "@/components/BusStatusButtons";
import { recordToolUsage } from "@/lib/tool-usage";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateFor, fmtTimeFor, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalAttendancePage(
  props: {
    searchParams: Promise<{ day?: string; sweep?: string; q?: string; room?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const { dict, locale, timeZone } = await i18nForAccount(session.accountId);
  const iid = await resolveTenantInstituteId();
  await recordToolUsage({ instituteId: String(iid ?? "") || null, accountId: session.accountId, toolKey: "attendance", source: "portal", metadata: null });
  // KID-2437: the default day is the center's local calendar day.
  const day = searchParams.day ?? (iid ? await centerToday(iid) : new Date().toISOString().slice(0, 10));
  const q = searchParams.q ?? "";
  const roomId = searchParams.room ?? "";

  // KID-2447: children still checked in when working hours end are checked out
  // by the system before attendance renders (staff keep the close +3h grace).
  // KID-494: the same sweep also auto-sets off-bus (close +2h) for children
  // staff left on.
  const sweep = iid ? await runAutoCheckoutSweep(iid) : undefined;

  // Resolve the rooms this account may see.
  const allowedRoomIds = iid ? await scopedRoomIds(iid, session.accountId) : null;
  const allRooms = iid ? await listRooms(iid) : [];
  const visibleRooms =
    allowedRoomIds === null
      ? allRooms
      : allRooms.filter((r) => allowedRoomIds.includes(String(r.id)));

  // Validate the requested room filter is within scope.
  const effectiveRoomId =
    roomId && (allowedRoomIds === null || allowedRoomIds.includes(roomId)) ? roomId : "";

  const rows = iid
    ? await attendanceOn(iid, day, {
        accountId: session.accountId,
        roomId: effectiveRoomId || undefined,
        search: q || undefined,
      })
    : [];

  // KID-494: the current bus status per child, served in one indexed query.
  const busByChild = iid ? await busStatusByChild(iid, day) : {};

  // KID-1329: the center's parent check-in/out toggle hides the
  // per-row parent self-service control here too (staff keep theirs).
  const showParentAction = session.role !== "parent" || !iid || (await parentCheckInOutAllowed(String(iid)));

  return (
    <div>
      <h1 className="title">{tr(dict, "attendance.title")}</h1>
      <p className="subtitle">
        {tr(dict, "attendance.subtitle", { date: fmtDateFor(locale, day, timeZone) })}
      </p>
      {searchParams.sweep === "1" && (
        <p className="small" style={{ color: "#047857", fontWeight: 600 }}>
          {tr(dict, "attendance.sweepComplete", {
            total: (sweep?.children.length ?? 0) + (sweep?.staff.length ?? 0),
            children: sweep?.children.length ?? 0,
            staff: sweep?.staff.length ?? 0,
          })}
        </p>
      )}
      {sweep && (sweep.children.length > 0 || sweep.staff.length > 0 || sweep.busOff.length > 0) && (
        <p className="small muted">
          {tr(dict, "attendance.autoCheckoutRun", {
            time: fmtTimeFor(locale, sweep.at, timeZone),
            names:
              sweep.children.map((c: any) => `${c.first_name} ${c.last_name}`).join(", ") +
              (sweep.children.length > 0 && sweep.staff.length > 0 ? " — " : "") +
              sweep.staff.map((s: any) => `${s.full_name}`).join(", ") +
              (sweep.staff.length > 0 ? " " + tr(dict, "attendance.staffSuffix") : ""),
          })}
          {sweep.busOff.length > 0 && (
            <>
              {" "}
              {tr(dict, "attendance.busAutoOff", {
                names: sweep.busOff.map((c: any) => `${c.first_name} ${c.last_name}`).join(", "),
              })}
            </>
          )}
        </p>
      )}

      <form className="card mb-4" method="get">
        <input type="hidden" name="day" value={day} />
        <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <div className="col field" style={{ minWidth: 180 }}>
            <label className="label">{tr(dict, "attendance.searchLabel")}</label>
            <input className="input" name="q" defaultValue={q} placeholder={tr(dict, "attendance.searchPlaceholder")} />
          </div>
          <div className="col field" style={{ minWidth: 180 }}>
            <label className="label">{tr(dict, "common.room")}</label>
            <select className="select" name="room" defaultValue={effectiveRoomId}>
              <option value="">{tr(dict, "attendance.allRooms")}</option>
              {visibleRooms.map((r: any) => (
                <option key={r.id} value={String(r.id)}>{String(r.name)}</option>
              ))}
            </select>
          </div>
          <div>
            <button className="btn btn-ghost" type="submit">{tr(dict, "attendance.filter")}</button>
          </div>
          {(q || effectiveRoomId) && (
            <Link href="/portal/attendance" className="btn btn-ghost">{tr(dict, "attendance.clear")}</Link>
          )}
        </div>
      </form>

      <table className="data">
        <thead>
          <tr>
            <th>{tr(dict, "common.child")}</th>
            <th>{tr(dict, "common.room")}</th>
            <th>{tr(dict, "common.status")}</th>
            <th>{tr(dict, "attendance.colBus")}</th>
            <th>{tr(dict, "attendees.checkedIn")}</th>
            <th>{tr(dict, "attendees.checkedOut")}</th>
            <th>{tr(dict, "common.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => {
            const bus = busByChild[String(r.id)];
            // KID-2448: the phase comes from the day's event count, so the
            // roster can tell the morning and afternoon on-bus states apart.
            const phase = bus ? busPhaseForCount(Number(bus.day_count ?? 0)) : null;
            const busLabel =
              phase === "morning_on" ? tr(dict, "attendance.busOnMorning")
              : phase === "morning_off" ? tr(dict, "attendance.busOffMorning")
              : phase === "afternoon_on" ? tr(dict, "attendance.busOnAfternoon")
              : phase === "afternoon_off" ? tr(dict, "attendance.busOffAfternoon")
              : null;
            return (
              <tr key={r.id}>
                <td><strong>{r.first_name} {r.last_name}</strong></td>
                <td>{r.room_name ?? "—"}</td>
                <td>
                  {r.last_event === "in" ? <span className="badge badge-green">{tr(dict, "attendees.checkedIn")}</span>
                  : r.last_event === "out" ? <span className="badge badge-gray">{tr(dict, "attendees.checkedOut")}</span>
                  : <span className="badge">{tr(dict, "attendance.absent")}</span>}
                </td>
                <td>
                  {busLabel ? (
                    <span className={`badge ${phase === "morning_on" || phase === "afternoon_on" ? "badge-green" : "badge-gray"}`}>
                      {busLabel}
                    </span>
                  ) : (
                    <span className="badge">—</span>
                  )}
                </td>
                <td className="small">
                  {fmtTimeFor(locale, r.checked_in_at, timeZone)}
                  {r.checked_in_source === "bus" && (
                    <> <span className="badge badge-gray">{tr(dict, "attendance.busSource")}</span></>
                  )}
                </td>
                <td className="small">
                  {fmtTimeFor(locale, r.checked_out_at, timeZone)}
                  {r.checked_out_source === "bus" && (
                    <> <span className="badge badge-gray">{tr(dict, "attendance.busSource")}</span></>
                  )}
                  {r.checked_out_source === AUTO_CHECKOUT_SOURCE && r.checked_out_at && (
                    <span className="badge badge-gray" style={{ marginLeft: 6 }}>
                      {tr(dict, "attendance.autoCheckoutBadge")}
                    </span>
                  )}
                </td>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    {showParentAction && (
                      <AttendanceCheckIn
                        childId={r.id as string}
                        lastEvent={r.last_event}
                        labels={{
                          checkIn: tr(dict, "attendees.checkIn"),
                          checkOut: tr(dict, "attendees.checkOut"),
                          saving: tr(dict, "common.saving"),
                        }}
                      />
                    )}
                    <BusStatusButtons
                      childId={r.id as string}
                      busEvent={
                        bus
                          ? {
                              type: String(bus.type),
                              auto: Number(bus.auto) === 1,
                              phase,
                              dayCount: Number(bus.day_count ?? 0),
                            }
                          : undefined
                      }
                      labels={{
                        onMorning: tr(dict, "attendance.busOnMorning"),
                        offMorning: tr(dict, "attendance.busOffMorning"),
                        onAfternoon: tr(dict, "attendance.busOnAfternoon"),
                        offAfternoon: tr(dict, "attendance.busOffAfternoon"),
                        complete: tr(dict, "attendance.busCycleComplete"),
                        errors: {
                          off_without_on: tr(dict, "attendance.busErrorOffWithoutOn"),
                          on_before_off: tr(dict, "attendance.busErrorOnBeforeOff"),
                          cycle_complete: tr(dict, "attendance.busErrorCycleComplete"),
                          unknown: tr(dict, "attendance.busErrorCycleComplete"),
                        },
                      }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted small mt-3">{tr(dict, "attendance.empty")}</p>}
    </div>
  );
}
