import Link from "next/link";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { staffIdForAccount } from "@/lib/auth";
import { isAdminRole } from "@/lib/role";
import { listStaff, listRooms,staffRooms } from "@/lib/store";
import { queryAll } from "@/lib/db";
import Avatar from "@/components/Avatar";
import ResendActivationButton from "@/components/ResendActivationButton";
import { getBranding } from "@/lib/theme";
import AddStaffForm from "./AddStaffForm";
import { recordToolUsage } from "@/lib/tool-usage";
import { signedUrlsForRefs } from "@/lib/storage";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr, type Dict } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const ROLES = ["Owner", "Admin", "Teacher", "Carer", "Caregiver"];
const ROLE_LABEL_KEY: Record<string, string> = {
  owner: "roles.owner",
  admin: "roles.admin",
  teacher: "staff.roleTeacher",
  carer: "roles.carer",
  caregiver: "staff.roleCaregiver",
};
const STATUS_KIND_KEY: Record<string, string> = {
  checkin: "attendees.checkedIn",
  sick: "profile.sick",
  vacation: "staff.statusVacation",
  absent: "staff.statusAbsent",
  child_sick: "staff.statusChildSick",
};

function roleLabel(dict: Dict, role: unknown): string {
  const key = ROLE_LABEL_KEY[String(role ?? "").toLowerCase()];
  return key ? tr(dict, key) : String(role ?? "");
}

export default async function PortalStaffPage(
  props: {
    searchParams?: Promise<{ added?: string; email?: string; q?: string; role?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const iid = await resolveTenantInstituteId();
  await recordToolUsage({ instituteId: String(iid ?? "") || null, accountId: session.accountId, toolKey: "staff", source: "portal", metadata: null });
  const [staff, rooms] = await Promise.all([
    iid ? listStaff(iid) : Promise.resolve([]),
    iid ? listRooms(iid) : Promise.resolve([]),
  ]);

  // KID-105 #13: staff can only see their own profile, not the team list.
  if (!isAdminRole(session.role)) {
    const myStaffId = await staffIdForAccount(session.accountId);
    if (myStaffId) {
      redirect(`/portal/staff/${myStaffId}`);
    }
    // A non-admin without a linked staff record has nothing to see here.
    return <p className="muted">{tr(dict, "staff.noProfileLinked")}</p>;
  }

  const branding = await getBranding();
  const roomAccess = await Promise.all(staff.map((s) => staffRooms(s.id)));
  const roomByName = Object.fromEntries(roomAccess.map((rooms, i) => [staff[i].id, rooms]));
  const logins = await queryAll("SELECT staff_id, email, email_confirmed FROM account WHERE staff_id IS NOT NULL");
  const emailByStaff = Object.fromEntries(logins.map((l) => [String(l.staff_id), String(l.email)]));
  // KID-113: unactivated login accounts (email confirmation still pending)
  // surface a "Resend activation" affordance next to the role. Activated
  // accounts and staff without a login show nothing extra.
  const unactivatedByStaff = new Set(
    logins.filter((l) => Number(l.email_confirmed) === 0).map((l) => String(l.staff_id))
  );

  const q = (searchParams?.q ?? "").toLowerCase();
  const roleFilter = searchParams?.role ?? "";
  const rows = staff.filter((s: any) => {
    if (roleFilter && s.role !== roleFilter.toLowerCase()) return false;
    if (q) {
      const hay = `${s.full_name} ${emailByStaff[s.id] ?? ""} ${String(s.role)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const counts = Object.fromEntries(ROLES.map((r) => [r, staff.filter((s: any) => capital(s.role) === r).length]));
  // KID-1177: photo refs resolve to signed URLs before the render loop.
  const staffAvatarSrcs = await signedUrlsForRefs(rows.map((s: any) => String(s.photo_url ?? "")));

  const addStaffLabels = {
    title: tr(dict, "staff.addFormTitle"),
    hint: tr(dict, "staff.addFormHint"),
    fullNameLabel: tr(dict, "profile.fullName"),
    roleLabel: tr(dict, "staff.roleLabel"),
    carer: tr(dict, "roles.carer"),
    admin: tr(dict, "roles.admin"),
    emailLabel: tr(dict, "staff.emailLabel"),
    emailPlaceholder: tr(dict, "staff.emailPlaceholder"),
    passwordLabel: tr(dict, "children.createParentLoginPassword"),
    passwordPlaceholder: tr(dict, "staff.passwordPlaceholder"),
    generate: tr(dict, "children.createParentLoginGenerate"),
    roomAccess: tr(dict, "staff.roomAccess"),
    submit: tr(dict, "staff.addFormSubmit"),
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="title" style={{ marginBottom: 0 }}>{tr(dict, "staff.title")}</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>{tr(dict, "staff.subtitle")}</p>
        </div>
        <AddStaffButton
          rooms={rooms.map((r) => ({ id: String(r.id), name: String(r.name) }))}
          addStaffBtn={tr(dict, "staff.addStaffBtn")}
          labels={addStaffLabels}
        />
      </div>

      {searchParams?.added ? (
        <div className="card mb-4" role="status" style={{ borderColor: "var(--brand-accent)" }}>
          <strong>{tr(dict, "staff.addedBannerTitle")}</strong>{" "}
          <span className="muted small">
            {searchParams.email
              ? tr(dict, "staff.addedBannerWithLogin", { email: searchParams.email })
              : tr(dict, "staff.addedBannerNoLogin")}
          </span>
        </div>
      ) : null}

      {/* #8(c) "Access roles" panel: one chip per role with live member counts */}
      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "staff.accessRoles")}</h3>
        <div className="row" style={{ gap: 8 }}>
          {ROLES.map((r) => (
            <span key={r} className={roleFilter === r.toLowerCase() ? "badge badge-red" : "badge badge-gray"} style={{ padding: "6px 12px" }}>
              {roleLabel(dict, r)} · {counts[r] ?? 0}
            </span>
          ))}
        </div>
      </div>

      <div className="card mb-4">
        <form method="get" className="row" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" name="q" defaultValue={searchParams?.q ?? ""} placeholder={tr(dict, "staff.searchPlaceholder")} style={{ minWidth: 260 }} />
            <select className="select" name="role" defaultValue={roleFilter} style={{ maxWidth: 150 }}>
              <option value="">{tr(dict, "staff.allRoles")}</option>
              {ROLES.map((r) => (
                <option key={r} value={r.toLowerCase()}>{roleLabel(dict, r)}</option>
              ))}
            </select>
          </div>
          <div>
            <button className="btn btn-ghost small" type="submit">{tr(dict, "staff.apply")}</button>
            <Link className="btn btn-ghost small" href="/portal/staff">{tr(dict, "staff.clear")}</Link>
          </div>
        </form>
      </div>

      <div className="card">
        <table className="data">
          <thead>
            <tr><th>{tr(dict, "common.name")}</th><th>{tr(dict, "staff.colAccess")}</th><th>{tr(dict, "staff.colClassrooms")}</th><th>{tr(dict, "common.status")}</th><th>{tr(dict, "common.actions")}</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="muted small">{tr(dict, "staff.empty")}</td></tr>
            ) : null}
            {rows.map((s: any) => (
              <tr key={s.id}>
                <td className="row" style={{ alignItems: "center", gap: 10 }}>
                  <Avatar src={staffAvatarSrcs.get(String(s.photo_url ?? "")) ?? s.photo_url} name={s.full_name} size={32} color={branding.primaryColor} />
                  <div>
                    <Link href={`/portal/staff/${s.id}`} style={{ fontWeight: 700, color: "inherit" }}>{s.full_name}</Link>
                    <div className="muted small">{s.email ? s.email : (emailByStaff[s.id] ?? "") || tr(dict, "staff.noLoginYet")}</div>
                  </div>
                </td>
                <td>
                  <div>{roleLabel(dict, s.role)}</div>
                  {unactivatedByStaff.has(String(s.id)) && emailByStaff[s.id] ? (
                    <ResendActivationButton email={emailByStaff[s.id]} />
                  ) : null}
                </td>
                <td className="small">{(roomByName[s.id] ?? []).map((r: any) => String(r.name)).join(", ") || "—"}</td>
                <td>
                  {s.status && STATUS_KIND_KEY[s.status] ? (
                    <span className={`badge ${s.status === "checkin" ? "badge-green" : s.status === "sick" || s.status === "child_sick" ? "badge-red" : "badge-gray"}`}>{tr(dict, STATUS_KIND_KEY[s.status])}</span>
                  ) : (
                    <span className={s.active ? "badge badge-green" : "badge badge-red"}>{s.active ? tr(dict, "profile.active") : tr(dict, "staff.inactive")}</span>
                  )}
                </td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <Link className="btn btn-ghost small" href={`/portal/staff/${s.id}`}>{tr(dict, "staff.profileBtn")}</Link>
                    <Link className="btn btn-ghost small" href={`/portal/staff/${s.id}?edit=status`}>{tr(dict, "staff.setStatusBtn")}</Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted mt-2">{tr(dict, "staff.footerCount", { staff: rows.length, rooms: rooms.length })}</p>
      </div>
    </div>
  );
}

function AddStaffButton({
  rooms,
  addStaffBtn,
  labels,
}: {
  rooms: { id: string; name: string }[];
  addStaffBtn: string;
  labels: React.ComponentProps<typeof AddStaffForm>["labels"];
}) {
  return (
    <details style={{ position: "relative" }}>
      <summary className="btn btn-primary" style={{ cursor: "pointer", listStyle: "none" }}>{addStaffBtn}</summary>
      <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 520, maxWidth: "90vw" }}>
        <AddStaffForm rooms={rooms} labels={labels} />
      </div>
    </details>
  );
}

function capital(s: unknown) { const v = String(s ?? ""); return v.charAt(0).toUpperCase() + v.slice(1); }
