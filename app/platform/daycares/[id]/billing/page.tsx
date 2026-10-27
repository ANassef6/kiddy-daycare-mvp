// KID-244: the per-daycare billing settings page a superadmin reaches via the
// gear icon on the /platform daycare list (app/platform/page.tsx). Plain
// server-rendered form like the rest of the repo — plan, the four editable
// amounts, and the first billed cycle date — guarded by the same double
// check every other platform surface uses: internal sentinel session AND the
// env allowlist (accessing is not a role, KID-199.4r).
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { isPlatformOperatorEmail, isPlatformOperatorRole } from "@/lib/platform";
import { getInstitute } from "@/lib/store";
import { enrolledChildCount } from "@/lib/billing";import { BILLING_PLANS, BILLING_DEFAULTS, cycleAmountEgp, getDaycareBilling, type DaycareBilling } from "@/lib/billing";
import { updateDaycareBillingAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

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
  searchParams: { saved?: string; error?: string };
}) {
  const session = requireSession();
  if (!isPlatformOperatorRole(session.role) || !isPlatformOperatorEmail(session.email)) {
    redirect("/login");
  }
  const { dict, dir } = await i18nForAccount(session.accountId);
  const instituteId = String(params.id ?? "");
  const inst = await getInstitute(instituteId);
  if (!inst) redirect("/platform?error=missing-id");
  const billing: DaycareBilling = await getDaycareBilling(instituteId);
  const childCount = await enrolledChildCount(instituteId);
  const saved = searchParams.saved === "1";
  const error = searchParams.error ? (ERRORS[searchParams.error] ?? ERRORS.unknown) : "";

  return (
    <div dir={dir}>
      <h1 className="title">{tr(dict, "platform.billingTitle")}</h1>
      <p className="subtitle">{String(inst.name)}</p>

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
      {error && <div className="card mb-4 banner-error">{error}</div>}

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
            <span className="small muted">{tr(dict, "platform.billingAnnualHint")}</span>
          </div>
        </div>
        <button className="btn btn-primary" type="submit">
          {tr(dict, "platform.billingSave")}
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
