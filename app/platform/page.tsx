// KID-199.4: the platform operator's daycare list. Plain server-rendered
// table (this repo has no client data-fetching libs) — every daycare with its
// brand color, created date, owner/staff counts and an enable/disable toggle,
// plus the create-daycare form underneath.
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { isSuperadminRole } from "@/lib/role";
import { listInstitutesForPlatform } from "@/lib/store";
import { setDaycareActiveAction, createDaycareAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** Friendly labels for the create-daycare failure reasons the action
 *  redirects back with (see createDaycareAction). */
const ERRORS: Record<string, string> = {
  name: "Enter a daycare name.",
  "owner-email": "Enter a valid email for the first owner account.",
  "owner-email-in-use": "That email already has an account. Use a different one.",
  password: "The owner password must be at least 8 characters.",
  unknown: "Something went wrong creating the daycare. Please try again.",
};

export default async function PlatformDaycaresPage({
  searchParams,
}: {
  searchParams: { created?: string; error?: string };
}) {
  const session = requireSession();
  if (!isSuperadminRole(session.role)) redirect("/login");
  const { dict, dir } = await i18nForAccount(session.accountId);
  const institutes = await listInstitutesForPlatform();
  const created = searchParams.created === "1";
  const createError = searchParams.error ? (ERRORS[searchParams.error] ?? ERRORS.unknown) : "";

  return (
    <div dir={dir}>
      <h1 className="title">{tr(dict, "platform.title")}</h1>
      <p className="subtitle">{tr(dict, "platform.subtitle")}</p>

      {created && (
        <div className="card mb-4" style={{ background: "#ECFDF5", border: "1px solid #10B981" }}>
          {tr(dict, "platform.createdMessage")}
        </div>
      )}
      {createError && (
        <div className="card mb-4" style={{ background: "#FEF2F2", border: "1px solid #EF4444" }}>
          {createError}
        </div>
      )}

      <table className="card" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.daycare")}</th>
            <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.brand")}</th>
            <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.created")}</th>
            <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.owners")}</th>
            <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.staff")}</th>
            <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.status")}</th>
          </tr>
        </thead>
        <tbody>
          {institutes.map((inst) => {
            const active = Number(inst.active ?? 1) === 1;
            return (
              <tr key={String(inst.id)} style={{ borderTop: "1px solid #e5e7eb" }}>
                <td style={{ padding: 8, fontWeight: 700 }}>{String(inst.name)}</td>
                <td style={{ padding: 8 }}>
                  <span
                    aria-label={String(inst.primary_color ?? "")}
                    title={String(inst.primary_color ?? "")}
                    style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: 4, background: String(inst.primary_color ?? "#3B82F6"), display: "inline-block" }} />
                    <span style={{ width: 14, height: 14, borderRadius: 4, background: String(inst.accent_color ?? "#10B981"), display: "inline-block" }} />
                  </span>
                </td>
                <td className="small" style={{ padding: 8 }}>{String(inst.created_at ?? "").slice(0, 10)}</td>
                <td style={{ padding: 8 }}>{Number(inst.owner_count ?? 0)}</td>
                <td style={{ padding: 8 }}>{Number(inst.staff_count ?? 0)}</td>
                <td style={{ padding: 8 }}>
                  <span className="small" style={{ marginRight: 8 }}>
                    {active ? tr(dict, "platform.active") : tr(dict, "platform.disabled")}
                  </span>
                  <form action={setDaycareActiveAction} style={{ display: "inline" }}>
                    <input type="hidden" name="instituteId" value={String(inst.id)} />
                    <input type="hidden" name="active" value={active ? "0" : "1"} />
                    <button className="btn" type="submit">
                      {active ? tr(dict, "platform.disable") : tr(dict, "platform.enable")}
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <form className="card" action={createDaycareAction}>
        <h3 className="subtitle">{tr(dict, "platform.createTitle")}</h3>
        <p className="small muted">{tr(dict, "platform.createHint")}</p>
        <div className="row">
          <div className="col field">
            <label className="label">{tr(dict, "platform.name")}</label>
            <input className="input" name="name" placeholder="e.g. Sunshine Daycare" />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.ownerEmail")}</label>
            <input className="input" name="ownerEmail" type="email" placeholder="owner@daycare.test" />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.ownerPassword")}</label>
            <input className="input" name="ownerPassword" type="password" minLength={8} />
          </div>
        </div>
        <div className="row">
          <div className="col field">
            <label className="label">{tr(dict, "platform.ownerFullName")}</label>
            <input className="input" name="ownerFullName" placeholder="e.g. Maria Lopez" />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.primaryColor")}</label>
            <input className="input" name="primaryColor" placeholder="#3B82F6" pattern="^#[0-9a-fA-F]{6}$" />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.accentColor")}</label>
            <input className="input" name="accentColor" placeholder="#10B981" pattern="^#[0-9a-fA-F]{6}$" />
          </div>
        </div>
        <button className="btn btn-primary" type="submit">{tr(dict, "platform.create")}</button>
      </form>
    </div>
  );
}
