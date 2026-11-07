// KID-481: the Insights tab of the super-admin billing page. Rendered only
// for platform operators (the page's double guard covers both tabs). Strictly
// aggregate: event counts and adoption across ACTIVE daycares — never a row
// of daycare content, and this surface is never linked anywhere daycare sides
// can reach.
import type { InsightsByTimeframe, ToolKey } from "@/lib/tool-usage";
import { INSIGHT_PRESETS, TOOLS } from "@/lib/tool-usage";
import type { Dict } from "@/lib/i18n";
import { tr } from "@/lib/i18n";
import type { Row } from "@/lib/db";

export type InsightsViewProps = {
  inst: Row;
  insights: InsightsByTimeframe;
  dict: Dict;
  /** Number of historical estimate rows inserted on this view's first load. */
  backfilled: number;
  /** Custom ?from/?to were given but failed to parse — the 30-day fallback applied. */
  warnCustom: boolean;
};

export function toolDictKey(toolKey: string): string {
  // stable key -> dot path, e.g. "report-center" -> "toolReportCenter"
  return (
    "tool" +
    toolKey
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")
  );
}

/** tr() with the English registry label as a typed fallback. */
export function toolLabel(dict: Dict, toolKey: string): string {
  const localized = tr(dict, `platform.${toolDictKey(toolKey)}`);
  const english = (TOOLS as Record<string, { label: string }>)[toolKey]?.label ?? toolKey;
  return localized.startsWith("MISSING:") ? english : localized;
}

export function InsightsView({ inst, insights, dict, backfilled, warnCustom }: InsightsViewProps) {
  const base = `/platform/daycares/${String(inst.id)}/billing`;
  const tabHref = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ tab: "insights", ...extra });
    return `${base}?${q.toString()}`;
  };
  const noData = insights.totalEvents === 0;

  return (
    <div>
      <p className="subtitle">{String(inst.name)} — {tr(dict, "platform.insightsTitle")}</p>

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "platform.insightsTimeframe")}</h3>
        <p>
          {INSIGHT_PRESETS.map((preset) => {
            const active = insights.presetDays === preset.days;
            return (
              <a
                key={preset.days}
                className="btn"
                href={tabHref({ days: String(preset.days) })}
                style={{
                  textDecoration: "none",
                  marginLeft: preset.days === 7 ? 0 : 8,
                  fontWeight: active ? 700 : 400,
                }}
                aria-current={active ? "true" : undefined}
              >
                {tr(dict, `platform.${preset.label}`)}
              </a>
            );
          })}
          {insights.presetDays === null ? (
            <span
              className="btn"
              style={{ marginLeft: 8, fontWeight: 700 }}
              aria-current="true"
            >
              {tr(dict, "platform.insightsCustom")}
            </span>
          ) : null}
        </p>

        {/* Custom range: plain GET form, no client JS needed. */}
        <div className="row">
          <form className="row" method="get" action={base}>
            <input type="hidden" name="tab" value="insights" />
            <div className="col field">
              <label className="label">{tr(dict, "platform.insightsCustomFrom")}</label>
              <input className="input" type="date" name="from" defaultValue={insights.presetDays === null ? insights.from : undefined} />
            </div>
            <div className="col field">
              <label className="label">{tr(dict, "platform.insightsCustomTo")}</label>
              <input className="input" type="date" name="to" defaultValue={insights.presetDays === null ? insights.to : undefined} />
            </div>
            <div className="col field">
              <button className="btn" type="submit">
                {tr(dict, "platform.insightsCustomApply")}
              </button>
            </div>
          </form>
        </div>
        <span className="small muted" style={{ display: "block", marginTop: 6 }}>
          {tr(dict, "platform.insightsTotals", {
            events: insights.totalEvents,
            active: insights.activeDaycares,
            total: insights.totalDaycares,
            platformEvents: insights.platformEvents,
          })}
        </span>
        {warnCustom ? (
          <div className="banner-error">{tr(dict, "platform.insightsInvalidCustom")}</div>
        ) : null}
      </div>

      {/* Backfill: run once (guarded by the count read) and shown so the
          estimate rows are never invisible. */}
      {backfilled > 0 ? (
        <div className="card mb-4 banner-success">
          {tr(dict, "platform.insightsBackfilled", { count: backfilled })}
        </div>
      ) : null}
      <p className="small muted">{tr(dict, "platform.insightsBackfillNote")}</p>

      {noData ? <div className="card">{tr(dict, "platform.insightsNoData")}</div> : null}

      {!noData ? (
        <>
          <div className="card mb-4">
            <h3 className="subtitle">{tr(dict, "platform.insightsToolTable")}</h3>
            <div className="row">
              <table>
                <thead>
                  <tr>
                    <th>{tr(dict, "platform.insightsToolTable")}</th>
                    <th>{tr(dict, "platform.insightsDaycaresUsing")}</th>
                    <th>{tr(dict, "platform.insightsAdoption")}</th>
                    <th>{tr(dict, "platform.insightsEvents")}</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.tools.map((t) => (
                    <tr key={t.toolKey}>
                      <td style={{ padding: 8 }}>{toolLabel(dict, t.toolKey)}</td>
                      <td style={{ padding: 8 }}>
                        {t.daycaresUsing}/{t.totalDaycares}
                      </td>
                      <td className="small" style={{ padding: 8 }}>
                        {t.totalDaycares > 0
                          ? `${Math.round((t.daycaresUsing / t.totalDaycares) * 100)}%`
                          : "—"}
                      </td>
                      <td style={{ padding: 8 }}>{t.events}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="row">
            <div className="col card mb-4">
              <h3 className="subtitle">{tr(dict, "platform.insightsTopUsed")}</h3>
              <ol className="small">
                {insights.top
                  .filter((t) => t.events > 0)
                  .map((t) => (
                    <li key={t.toolKey}>
                      {toolLabel(dict, t.toolKey)} — {t.events}
                    </li>
                  ))}
              </ol>
            </div>
            <div className="col card mb-4">
              <h3 className="subtitle">{tr(dict, "platform.insightsNeglected")}</h3>
              <ol className="small">
                {insights.neglected.map((t) => (
                  <li key={t.toolKey}>
                    {toolLabel(dict, t.toolKey)} — {t.events}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </>
      ) : null}

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "platform.insightsPerDaycare")}</h3>
        <div className="row">
          <table>
            <thead>
              <tr>
                <th>{tr(dict, "platform.insightsDaycareName")}</th>
                <th>{tr(dict, "platform.status")}</th>
                <th>{tr(dict, "platform.insightsEvents")}</th>
                <th>{tr(dict, "platform.insightsTopTool")}</th>
              </tr>
            </thead>
            <tbody>
              {insights.daycares.map((d) => (
                <tr key={d.instituteId}>
                  <td style={{ padding: 8 }}>{d.name}</td>
                  <td className="small" style={{ padding: 8 }}>
                    {d.active ? tr(dict, "platform.active") : tr(dict, "platform.insightsInactive")}
                  </td>
                  <td style={{ padding: 8 }}>{d.events}</td>
                  <td className="small" style={{ padding: 8 }}>
                    {d.topTool
                      ? `${toolLabel(dict, d.topTool)} (${d.topToolEvents})`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
