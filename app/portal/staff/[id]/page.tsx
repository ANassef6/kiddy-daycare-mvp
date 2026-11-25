import Link from "next/link";
import { storageSrcFor } from "@/lib/storage";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { staffIdForAccount } from "@/lib/auth";
import { isAdminRole } from "@/lib/role";
import { listStaff, staffRooms, listStaffSchedules, staffStatusLog, staffActivity, listRooms } from "@/lib/store";
import { queryAll } from "@/lib/db";
import { uploadPhotoAction, updateStaffInfoAction, linkStaffLoginAction } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import ResendActivationButton from "@/components/ResendActivationButton";
import ChildProfileTabs from "@/components/ChildProfileTabs";
import MediaUploadForm from "@/components/MediaUploadForm";
import { mediaUploadLabels } from "@/lib/media-i18n";
import { MAX_PHOTO_UPLOAD_BYTES } from "@/lib/media-limits";
import { StaffStatusForm } from "@/components/StaffStatusForm";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr, fmtDateFor, fmtDateTimeFor, type Dict, type Locale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const ROLE_LABEL_KEY: Record<string, string> = {
  owner: "roles.owner",
  admin: "roles.admin",
  teacher: "staff.roleTeacher",
  carer: "roles.carer",
  caregiver: "staff.roleCaregiver",
};
const STATUS_KIND_KEY: Record<string, string> = {
  checkin: "attendees.checkedIn",
  out: "attendees.checkedOut",
  sick: "profile.sick",
  vacation: "staff.statusVacation",
  absent: "staff.statusAbsent",
  child_sick: "staff.statusChildSick",
};

function roleLabel(dict: Dict, role: unknown): string {
  const key = ROLE_LABEL_KEY[String(role ?? "").toLowerCase()];
  return key ? tr(dict, key) : String(role ?? "");
}

export default async function StaffProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ edit?: string; linked?: string; existing?: string; error?: string }> }) {
  const { id: staffIdParam } = await params;
  const search = (await searchParams) ?? {};
  const session = await requireSession();
  const { dict, locale } = await i18nForAccount(session.accountId);
  const iid = await resolveTenantInstituteId();
  // KID-2450: server-side photo cap refusal (old clients / direct posts).
  const photoError = search.error === "photoType" || search.error === "photoSize";

  // KID-105 #13: staff can only view their own profile.
  if (!isAdminRole(session.role)) {
    const myStaffId = await staffIdForAccount(session.accountId);
    if (myStaffId && myStaffId !== staffIdParam) {
      redirect(`/portal/staff/${myStaffId}`);
    }
    if (!myStaffId) {
      return <p className="muted">{tr(dict, "staff.noProfileLinked")}</p>;
    }
  }

  const staff = iid ? (await listStaff(iid)).find((s: any) => String(s.id) === staffIdParam) : undefined;
  if (!staff) notFound();
  const [rooms, schedules, logins, statusLog, activity] = await Promise.all([
    staffRooms(staff.id),
    listStaffSchedules(staff.id),
    queryAll("SELECT email, email_confirmed FROM account WHERE staff_id = ?", staff.id),
    staffStatusLog(staff.id),
    staffActivity(staff.id),
  ]);
  const email = staff.email ?? (logins[0] as any)?.email as string | undefined;
  // KID-171 (D2): `logins` is the account→staff link. No entry means this staff
  // record is invisible to `classroomStaffForParent`, so no parent in their
  // classrooms can message them at all.
  const hasLogin = logins.length > 0;
  // KID-113: show "Resend activation" next to the role only while the linked
  // login account is still unconfirmed.
  const staffUnactivated = email != null && Number((logins[0] as any)?.email_confirmed) === 0;

  const tabs = [
    {
      id: "profile",
      label: tr(dict, "staff.tabProfile"),
      node: profileTab(staff, rooms, email, statusLog, activity, search.edit, hasLogin, {
        linked: search.linked,
        existing: search.existing,
        error: search.error,
      }, dict, locale),
    },
    { id: "calendar", label: tr(dict, "nav.calendar"), node: calendarTab(schedules, dict, locale) },
  ];

  return (
    <div>
      <Link className="small muted" href="/portal/staff">← {tr(dict, "nav.staff")}</Link>
      {photoError && (
        <div role="alert" className="card mt-3" style={{ borderLeft: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{tr(dict, "profile.photoError")}</p>
        </div>
      )}
      <div className="row mt-2" style={{ alignItems: "center", gap: 12 }}>
        <Avatar src={await storageSrcFor(staff.photo_url)} name={staff.full_name} size={52} />
        <div style={{ flex: 1 }}>
          <h1 className="title" style={{ margin: 0 }}>{staff.full_name}</h1>
          <div className="subtitle">{roleLabel(dict, staff.role)} · {email ?? tr(dict, "staff.noLoginYet")} · {(rooms as any[]).map((r: any) => r.name).join(", ") || tr(dict, "staff.noRooms")}{staffUnactivated && email ? (<> · <ResendActivationButton email={email} /></>) : null}</div>
        </div>
        <MediaUploadForm
          action={uploadPhotoAction}
          encType="multipart/form-data"
          className="row"
          style={{ gap: 8, alignItems: "center" }}
          maxImageBytes={MAX_PHOTO_UPLOAD_BYTES}
          labels={mediaUploadLabels(dict)}
          directUpload={{ purpose: "photo", entityType: "staff", entityId: String(staff.id) }}
        >
          <input type="hidden" name="entityType" value="staff" />
          <input type="hidden" name="entityId" value={String(staff.id)} />
          <input type="file" name="file" accept="image/*" required style={{ maxWidth: 180 }} />
          <button className="btn btn-ghost small" type="submit">{tr(dict, "account.uploadPhoto")}</button>
        </MediaUploadForm>
      </div>

      <div className="mt-3">
        <ChildProfileTabs tabs={tabs} />
      </div>
    </div>
  );
}

function statusCard(staff: any, dict: Dict, locale: Locale) {
  const current = (staff.status && STATUS_KIND_KEY[staff.status]) ? tr(dict, STATUS_KIND_KEY[staff.status]) : (staff.active ? tr(dict, "profile.active") : tr(dict, "staff.inactive"));
  const tone =
    staff.status === "checkin" ? "green"
    : staff.status === "out" ? "gray"
    : staff.status === "sick" || staff.status === "child_sick" ? "red"
    : staff.status ? "gray"
    : staff.active ? "green" : "red";
  return (
    <div className="card mb-4" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div className="small muted">{tr(dict, "staff.currentStatus")}</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>
          <span className={`badge badge-${tone}`}>{current}</span>
        </div>
        {staff.status_note && <div className="muted small mt-1">{staff.status_note}</div>}
        {staff.status_at && <div className="muted small">{tr(dict, "staff.since", { datetime: fmtDateTimeFor(locale, staff.status_at) })}</div>}
      </div>
      <StaffStatusForm
        staffId={String(staff.id)}
        current={staff.status ?? ""}
        labels={{
          placeholder: tr(dict, "staff.statusPlaceholder"),
          options: {
            checkin: tr(dict, "attendees.checkedIn"),
            sick: tr(dict, "profile.sick"),
            vacation: tr(dict, "staff.statusVacation"),
            absent: tr(dict, "staff.statusAbsent"),
            child_sick: tr(dict, "staff.statusChildSick"),
          },
          notesPlaceholder: tr(dict, "staff.statusNotesPlaceholder"),
          update: tr(dict, "staff.updateBtn"),
          saving: tr(dict, "common.saving"),
        }}
      />
    </div>
  );
}

// KID-171 (D2): every refusal `linkStaffLoginAction` can make, said in words.
// The action only ever redirects, so without this the admin saw the same page
// back with no idea why.
const LINK_ERROR_KEY: Record<string, string> = {
  email: "staff.linkErrorEmail",
  password: "staff.linkErrorPassword",
  belongs: "staff.linkErrorBelongs",
  notfound: "staff.linkErrorNotfound",
  link: "staff.linkErrorLink",
};

function profileTab(
  staff: any,
  rooms: any[],
  email: string | undefined,
  statusLog: any[],
  activity: any,
  editing: string | undefined,
  hasLogin: boolean,
  loginFeedback: { linked?: string; existing?: string; error?: string },
  dict: Dict,
  locale: Locale
) {
  const infoRows: [string, any][] = [
    [tr(dict, "profile.fullName"), staff.full_name],
    [tr(dict, "staff.roleLabel"), staff.role ? roleLabel(dict, staff.role) : "—"],
    [tr(dict, "common.email"), email ?? "—"],
    [tr(dict, "common.phone"), staff.phone ?? "—"],
    [tr(dict, "staff.colClassrooms"), rooms.map((r) => r.name).join(", ") || "—"],
    [tr(dict, "staff.bio"), staff.bio || "—"],
    [tr(dict, "staff.memberSince"), staff.created_at ? fmtDateFor(locale, staff.created_at) : "—"],
    [tr(dict, "profile.lastDate"), staff.last_date ? fmtDateFor(locale, staff.last_date) : "—"],
  ];
  const openEdit = editing === "status" || editing === "info";
  const linkError = loginFeedback.error ? (LINK_ERROR_KEY[loginFeedback.error] ? tr(dict, LINK_ERROR_KEY[loginFeedback.error]) : tr(dict, "staff.linkErrorLink")) : null;
  return (
    <div>
      {statusCard(staff, dict, locale)}

      {/* KID-171 (D2): a staff record with no login cannot be messaged by any
          parent in its classrooms, and there was no way to fix that from the UI
          — `addStaffAction` only creates new staff records. */}
      {!hasLogin ? (
        <div className="card mb-4">
          <h3 className="subtitle">{tr(dict, "staff.portalLoginTitle")}</h3>
          <p className="muted small">{tr(dict, "staff.portalLoginHint")}</p>
          {loginFeedback.linked ? (
            <p className="small" role="status" style={{ color: "#047857" }}>
              {loginFeedback.existing
                ? tr(dict, "staff.linkSuccessExisting")
                : tr(dict, "staff.linkSuccessCreated")}
            </p>
          ) : null}
          {linkError ? (
            <p className="form-error small" role="alert" data-testid="staff-link-error">
              {linkError}
            </p>
          ) : null}
          <form action={linkStaffLoginAction} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="staffId" value={String(staff.id)} />
            <input className="input" name="email" type="email" placeholder={tr(dict, "staff.loginEmailPlaceholder")} defaultValue={email ?? ""} required />
            <input className="input" name="password" type="password" placeholder={tr(dict, "staff.loginPasswordPlaceholder")} required />
            <button className="btn btn-primary small" type="submit">{tr(dict, "staff.createLoginBtn")}</button>
          </form>
          <p className="small muted">{tr(dict, "staff.portalLoginFootnote")}</p>
        </div>
      ) : null}

      <div className="card mb-4">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="subtitle">{tr(dict, "staff.registrationTitle")}</h3>
          <details open>
            <summary className="btn btn-ghost small" style={{ cursor: "pointer", listStyle: "none" }}>{openEdit ? tr(dict, "staff.closeEditorBtn") : tr(dict, "staff.editBasicInfoBtn")}</summary>
            <form action={updateStaffInfoAction} className="mt-2">
              <input type="hidden" name="staffId" value={String(staff.id)} />
              <div className="row">
                <div className="col field"><label className="label">{tr(dict, "profile.fullName")}</label><input className="input" name="fullName" defaultValue={staff.full_name} /></div>
                <div className="col field"><label className="label">{tr(dict, "staff.roleLabel")}</label>
                  <select className="select" name="role" defaultValue={staff.role ?? "carer"}>
                    <option value="carer">{tr(dict, "roles.carer")}</option>
                    <option value="admin">{tr(dict, "roles.admin")}</option>
                    <option value="owner">{tr(dict, "roles.owner")}</option>
                  </select>
                </div>
              </div>
              <div className="row">
                <div className="col field"><label className="label">{tr(dict, "common.email")}</label><input className="input" name="email" type="email" defaultValue={email ?? ""} /></div>
                <div className="col field"><label className="label">{tr(dict, "common.phone")}</label><input className="input" name="phone" defaultValue={staff.phone ?? ""} /></div>
              </div>
              <div className="field"><label className="label">{tr(dict, "staff.bio")}</label><textarea className="textarea" name="bio" defaultValue={staff.bio ?? ""} /></div>
              <div className="row">
                <div className="col field">
                  <label className="label">{tr(dict, "profile.lastDate")}</label>
                  <input className="input" name="lastDate" type="date" defaultValue={staff.last_date ? String(staff.last_date).slice(0, 10) : ""} />
                </div>
              </div>
              <p className="small muted">{tr(dict, "staff.lastDateHint")}</p>
              <div className="field">
                <label className="label">{tr(dict, "staff.roomAccess")}</label>
                <div className="row">
                  {rooms.length === 0 && <span className="muted small">{tr(dict, "staff.noRoomsConfigured")}</span>}
                  {/* re-render via rooms prop; handled below */}
                </div>
              </div>
              <RoomsCheckboxes staffId={String(staff.id)} />
              <button className="btn btn-primary small" type="submit">{tr(dict, "profile.saveChanges")}</button>
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
          <h3 className="subtitle">{tr(dict, "staff.statusHistoryTitle")}</h3>
          {statusLog.length === 0 ? <p className="muted small">{tr(dict, "staff.emptyStatusHistory")}</p> : null}
          {statusLog.map((s: any) => (
            <div className="list-item small" key={s.id}>
              <span className={`badge ${s.status === "checkin" ? "badge-green" : s.status === "sick" || s.status === "child_sick" ? "badge-red" : "badge-gray"}`}>
                {(s.status && STATUS_KIND_KEY[s.status]) ? tr(dict, STATUS_KIND_KEY[s.status]) : String(s.status ?? "")}
              </span>
              <span className="muted">{s.note ? `${s.note} · ` : ""}{s.changed_by_name ? `${s.changed_by_name} · ` : ""}{fmtDateTimeFor(locale, s.created_at)}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3 className="subtitle">{tr(dict, "staff.activityTitle")}</h3>
          {[
            [tr(dict, "performance.metricPosts"), activity.posts],
            [tr(dict, "performance.metricMedia"), activity.media],
            [tr(dict, "performance.metricMessages"), activity.messages],
            [tr(dict, "performance.metricObservations"), activity.observations],
            [tr(dict, "performance.metricAssessments"), activity.assessments],
            [tr(dict, "staff.metricTwoYearChecks"), activity.twoYearChecks],
            [tr(dict, "staff.metricReports"), activity.reports],
            [tr(dict, "staff.metricCheckIns"), activity.checkIns],
            [tr(dict, "staff.metricIncidents"), activity.incidents],
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
  const iid = await resolveTenantInstituteId();
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

const CALENDAR_DAY_KEY = [
  "staff.daySun",
  "staff.dayMon",
  "staff.dayTue",
  "staff.dayWed",
  "staff.dayThu",
  "staff.dayFri",
  "staff.daySat",
];

function calendarTab(schedules: any[], dict: Dict, locale: Locale) {
  return (
    <div className="card">
      <h3 className="subtitle">{tr(dict, "staff.weeklyScheduleTitle")}</h3>
      {schedules.length === 0 && <p className="muted small">{tr(dict, "staff.noShiftsYet")}</p>}
      {schedules.map((s: any) => (
        <div className="list-item" key={s.id}>
          <span className="small">
            <strong>
              {s.schedule_date
                ? fmtDateFor(locale, s.schedule_date)
                : CALENDAR_DAY_KEY[Number(s.day_of_week)]
                  ? tr(dict, CALENDAR_DAY_KEY[Number(s.day_of_week)])
                  : s.day_of_week}
            </strong>{" "}
            · {s.start_time}–{s.end_time}
            {Array.isArray(s.room_names) && s.room_names.length > 0
              ? ` · ${tr(dict, "staff.roomsPrefix", { rooms: s.room_names.join(", ") })}`
              : ""}
            {s.notes ? ` — ${s.notes}` : ""}
          </span>
        </div>
      ))}
      <Link className="btn btn-ghost small mt-2" href="/portal/staff/schedule">{tr(dict, "staff.manageScheduleBtn")}</Link>
    </div>
  );
}
