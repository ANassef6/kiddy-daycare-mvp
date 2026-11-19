// KID-2435: the compact band reference the operator asked for (founder
// feedback, 19 Nov 2026): band name, child range and price at a glance, above
// the forms. Shared by /platform/pricing and the per-daycare billing page so
// the two surfaces can never show different numbers.
import { tr, type Dict } from "@/lib/i18n";
import type { PricingBand } from "@/lib/pricing";

export function PricingReference({
  bands,
  dict,
  title,
}: {
  bands: PricingBand[];
  dict: Dict;
  title?: string;
}) {
  return (
    <div className="card mb-4">
      <strong className="small">{title ?? tr(dict, "platform.pricingReferenceTitle")}</strong>
      <div className="table-scroll" style={{ marginTop: 8 }}>
        <table className="data" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>{tr(dict, "platform.pricingReferenceBand")}</th>
              <th>{tr(dict, "platform.pricingReferenceChildren")}</th>
              <th>{tr(dict, "platform.pricingReferenceMonthly")}</th>
              <th>{tr(dict, "platform.pricingReferenceFounding")}</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((band) => (
              <tr key={band.key}>
                <td>{band.name}</td>
                <td>
                  {band.minChildren}–{band.maxChildren ?? "∞"}
                </td>
                <td>
                  {band.monthlyEgp} EGP
                  {band.maxChildren === null && band.perChildOverageEgp > 0
                    ? ` + ${band.perChildOverageEgp} ${tr(dict, "platform.pricingReferencePerChildAbove", {
                        children: band.minChildren - 1,
                      })}`
                    : ""}
                </td>
                <td>
                  {band.foundingMonthlyEgp === null
                    ? tr(dict, "platform.pricingBandQuote")
                    : `${band.foundingMonthlyEgp} EGP`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
