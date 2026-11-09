// KID-244 (billing settings) + KID-481 (Insights tab): the per-daycare page a
// superadmin reaches via the gear icon on the /platform daycare list
// (app/platform/page.tsx). Two tabs behind one URL:
//   ?tab=billing (default) — the unchanged KID-244 form: plan, the four
//     editable amounts, and the first billed cycle date.
//   ?tab=insights           — the cross-tenant tool-usage view (insights-view).
// Guarded by the same double check every other platform surface uses:
// internal sentinel session role AND the env allowlist (accessing is not a
// role, KID-199.4r).
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { isPlatformOperatorEmail, isPlatformOperatorRole } from "@/lib/platform";
import { getInstitute } from "@/lib/store";
import { enrolledChildCount } from "@/lib/billing";
import { BILLING_PLANS, BILLING_DEFAULTS, cycleAmountEgp, getDaycareBilling, type DaycareBilling } from "@/lib/billing";
import { updateDaycareBillingAction, uploadDaycareContractAction } from "@/lib/actions";
import { getDaycareContract, getDaycareContractUploaderName } from "@/lib/contract";
import { storageSrcFor } from "@/lib/storage";
import { fmtDateTimeFor, tr } from "@/lib/i18n";
import { i18nForAccount } from "@/lib/i18n-session";
import {
  backfillToolUsageEstimates,
  insightsTimeframe,
  recordToolUsage,
  countToolUsageRows,
  toolInsights,
} from "@/lib/tool-usage";
import { InsightsView } from "./insights-view";

export const dynamic = "force-dynamic";

/** Friendly labels for the failures updateDaycareBillingAction redirects
 *  back with. */
const ERRORS: Record<string, string> = {
  "billing-plan-invalid": "Choose one of: demo, monthly or annual.",
  "billing-monthly_rate_egp-invalid": "The monthly rate must be a number of at least zero.",
  "billing-per_child_rate_egp-invalid": "The incremental child rate must be a number of at least zero.",
  "billing-free_child_threshold-invalid": "The free-child threshold must be a number of at least zero.",
  "billing-annual_amount_egp-invalid": "The annual amount must be a number of at least zero.",
  "billing-cycle-invalid": "Type the first billing month as a date (YYYY-MM-DD).",
  unknown: "Something went wrong saving the billing settings. Please try again.",
};

export default async function DaycareBillingPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    saved?: string;
    error?: string;
    contract?: string;
    tab?: string;
    days?: string;
    from?: string;
    to?: string;
  };
}) {
  const session = requireSession();
  if (!isPlatformOperatorRole(session.role) || !isPlatformOperatorEmail(session.email)) {
    redirect("/login");
  }
  const { dict, dir, locale } = await i18nForAccount(session.accountId);
  const instituteId = String(params.id ?? "");
  const inst = await getInstitute(instituteId);
  if (!inst) redirect("/platform?error=missing-id");
  const billing: DaycareBilling = await getDaycareBilling(instituteId);
  const childCount = await enrolledChildCount(instituteId);
  const saved = searchParams.saved === "1";
  const error = searchParams.error ? (ERRORS[searchParams.error] ?? ERRORS.unknown) : "";

  // KID-745: the contract banner codes ride the same ?error= channel as the
  // billing form's — but theirs are localized keys, not the hardcoded English
  // ERRORS map above.
  let errorText = "";
  if (error) {
    if (searchParams.error === "contractType") errorText = tr(dict, "platform.contractErrorType");
    else if (searchParams.error === "contractSize") errorText = tr(dict, "platform.contractErrorSize");
    else if (searchParams.error === "contractUpload") errorText = tr(dict, "platform.contractErrorUpload");
    else errorText = error;
  } else if (searchParams.contract === "uploaded") {
    errorText = ""; // rendered as the success banner below
  }
  const contractSaved = searchParams.contract === "uploaded";
  // KID-481: the tab. Anything that is not literally "insights" is billing —
  // the pre-existing default stays the default.
  const tab = searchParams.tab === "insights" ? "insights" : "billing";
  const contextBase = `/platform/daycares/${instituteId}/billing`;
  // Tab bar: links (real hrefs, middle-clickable) into both tabs of the
  // same per-daycare surface.
  const tabLink = (which: "billing" | "insights", label: string, ariaActive: boolean) => (
    <a
      href={which === "billing" ? contextBase : `${contextBase}?tab=insights`}
      className="btn"
      style={{
        textDecoration: "none",
        fontWeight: ariaActive ? 700 : 400,
        borderBottom: ariaActive ? "2px solid currentColor" : "none",
      }}
      aria-current={ariaActive ? "page" : undefined}
    >
      {label}
    </a>
  );

  // KID-481: the operator's own visit counts toward usage history too —
  // billing-tab visits as tool_key "billing", insights visits with the same
  // key plus a surface marker. Best-effort; never blocks the page.
  await recordToolUsage({
    instituteId,
    accountId: session.accountId,
    toolKey: "billing",
    source: "platform",
    metadata: tab === "insights" ? { surface: "insights" } : null,
  });

  if (tab === "insights") {
    // Aggregate-only view. Custom ?from/?to fail closed into the 30-day
    // preset (warnCustom tells the operator the fallback happened).
    const customWanted =
      searchParams.from !== undefined || searchParams.to !== undefined;
    const customValid =
      /^\d{4}-\d{2}-\d{2}$/.test(String(searchParams.from ?? "")) &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(searchParams.to ?? ""));
    const tf = customWanted
      ? insightsTimeframe({ from: searchParams.from, to: searchParams.to }, new Date())
      : insightsTimeframe({ days: searchParams.days }, new Date());
    const warnCustom = customWanted && !customValid;
    // KID-481: one-time historical backfill — the first insights view seeds
    // estimate rows, labeled estimates in metadata, from existing domain
    // tables. Idempotent by construction (NOT EXISTS per daycare+tool).
    let backfilled = 0;
    if ((await countToolUsageRows("WHERE source = 'backfill'")) === 0) {
      backfilled = await backfillToolUsageEstimates();
    }
    const insights = await toolInsights(tf);
    return (
      <div dir={dir}>
        <h1 className="title">{tr(dict, "platform.billingTitle")}</h1>
        <div className="card mb-4">
          {tabLink("billing", tr(dict, "platform.billingTab"), false)}
          {tabLink("insights", tr(dict, "platform.insightsTab"), true)}
        </div>
        <InsightsView
          inst={inst}
          insights={insights}
          dict={dict}
          backfilled={backfilled}
          warnCustom={warnCustom}
        />
      </div>
    );
  }

  // KID-745: this daycare's contract row — the draft (content task's output)
  // and the CURRENT signed upload. Read-only here; uploadDaycareContractAction
  // is the row's only writer.
  const contract = await getDaycareContract(instituteId);
  const uploaderName = contract?.uploaded_by_account_id
    ? await getDaycareContractUploaderName(contract.uploaded_by_account_id)
    : null;
  // KID-1177: the contract is sensitive — its stored private ref resolves to
  // a short-lived signed URL here, in the operator-only surface. Legacy
  // public URLs (pre-migration rows) pass through.
  const contractHref = contract?.signed_url
    ? await storageSrcFor(contract.signed_url)
    : null;
  const [draftHrefAr, draftHrefEn, draftHrefLegacy] = contract
    ? await Promise.all([
        contract.draft_url_ar ? storageSrcFor(contract.draft_url_ar) : Promise.resolve(null),
        contract.draft_url_en ? storageSrcFor(contract.draft_url_en) : Promise.resolve(null),
        contract.draft_url ? storageSrcFor(contract.draft_url) : Promise.resolve(null),
      ])
    : [null, null, null];

  return (
    <div dir={dir}>
      <h1 className="title">{tr(dict, "platform.billingTitle")}</h1>
      <p className="subtitle">{String(inst.name)}</p>

      <div className="card mb-4">
        {tabLink("billing", tr(dict, "platform.billingTab"), true)}
        {tabLink("insights", tr(dict, "platform.insightsTab"), false)}
      </div>

      {/* KID-245: the generated invoices for this daycare (Finance/2) — the
          list where the operator overrides amounts and marks invoices paid. */}
      <p className="small">
        <a href={`/platform/daycares/${instituteId}/invoices`}>
          {tr(dict, "platform.invoiceTitle")} →
        </a>
      </p>

      {/* Who was just reached: the gear on /platform; additionally show the
          exact plan in use and what the current settings bill for this
          daycare's current roster (demo always bills 0). */}
      <div className="card mb-4">
        <span className="small muted">
          {tr(dict, "platform.billingCurrentPlan")}: <strong>{billing.plan}</strong>
        </span>
        <span className="small muted" style={{ marginLeft: 16 }}>
          {tr(dict, "platform.billingCyclePreview")}:{" "}
          <strong>{cycleAmountEgp(billing, childCount)} EGP</strong>
        </span>
        <span className="small muted" style={{ marginLeft: 16 }}>
          {tr(dict, "platform.billingEnrolledChildren")}: <strong>{childCount}</strong>
        </span>
      </div>

      {saved && <div className="card mb-4 banner-success">{tr(dict, "platform.billingSaved")}</div>}
      {errorText ? <div className="card mb-4 banner-error">{errorText}</div> : null}

      <form className="card" action={updateDaycareBillingAction}>
        <input type="hidden" name="instituteId" value={instituteId} />
        <div className="row">
          <div className="col field">
            <label className="label">{tr(dict, "platform.billingPlan")}</label>
            <select className="input" name="plan" defaultValue={billing.plan}>
              {BILLING_PLANS.map((p) => (
                <option key={p} value={p}>
                  {tr(dict, `platform.billingPlan${p[0]!.toUpperCase()}${p.slice(1)}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.billingFirstCycle")}</label>
            <input className="input" name="firstCycleStart" type="date" defaultValue={billing.firstCycleStart} />
            <span className="small muted">{tr(dict, "platform.billingCycleHint")}</span>
          </div>
        </div>
        <div className="row">
          <div className="col field">
            <label className="label">{tr(dict, "platform.billingMonthlyRate")}</label>
            <input
              className="input"
              name="monthlyRateEgp"
              type="number"
              min={0}
              defaultValue={billing.monthlyRateEgp}
            />
            <span className="small muted">{tr(dict, "platform.billingMonthlyRateHint")}</span>
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.billingPerChildRate")}</label>
            <input
              className="input"
              name="perChildRateEgp"
              type="number"
              min={0}
              defaultValue={billing.perChildRateEgp}
            />
            <span className="small muted">{tr(dict, "platform.billingPerChildHint")}</span>
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.billingFreeThreshold")}</label>
            <input
              className="input"
              name="freeChildThreshold"
              type="number"
              min={0}
              defaultValue={billing.freeChildThreshold}
            />
            <span className="small muted">{tr(dict, "platform.billingThresholdHint")}</span>
          </div>
        </div>
        <div className="row">
          <div className="col field">
            <label className="label">{tr(dict, "platform.billingAnnualAmount")}</label>
            <input
              className="input"
              name="annualAmountEgp"
              type="number"
              min={0}
              defaultValue={billing.annualAmountEgp}
            />
          </div>
        </div>
        <button className="btn btn-primary" type="submit">
          {tr(dict, "platform.billingSave")}
        </button>
      </form>

      {contractSaved && (
        <div className="card mb-4 banner-success">{tr(dict, "platform.contractUploaded")}</div>
      )}

      {/* KID-745: the signed-contract card — the placeholder inside the
          settings (gear-icon) surface for the daycare's signed contract.
          Operator-only by the page guard above; the row is keyed by this
          institute id, so another daycare's contract is never reachable
          here. The draft section is the content task's output (read-only
          here); the signed section carries the current upload with its
          original file name, upload date and uploader, and the same form
          replaces it. */}
      <form className="card mb-4" action={uploadDaycareContractAction}>
        <input type="hidden" name="instituteId" value={instituteId} />
        <label className="label">{tr(dict, "platform.contractCardTitle")}</label>
        <span className="small muted">{tr(dict, "platform.contractCardHint")}</span>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="col field">
            <span className="small">
              <strong>{tr(dict, "platform.contractDraftLabel")}</strong>
            </span>
            {contract?.template_version ? (
              <span className="small">
                {tr(dict, "platform.contractTemplateVersion", {
                  version: String(contract.template_version),
                })}
              </span>
            ) : null}
            {contract?.draft_url_ar && contract?.draft_url_en ? (
              // KID-746: the auto-generated bilingual drafts — one link per
              // language, generated together, template version stamped.
              // KID-1177: resolvable hrefs only (a private ref with an
              // unreachable storage service renders no dead link).
              <>
                {draftHrefAr && (
                  <a className="small" href={draftHrefAr}>
                    {tr(dict, "platform.contractDraftDownloadAr")}
                  </a>
                )}
                {draftHrefEn && (
                  <a className="small" href={draftHrefEn}>
                    {tr(dict, "platform.contractDraftDownloadEn")}
                  </a>
                )}
                <span className="small muted">
                  {tr(dict, "platform.contractDraftGenerated", {
                    date: fmtDateTimeFor(locale, contract.draft_generated_at),
                  })}
                </span>
              </>
            ) : contract?.draft_url ? (
              <>
                {draftHrefLegacy && (
                  <a className="small" href={draftHrefLegacy}>
                    {tr(dict, "platform.contractDraftDownload")}
                  </a>
                )}
                <span className="small muted">
                  {tr(dict, "platform.contractDraftGenerated", {
                    date: fmtDateTimeFor(locale, contract.draft_generated_at),
                  })}
                </span>
              </>
            ) : (
              <span className="small muted">{tr(dict, "platform.contractDraftNone")}</span>
            )}
          </div>
          <div className="col field">
            <span className="small">
              <strong>{tr(dict, "platform.contractSignedLabel")}</strong>
            </span>
            {contract?.signed_url ? (
              <>
                {contractHref && (
                  <a className="small" href={contractHref}>
                    {String(contract.signed_file_name ?? "")}
                  </a>
                )}
                <span className="small muted">
                  {tr(dict, "platform.contractSignedUploaded", {
                    date: fmtDateTimeFor(locale, contract.signed_uploaded_at),
                  })}
                </span>
                {uploaderName ? (
                  <span className="small muted">
                    {tr(dict, "platform.contractSignedBy", { name: uploaderName })}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="small muted">{tr(dict, "platform.contractSignedNone")}</span>
            )}
          </div>
        </div>
        <label className="label" style={{ marginTop: 8 }}>
          {tr(dict, contract?.signed_url ? "platform.contractReplaceLabel" : "platform.contractUploadLabel")}
        </label>
        <input
          className="input"
          type="file"
          name="file"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        />
        <button className="btn btn-primary" type="submit">
          {tr(dict, contract?.signed_url ? "platform.contractReplaceBtn" : "platform.contractUploadBtn")}
        </button>
      </form>

      {/* Defaults are visible so an operator changing one number never has to
          remember the rest — same approach KID-227 took for the prefixes. The
          create form (idx: platform.defaults) prefills the exact same values. */}
      <p className="small muted">
        {tr(dict, "platform.billingDefaultsHint")}:{" "}
        {BILLING_DEFAULTS.monthlyRateEgp} / {BILLING_DEFAULTS.perChildRateEgp} /{" "}
        {BILLING_DEFAULTS.freeChildThreshold} / {BILLING_DEFAULTS.annualAmountEgp}
      </p>
    </div>
  );
}
