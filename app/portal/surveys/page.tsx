import { requireSession } from "@/lib/require";
import { listForms, formResponses } from "@/lib/store";
import { firstInstituteId, safeJson } from "@/lib/helpers";
import { createFormAction } from "@/lib/actions";
import { recordToolUsage } from "@/lib/tool-usage";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalSurveysPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{tr(dict, "formsAdmin.noInstitute")}</p>;
  await recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "surveys", source: "portal", metadata: null });
  const surveys = await listForms(instituteId, "survey");
  const viewId = (await searchParams).view;
  const active = surveys.find((f: any) => f.id === viewId);
  const responses = active ? await formResponses(active.id) : [];

  return (
    <div>
      <h1 className="title">{tr(dict, "nav.surveys")}</h1>
      <p className="subtitle">
        {tr(dict, "surveysAdmin.pageSubtitle")}
      </p>

      {/* KID-52 #10: create + access surveys directly from the Surveys tab. */}
      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "surveysAdmin.createHeading")}</h3>
        <form action={createFormAction}>
          <input type="hidden" name="kind" value="survey" />
          <input type="hidden" name="returnTo" value="/portal/surveys" />
          <div className="row">
            <div className="col field"><label className="label">{tr(dict, "common.title")}</label><input className="input" name="title" required placeholder={tr(dict, "surveysAdmin.titlePlaceholder")} /></div>
          </div>
          <div className="field"><label className="label">{tr(dict, "common.description")}</label><input className="input" name="description" placeholder={tr(dict, "surveysAdmin.descriptionPlaceholder")} /></div>
          <h4 className="subtitle">{tr(dict, "surveysAdmin.questionsHeading")}</h4>
          {Array.from({ length: 5 }).map((_, i) => (
            <div className="row" key={i}>
              <div className="col field"><label className="label">{tr(dict, "formsAdmin.questionLabel", { n: i + 1 })}</label><input className="input" name={`field_${i}_label`} placeholder={tr(dict, "formsAdmin.questionPlaceholder")} /></div>
              <div className="field">
                <label className="label">{tr(dict, "formsAdmin.fieldType")}</label>
                <select className="select" name={`field_${i}_type`} style={{ minWidth: 110 }}>
                  <option value="text">{tr(dict, "formsAdmin.optText")}</option>
                  <option value="textarea">{tr(dict, "formsAdmin.optLongText")}</option>
                  <option value="select">{tr(dict, "formsAdmin.optChoice")}</option>
                  <option value="checkbox">{tr(dict, "formsAdmin.optYesNo")}</option>
                </select>
              </div>
              <div className="field">
                <label className="label">{tr(dict, "formsAdmin.optionsLabel")}</label>
                <input className="input" name={`field_${i}_options`} placeholder={tr(dict, "formsAdmin.optionsPlaceholder")} />
              </div>
              <div className="field" style={{ marginTop: 24 }}><label className="label small"><input type="checkbox" name={`field_${i}_required`} /> {tr(dict, "formsAdmin.requiredCheckbox")}</label></div>
            </div>
          ))}
          <button className="btn btn-primary" type="submit">{tr(dict, "surveysAdmin.createSurveyBtn")}</button>
        </form>
      </div>

      <h3 className="subtitle">{tr(dict, "surveysAdmin.createdHeading")}</h3>
      {surveys.length === 0 && (
        <div className="card">
          <p className="muted small">{tr(dict, "surveysAdmin.noSurveysYet")}</p>
        </div>
      )}

      {surveys.map((f: any) => (
        <div className="card mb-4" key={f.id}>
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{f.title}</div>
            <span className="badge">{tr(dict, "surveysAdmin.responseCount", { count: f.response_count ?? 0 })}</span>
          </div>
          {f.description && <p className="small muted mt-1">{f.description}</p>}
          {f.created_by_name && <div className="small muted mt-1">{tr(dict, "surveysAdmin.askedBy", { name: f.created_by_name })}</div>}
          <div className="mt-3 row" style={{ gap: 6 }}>
            <a className="btn btn-ghost small" href={`/portal/surveys?view=${f.id}`}>{tr(dict, "surveysAdmin.viewResponsesBtn")}</a>
            {f.share_token && (
              <span className="small muted">{tr(dict, "surveysAdmin.parentLinkLabel")} <a href={`/forms/f/${f.share_token}`}>{`/forms/f/${f.share_token}`}</a></span>
            )}
          </div>
        </div>
      ))}

      {viewId && active && (
        <div className="card mt-4">
          <h3 className="subtitle">{tr(dict, "surveysAdmin.responsesToTitle", { title: active.title })}</h3>
          {responses.length === 0 && <p className="muted small">{tr(dict, "surveysAdmin.noResponsesYet")}</p>}
          {responses.map((r: any) => {
            const answers = safeJson<Record<string, string>>(r.answers_json, {});
            return (
              <div className="list-item" key={r.id}>
                <div className="small">
                  <strong>{r.respondent_name ?? tr(dict, "surveysAdmin.anonymous")}</strong>
                  {r.first_name ? ` ${tr(dict, "surveysAdmin.forChild", { first: r.first_name, last: r.last_name ?? "" })}` : ""}
                  <div className="muted">{Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
