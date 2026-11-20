import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { isPlatformOperatorEmail, isPlatformOperatorRole } from "@/lib/platform";
import {
  countFoundingClients,
  foundingOfferState,
  getPricingBands,
  getPricingSettings,
} from "@/lib/pricing";
import { updatePricingBandAction, updatePricingSettingsAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { PricingReference } from "../pricing-reference";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "pricing-band-unknown": "That pricing band does not exist.",
  "pricing-band-invalid": "Check the band values: children and amounts must be valid numbers.",
  "pricing-band-ladder": "The bands must cover 1 child upward with no gaps or overlaps.",
  "pricing-setting-invalid": "Check the demo and founding-cohort values.",
  unknown: "Something went wrong saving the pricing configuration. Please try again.",
};

export default async function PlatformPricingPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  if (!isPlatformOperatorRole(session.role) || !isPlatformOperatorEmail(session.email)) {
    redirect("/login");
  }
  const { dict, dir } = await i18nForAccount(session.accountId);
  const bands = await getPricingBands();
  const settings = await getPricingSettings();
  const signedClients = await countFoundingClients();
  const offer = foundingOfferState(settings, signedClients);
  const error = searchParams.error ? (ERRORS[searchParams.error] ?? ERRORS.unknown) : "";

  return (
    <div dir={dir}>
      <h1 className="title">{tr(dict, "platform.pricingTitle")}</h1>
      <p className="subtitle">{tr(dict, "platform.pricingSubtitle")}</p>
      <p className="small">
        <a href="/platform">← {tr(dict, "platform.pricingBack")}</a>
      </p>

      {searchParams.saved ? (
        <div className="card mb-4 banner-success">
          {searchParams.saved === "settings"
            ? tr(dict, "platform.pricingSavedSettings")
            : tr(dict, "platform.pricingSavedBand")}
        </div>
      ) : null}
      {error ? <div className="card mb-4 banner-error">{error}</div> : null}

      <h2 className="title">{tr(dict, "platform.pricingBandTitle")}</h2>
      <p className="small muted">{tr(dict, "platform.pricingBandHint")}</p>
      <p className="small muted">{tr(dict, "platform.pricingMonthlyOnly")}</p>

      {/* KID-2435: the reference first — bands, child counts and prices. The
          editable forms stay below, collapsed so the page is not a long list. */}
      <PricingReference bands={bands} dict={dict} />

      <details className="card mb-4">
        <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
          {tr(dict, "platform.pricingEditBands")}
        </summary>
        {bands.map((band) => (
          <form key={band.key} action={updatePricingBandAction} className="mb-4">
            <input type="hidden" name="key" value={band.key} />
            <div className="row">
              <div className="col field">
                <label className="label">{tr(dict, "platform.pricingBandName")}</label>
                <input className="input" name="name" defaultValue={band.name} />
              </div>
              <div className="col field">
                <label className="label">{tr(dict, "platform.pricingBandMin")}</label>
                <input className="input" name="minChildren" type="number" min={1} defaultValue={band.minChildren} />
              </div>
              <div className="col field">
                <label className="label">{tr(dict, "platform.pricingBandMax")}</label>
                <input
                  className="input"
                  name="maxChildren"
                  type="number"
                  min={1}
                  defaultValue={band.maxChildren ?? ""}
                  placeholder={tr(dict, "platform.pricingBandUnlimited")}
                />
              </div>
            </div>
            <div className="row">
              <div className="col field">
                <label className="label">{tr(dict, "platform.pricingBandMonthly")}</label>
                <input className="input" name="monthlyEgp" type="number" min={0} defaultValue={band.monthlyEgp} />
              </div>
              <div className="col field">
                <label className="label">{tr(dict, "platform.pricingBandPerChild")}</label>
                <input
                  className="input"
                  name="perChildOverageEgp"
                  type="number"
                  min={0}
                  defaultValue={band.perChildOverageEgp}
                />
              </div>
              <div className="col field">
                <label className="label">{tr(dict, "platform.pricingBandFoundingMonthly")}</label>
                <input
                  className="input"
                  name="foundingMonthlyEgp"
                  type="number"
                  min={0}
                  defaultValue={band.foundingMonthlyEgp ?? ""}
                />
              </div>
            </div>
            <button className="btn btn-primary" type="submit">
              {tr(dict, "platform.pricingBandSave")}
            </button>
          </form>
        ))}
      </details>

      <h2 className="title">{tr(dict, "platform.pricingDemoTitle")}</h2>
      <p className="small muted">{tr(dict, "platform.pricingDemoHint")}</p>
      <p className="small muted">
        {tr(dict, "platform.pricingFoundingSigned", {
          signed: String(offer.signedClients),
          cap: String(offer.cap),
        })}{" "}
        — {tr(dict, `platform.pricingOffer${offer.status[0]!.toUpperCase()}${offer.status.slice(1)}`)}
      </p>

      <form className="card mb-4" action={updatePricingSettingsAction}>
        <div className="row">
          <div className="col field">
            <label className="label">{tr(dict, "platform.pricingDemoTrialDays")}</label>
            <input className="input" name="demoTrialDays" type="number" min={0} defaultValue={settings.demoTrialDays} />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.pricingDemoRoomLimit")}</label>
            <input className="input" name="demoRoomLimit" type="number" min={1} defaultValue={settings.demoRoomLimit} />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.pricingDemoChildLimit")}</label>
            <input className="input" name="demoChildLimit" type="number" min={1} defaultValue={settings.demoChildLimit} />
          </div>
        </div>
        <p className="small muted">{tr(dict, "platform.pricingAlwaysOn")}</p>

        <h2 className="title">{tr(dict, "platform.pricingFoundingTitle")}</h2>
        <p className="small muted">{tr(dict, "platform.pricingFoundingHint")}</p>
        <div className="row">
          <div className="col field">
            <label className="label">{tr(dict, "platform.pricingFoundingEnabled")}</label>
            <label className="small">
              <input type="checkbox" name="foundingEnabled" value="1" defaultChecked={settings.foundingEnabled} />{" "}
              {tr(dict, "platform.pricingAllowed")}
            </label>
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.pricingFoundingCap")}</label>
            <input className="input" name="foundingCap" type="number" min={0} defaultValue={settings.foundingCap} />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.pricingFoundingOfferDays")}</label>
            <input className="input" name="foundingOfferDays" type="number" min={0} defaultValue={settings.foundingOfferDays} />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.pricingFoundingLaunchDate")}</label>
            <input
              className="input"
              name="foundingLaunchDate"
              type="date"
              defaultValue={settings.foundingLaunchDate}
            />
          </div>
        </div>
        <div className="row">
          <div className="col field">
            <label className="label">{tr(dict, "platform.pricingFoundingPilotFee")}</label>
            <input className="input" name="foundingPilotFeeEgp" type="number" min={0} defaultValue={settings.foundingPilotFeeEgp} />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.pricingFoundingPilotDays")}</label>
            <input className="input" name="foundingPilotDays" type="number" min={1} defaultValue={settings.foundingPilotDays} />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.pricingFoundingPilotRoomLimit")}</label>
            <input className="input" name="foundingPilotRoomLimit" type="number" min={1} defaultValue={settings.foundingPilotRoomLimit} />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.pricingFoundingPilotChildLimit")}</label>
            <input className="input" name="foundingPilotChildLimit" type="number" min={1} defaultValue={settings.foundingPilotChildLimit} />
          </div>
        </div>
        <div className="row">
          <div className="col field">
            <label className="label">{tr(dict, "platform.pricingFoundingCreditDays")}</label>
            <input className="input" name="foundingPilotCreditDays" type="number" min={0} defaultValue={settings.foundingPilotCreditDays} />
          </div>
          <div className="col field">
            <label className="label">{tr(dict, "platform.pricingGraceDays")}</label>
            <input className="input" name="billingGraceDays" type="number" min={0} defaultValue={settings.billingGraceDays} />
          </div>
        </div>
        <button className="btn btn-primary" type="submit">
          {tr(dict, "platform.pricingSettingsSave")}
        </button>
      </form>
    </div>
  );
}
