import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { staffIdForAccount } from "@/lib/auth";
import { isAdminRole } from "@/lib/role";
import { listStaff, listRooms, listInstitutes, staffRooms } from "@/lib/store";
import { queryAll } from "@/lib/db";
import Avatar from "@/components/Avatar";
import ResendActivationButton from "@/components/ResendActivationButton";
import { getBranding } from "@/lib/theme";
import AddStaffForm from "./AddStaffForm";

export const dynamic = "force-dynamic";

const ROLES = ["Owner", "Admin", "Teacher", "Carer", "Caregiver"];
const STATUS_KIND_LABEL: Record<string, string> = {
  checkin: "Checked in",
  sick: "Sick",
  vacation: "Vacation",
  absent: "Absent",
  child_sick: "Child sick",
};

export default async function PortalStaffPage({
  searchParams,
}: {
  searchParams?: { added?: string; email?: string; q?: string; role?: string };
}) {
  const session = requireSession();
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
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
    return <p className="muted">No staff profile linked to this account.</p>;
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

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="title" style={{ marginBottom: 0 }}>Staff &amp; access control</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>Manage your team, their classrooms, and their status.</p>
        </div>
        <AddStaffButton rooms={rooms.map((r) => ({ id: String(r.id), name: String(r.name) }))} />
      </div>

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

      {/* #8(c) "Access roles" panel: one chip per role with live member counts */}
      <div className="card mb-4">
        <h3 className="subtitle">Access roles</h3>
        <div className="row" style={{ gap: 8 }}>
          {ROLES.map((r) => (
            <span key={r} className={roleFilter === r.toLowerCase() ? "badge badge-red" : "badge badge-gray"} style={{ padding: "6px 12px" }}>
              {r} · {counts[r] ?? 0}
            </span>
          ))}
        </div>
      </div>

      <div className="card mb-4">
        <form method="get" className="row" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" name="q" defaultValue={searchParams?.q ?? ""} placeholder="Search staff by name, email, or role…" style={{ minWidth: 260 }} />
            <select className="select" name="role" defaultValue={roleFilter} style={{ maxWidth: 150 }}>
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r.toLowerCase()}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <button className="btn btn-ghost small" type="submit">Apply</button>
            <Link className="btn btn-ghost small" href="/portal/staff">Clear</Link>
          </div>
        </form>
      </div>

      <div className="card">
        <table className="data">
          <thead>
            <tr><th>Name</th><th>Access</th><th>Assigned classrooms</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="muted small">No staff match.</td></tr>
            ) : null}
            {rows.map((s: any) => (
              <tr key={s.id}>
                <td className="row" style={{ alignItems: "center", gap: 10 }}>
                  <Avatar src={s.photo_url} name={s.full_name} size={32} color={branding.primaryColor} />
                  <div>
                    <Link href={`/portal/staff/${s.id}`} style={{ fontWeight: 700, color: "inherit" }}>{s.full_name}</Link>
                    <div className="muted small">{s.email ? s.email : (emailByStaff[s.id] ?? "") || "No login yet"}</div>
                  </div>
                </td>
                <td>
                  <div>{capital(s.role)}</div>
                  {unactivatedByStaff.has(String(s.id)) && emailByStaff[s.id] ? (
                    <ResendActivationButton email={emailByStaff[s.id]} />
                  ) : null}
                </td>
                <td className="small">{(roomByName[s.id] ?? []).map((r: any) => String(r.name)).join(", ") || "—"}</td>
                <td>
                  {s.status && STATUS_KIND_LABEL[s.status] ? (
                    <span className={`badge ${s.status === "checkin" ? "badge-green" : s.status === "sick" || s.status === "child_sick" ? "badge-red" : "badge-gray"}`}>{STATUS_KIND_LABEL[s.status]}</span>
                  ) : (
                    <span className={s.active ? "badge badge-green" : "badge badge-red"}>{s.active ? "Active" : "Inactive"}</span>
                  )}
                </td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <Link className="btn btn-ghost small" href={`/portal/staff/${s.id}`}>Profile</Link>
                    <Link className="btn btn-ghost small" href={`/portal/staff/${s.id}?edit=status`}>Set status</Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted mt-2">{rows.length} staff member{rows.length === 1 ? "" : "s"} · {rooms.length} classrooms</p>
      </div>
    </div>
  );
}

function AddStaffButton({ rooms }: { rooms: { id: string; name: string }[] }) {
  return (
    <details style={{ position: "relative" }}>
      <summary className="btn btn-primary" style={{ cursor: "pointer", listStyle: "none" }}>+ Add staff</summary>
      <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 520, maxWidth: "90vw" }}>
        <AddStaffForm rooms={rooms} />
      </div>
    </details>
  );
}

function capital(s: unknown) { const v = String(s ?? ""); return v.charAt(0).toUpperCase() + v.slice(1); }