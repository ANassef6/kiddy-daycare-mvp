// KID-199.4: the platform operator's daycare list. Plain server-rendered
// table (this repo has no client data-fetching libs) — every daycare with its
// brand color, created date, owner/staff counts and an enable/disable toggle,
// plus the create-daycare form underneath.
// KID-227: the table scrolls horizontally on narrow screens instead of
// squeezing; success/error banners ride the brand CSS variables; the inline
// subdomain edit is labeled ("Edit prefix"), shows the full public URL with a
// copy button, and a failed save keeps the typed prefix and reports at the
// row; the create form gains native color pickers beside the hex fields.
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { isPlatformOperatorEmail, isPlatformOperatorRole, PLATFORM_THEME_KEYS } from "@/lib/platform";
import { listInstitutesForPlatform } from "@/lib/store";
import { BILLING_DEFAULTS } from "@/lib/billing";
import {
  setDaycareActiveAction,
  createDaycareAction,
  updateDaycareSubdomainAction,
  enterDaycareAsAdminAction,
} from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { apexDomain, daycarePublicUrl, subdomainUrl } from "@/lib/subdomain";
import ColorField from "./color-field";
import CopyUrlButton from "./copy-url-button";

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

/** KID-227: the same reasons, worded for the inline per-row prefix edit —
 *  shown at the row that failed, not as a page-wide create banner. */
const ROW_ERRORS: Record<string, string> = {
  "subdomain-taken": "That web prefix is already used by another daycare.",
  "subdomain-invalid": "Use letters, numbers and hyphens only for the web prefix.",
  "missing-id": "Something went wrong saving the web prefix. Please try again.",
  unknown: "Something went wrong saving the web prefix. Please try again.",
};

/** KID-236: the "Enter as admin" refusals. The mint action refuses a disabled
 *  daycare and a daycare with no web address before any grant is minted;
 *  consumption on the daycare's own host re-checks everything again. */
const ENTRY_ERRORS: Record<string, string> = {
  "enter-disabled": "This daycare is disabled. Enable it before entering as admin.",
  "enter-no-address": "This daycare has no web address yet. Set a web prefix first.",
};

export default async function PlatformDaycaresPage({
  searchParams,
}: {
  searchParams: { created?: string; error?: string; edit?: string; prefix?: string };
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
  // KID-227: an error carrying `edit` belongs to a row (the inline prefix
  // save); only create-flow errors render the page-wide banner.
  const rowEditId = searchParams.edit ?? "";
  const rowError = searchParams.error ? (ROW_ERRORS[searchParams.error] ?? ROW_ERRORS.unknown) : "";
  // KID-236: an entry refusal renders its own message (fall back to the
  // generic create banners when the key is unknown).
  // KID-244: the create flow's billing rollout — the same named reasons the
  // store throws, with their friendly wording.
  const entryError = searchParams.error ? (ENTRY_ERRORS[searchParams.error] ?? "") : "";
  const billingErrorKeys: Record<string, string> = {
    "billing-plan-invalid": "Choose one of: demo, monthly or annual.",
    "billing-monthly_rate_egp-invalid": "The monthly rate must be a number of at least zero.",
    "billing-per_child_rate_egp-invalid": "The incremental child rate must be a number of at least zero.",
    "billing-free_child_threshold-invalid": "The free-child threshold must be a number of at least zero.",
    "billing-annual_amount_egp-invalid": "The annual amount must be a number of at least zero.",
    "billing-cycle-invalid": "Type the first billing month as a date (YYYY-MM-DD).",
  };
  const createError =
    searchParams.error && !rowEditId && !entryError
      ? (ERRORS[searchParams.error] ?? billingErrorKeys[searchParams.error] ?? ERRORS.unknown)
      : "";
  // KID-199.3r: the apex is deployment configuration; when set, the operator
  // sees the full host each daycare resolves on.
  const apex = apexDomain();

  return (
    <div dir={dir}>
      <h1 className="title">{tr(dict, "platform.title")}</h1>
      <p className="subtitle">{tr(dict, "platform.subtitle")}</p>

      {created && (
        <div className="card mb-4 banner-success">{tr(dict, "platform.createdMessage")}</div>
      )}
      {createError && <div className="card mb-4 banner-error">{createError}</div>}
      {entryError && <div className="card mb-4 banner-error">{entryError}</div>}

      <div className="table-scroll">
        <table className="card" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th>{tr(dict, "platform.daycare")}</th>
              <th>{tr(dict, "platform.subdomain")}</th>
              <th>{tr(dict, "platform.brand")}</th>
              <th>{tr(dict, "platform.created")}</th>
              <th>{tr(dict, "platform.owners")}</th>
              <th>{tr(dict, "platform.staff")}</th>
              <th>{tr(dict, "platform.status")}</th>
            </tr>
          </thead>
          <tbody>
            {institutes.map((inst) => {
              const active = Number(inst.active ?? 1) === 1;
              const instId = String(inst.id);
              const storedSubdomain = String(inst.subdomain ?? "");
              // KID-227: after a failed save the row re-renders with what the
              // operator typed (the `prefix` round-trip), never the stale
              // stored value — the typed work survives the redirect.
              const editing = rowEditId === instId && searchParams.prefix !== undefined;
              const inputDefault = editing ? (searchParams.prefix ?? "") : storedSubdomain;
              const publicUrl = storedSubdomain ? subdomainUrl(storedSubdomain) : "";
              // KID-230: the row's openable tenant URL — empty (→ hint, never
              // a dead link) when no apex is configured, the prefix is not
              // set, or the prefix is a reserved platform label.
              const openUrl = daycarePublicUrl(storedSubdomain);
              return (
                <tr key={instId} style={{ borderTop: "1px solid #e5e7eb" }}>
                  {/* KID-230: the daycare name keeps its own visible
                      "Open daycare" link to https://<prefix>.<apex>. Only a
                      linkable URL renders the link — with no apex, no prefix,
                      or a reserved prefix, the cell shows a hint instead,
                      never a link to a host that cannot resolve. */}
                  <td style={{ padding: 8 }}>
                    <span style={{ fontWeight: 700 }}>{String(inst.name)}</span>
                    {openUrl ? (
                      <>
                        <a
                          href={openUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: "block", marginTop: 2, fontWeight: 700 }}
                        >
                          {tr(dict, "platform.openDaycare")}
                        </a>
                        {/* KID-236: two distinct meanings per the board —
                            "Open daycare" is the daycare's public site (the
                            branded landing/login, what visitors see) and
                            "Enter as admin" starts the audited operator view
                            inside that daycare's own portal. The mint action
                            refuses a disabled daycare with a friendly
                            message; consumption on the daycare's own host
                            re-checks everything again. */}
                        <form action={enterDaycareAsAdminAction} style={{ display: "block", marginTop: 6 }}>
                          <input type="hidden" name="instituteId" value={instId} />
                          <button className="btn" type="submit">
                            {tr(dict, "platform.enterAsAdmin")}
                          </button>
                        </form>
                      </>
                    ) : (
                      <span className="small muted" style={{ display: "block", marginTop: 2 }}>
                        {apex ? tr(dict, "platform.noPrefix") : tr(dict, "platform.apexMissing")}
                      </span>
                    )}
                  </td>
                  {/* KID-199.3r: the wildcard subdomain and its full host,
                      editable inline. KID-227: labeled "Edit prefix", with the
                      resulting URL + copy button when the apex is configured,
                      a visible hint when it is not, and row-level errors. */}
                  <td style={{ padding: 8 }}>
                    <form action={updateDaycareSubdomainAction}>
                      <input type="hidden" name="instituteId" value={instId} />
                      <label className="label" htmlFor={`subdomain-${instId}`} style={{ marginBottom: 2 }}>
                        {tr(dict, "platform.editPrefix")}
                      </label>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          className="input"
                          id={`subdomain-${instId}`}
                          name="subdomain"
                          defaultValue={inputDefault}
                          placeholder="sunshine"
                          style={{ width: 160, marginBottom: 0 }}
                          aria-label={`${tr(dict, "platform.subdomain")}: ${String(inst.name)}`}
                        />
                        <button className="btn" type="submit">{tr(dict, "platform.subdomainSave")}</button>
                      </div>
                    </form>
                    {apex ? (
                      publicUrl ? (
                        <span
                          style={{
                            display: "inline-flex",
                            gap: 6,
                            alignItems: "center",
                            marginTop: 6,
                            flexWrap: "wrap",
                          }}
                        >
                          <span className="small muted">{publicUrl}</span>
                          <CopyUrlButton
                            url={publicUrl}
                            copyLabel={tr(dict, "platform.copyUrl")}
                            copiedLabel={tr(dict, "platform.copied")}
                          />
                        </span>
                      ) : (
                        <span className="small muted" style={{ display: "block", marginTop: 6 }}>
                          {tr(dict, "platform.noPrefix")}
                        </span>
                      )
                    ) : (
                      <span className="small muted" style={{ display: "block", marginTop: 6 }}>
                        {tr(dict, "platform.apexMissing")}
                      </span>
                    )}
                    {editing && rowError ? (
                      <span
                        className="small banner-error"
                        style={{ display: "inline-block", padding: "4px 10px", borderRadius: 8, marginTop: 6 }}
                      >
                        {rowError}
                      </span>
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
                      <input type="hidden" name="instituteId" value={instId} />
                      <input type="hidden" name="active" value={active ? "0" : "1"} />
                      <button className="btn" type="submit">
                        {active ? tr(dict, "platform.disable") : tr(dict, "platform.enable")}
                      </button>
                    </form>
                    {/* KID-244: the per-daycare billing settings — a link (a
                        gear, real href, middle-clickable) next to the status
                        cell's toggle, into the operator's billing module for
                        THIS daycare. */}
                    <a
                      href={`/platform/daycares/${instId}/billing`}
                      className="btn"
                      style={{ marginLeft: 8, textDecoration: "none" }}
                      aria-label={`${tr(dict, "platform.billingSettings")}: ${String(inst.name)}`}
                      title={tr(dict, "platform.billingSettings")}
                    >
                      ⚙ {tr(dict, "platform.billingSettings")}
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
                "custom" uses the raw color fields. Server-side, no JS needed
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
          {/* KID-244: the billing plan the new daycare starts on, plus the
              editable rate options (prefilled with the platform defaults;
              the raw values are re-validated by the store). */}
          <div className="col field">
            <label className="label">{tr(dict, "platform.billingPlan")}</label>
            <select className="input" name="billingPlan" defaultValue="demo">
              {["demo", "monthly", "annual"].map((p) => (
                <option key={p} value={p}>
                  {tr(dict, `platform.billingPlan${p[0]!.toUpperCase()}${p.slice(1)}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.billingMonthlyRate")}</label>
            <input className="input" name="billingMonthlyRate" type="number" min={0} defaultValue={BILLING_DEFAULTS.monthlyRateEgp} />
          </div>
        </div>
        <div className="row">
          <div className="col field">
            <label className="label">{tr(dict, "platform.billingPerChildRate")}</label>
            <input className="input" name="billingPerChildRate" type="number" min={0} defaultValue={BILLING_DEFAULTS.perChildRateEgp} />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.billingFreeThreshold")}</label>
            <input className="input" name="billingFreeThreshold" type="number" min={0} defaultValue={BILLING_DEFAULTS.freeChildThreshold} />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.billingAnnualAmount")}</label>
            <input className="input" name="billingAnnualAmount" type="number" min={0} defaultValue={BILLING_DEFAULTS.annualAmountEgp} />
          </div>
        </div>
        <div className="row">
          {/* KID-227: native pickers beside the hex fields, synced both ways
              (ColorField); the hex input keeps the submitted name, and the
              server-side platformColor() #RRGGBB validation is unchanged. */}
          <div className="col field">
            <label className="label">{tr(dict, "platform.primaryColor")}</label>
            <ColorField
              name="primaryColor"
              pickerDefault="#3B82F6"
              hexPlaceholder="#3B82F6"
              pickerLabel={`${tr(dict, "platform.primaryColor")} picker`}
              hexLabel={tr(dict, "platform.primaryColor")}
            />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.accentColor")}</label>
            <ColorField
              name="accentColor"
              pickerDefault="#10B981"
              hexPlaceholder="#10B981"
              pickerLabel={`${tr(dict, "platform.accentColor")} picker`}
              hexLabel={tr(dict, "platform.accentColor")}
            />
          </div>
        </div>
        <button className="btn btn-primary" type="submit">{tr(dict, "platform.create")}</button>
      </form>
    </div>
  );
}
