"use client";
// KID-2435: the plan drop-down the founder asked for. Demo or monthly, and
// when monthly is chosen the band drop-down appears. Server-rendered forms
// stay the source of truth; this island only toggles the band field.
import { useState } from "react";
import type { BillingPlan } from "@/lib/billing";
import type { PricingBand } from "@/lib/pricing";
import { tr, type Dict } from "@/lib/i18n";

// Kept local so this client island never pulls the server-only billing module
// (lib/billing imports the database layer) into the browser bundle.
const BILLING_PLANS: BillingPlan[] = ["demo", "monthly"];

export function BillingPlanFields({
  dict,
  bands,
  defaultPlan = "demo",
  defaultBandKey = "",
  planName = "plan",
  bandName = "bandKey",
  className = "row",
}: {
  dict: Dict;
  bands: PricingBand[];
  defaultPlan?: BillingPlan;
  defaultBandKey?: string;
  planName?: string;
  bandName?: string;
  className?: string;
}) {
  const [plan, setPlan] = useState<BillingPlan>(defaultPlan);
  return (
    <div className={className}>
      <div className="col field">
        <label className="label">{tr(dict, "platform.billingPlan")}</label>
        <select
          className="input"
          name={planName}
          value={plan}
          onChange={(event) => setPlan(event.target.value as BillingPlan)}
        >
          {BILLING_PLANS.map((p) => (
            <option key={p} value={p}>
              {tr(dict, `platform.billingPlan${p[0]!.toUpperCase()}${p.slice(1)}`)}
            </option>
          ))}
        </select>
      </div>
      {plan === "monthly" ? (
        <div className="col field">
          <label className="label">{tr(dict, "platform.billingBand")}</label>
          <select className="input" name={bandName} defaultValue={defaultBandKey}>
            <option value="">{tr(dict, "platform.billingBandAuto")}</option>
            {bands.map((band) => (
              <option key={band.key} value={band.key}>
                {band.name} ({band.minChildren}–{band.maxChildren ?? "∞"}) — {band.monthlyEgp} EGP
              </option>
            ))}
          </select>
          <span className="small muted">{tr(dict, "platform.billingBandHint")}</span>
        </div>
      ) : null}
    </div>
  );
}
