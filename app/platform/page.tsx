// KID-199.4: the platform operator's daycare list. Plain server-rendered
// table (this repo has no client data-fetching libs) — every daycare with its
// brand color, created date, owner/staff counts and an enable/disable toggle,
// plus the create-daycare form underneath.
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { isPlatformOperatorEmail, isPlatformOperatorRole, PLATFORM_THEME_KEYS } from "@/lib/platform";
import { listInstitutesForPlatform } from "@/lib/store";
import { setDaycareActiveAction, createDaycareAction, updateDaycareSubdomainAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { apexDomain } from "@/lib/subdomain";

export const dynamic = "force-dynamic";

/** Friendly labels for the create-daycare failure reasons the action
 *  redirects back with (see createDaycareAction). */
const ERRORS: Record<string, string> = {
  name: "Enter a daycare name.",
  "owner-email": "Enter a valid email for the first owner account.",
  "owner-email-in-use": "That email already has an account. Use a different one.",
  password: "The owner password must be at least 8 characters.",
  // KID-199.3r: subdomain edit/create failures.
  "subdomain-taken": "That subdomain is already used by another daycare.",
  "subdomain-invalid": "Use letters, numbers and hyphens only for the subdomain.",
  unknown: "Something went wrong creating the daycare. Please try again.",
};

export default async function PlatformDaycaresPage({
  searchParams,
}: {
  searchParams: { created?: string; error?: string };
}) {
  const session = requireSession();
  // Same double check as the layout + every server action: internal sentinel
  // session AND the env allowlist (KID-199.4r — accessing is not a role).
  if (!isPlatformOperatorRole(session.role) || !isPlatformOperatorEmail(session.email)) {
    redirect("/login");
  }
  const { dict, dir } = await i18nForAccount(session.accountId);
  const institutes = await listInstitutesForPlatform();
  const created = searchParams.created === "1";
  const createError = searchParams.error ? (ERRORS[searchParams.error] ?? ERRORS.unknown) : "";
  // KID-199.3r: the apex is deployment configuration; when set, the operator
  // sees the full host each daycare resolves on.
  const apex = apexDomain();

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
            <th className="label" style={{ padding: 8 }}>{tr(dict, "platform.subdomain")}</th>
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
                {/* KID-199.3r: the wildcard subdomain and its full host, editable
                    inline. Blank = not reachable on any subdomain yet. */}
                <td style={{ padding: 8 }}>
                  <form action={updateDaycareSubdomainAction} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="hidden" name="instituteId" value={String(inst.id)} />
                    <input
                      className="input"
                      name="subdomain"
                      defaultValue={String(inst.subdomain ?? "")}
                      placeholder="sunshine"
                      style={{ width: 160, marginBottom: 0 }}
                      aria-label={`${tr(dict, "platform.subdomain")}: ${String(inst.name)}`}
                    />
                    <button className="btn" type="submit">{tr(dict, "platform.subdomainSave")}</button>
                  </form>
                  {apex && inst.subdomain ? (
                    <span className="small muted">{String(inst.subdomain)}.{apex}</span>
                  ) : null}
                </td>
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
            {/* KID-199.3r: the daycare's wildcard subdomain; blank derives a
                slug from the name, collisions get -2/-3 suffixes. */}
            <label className="label">{tr(dict, "platform.subdomain")}</label>
            <input className="input" name="subdomain" placeholder="e.g. sunshine" />
            <span className="small muted">{tr(dict, "platform.subdomainHint")}</span>
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
            {/* KID-199.4r: number of branches — the create action makes one
                branch row per branch ("Main" first; clamped server-side). */}
            <label className="label">{tr(dict, "platform.branches")}</label>
            <input className="input" name="branches" type="number" min={1} max={20} defaultValue={1} />
          </div>
          <div className="col field">
            {/* KID-199.4r: logo upload feeds the same storage path as the
                settings branding upload; the URL is persisted to
                institute.logo_url so the tenant branding renders it. */}
            <label className="label">{tr(dict, "platform.logo")}</label>
            <input className="input" name="logo" type="file" accept="image/*" />
          </div>
        </div>
        <div className="row">
          <div className="col field">
            {/* KID-199.4r: theme picker over the existing branding tokens;
                "custom" reveals the raw color fields. Server-side, no JS needed
                because the action maps presets to the tokens. */}
            <label className="label">{tr(dict, "platform.theme")}</label>
            <select className="input" name="theme" defaultValue={PLATFORM_THEME_KEYS[0]}>
              {PLATFORM_THEME_KEYS.map((key) => (
                <option key={key} value={key}>
                  {tr(dict, `platform.theme${key[0].toUpperCase()}${key.slice(1)}`)}
                </option>
              ))}
              <option value="custom">{tr(dict, "platform.themeCustom")}</option>
            </select>
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
