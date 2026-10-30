import { requireFamilyPage } from "@/lib/require";
import { listForms, responsesByAccount, getForm } from "@/lib/store";
import { firstInstituteId, safeJson, cap } from "@/lib/helpers";
import { submitFormAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";
type Field = { id: string; label: string; type: string; required?: boolean; options?: string[] };

// KID-368 (DEF-004): localize the form-template kind coming from the portal
// builder enum (form | survey | list); unknown kinds keep the capitalized raw
// value so nothing silently loses meaning.
function formKindLabel(kind: string, t: (key: string) => string): string {
  switch (kind) {
    case "form": return t("forms.kindForm");
    case "survey": return t("forms.kindSurvey");
    case "list": return t("forms.kindList");
    default: return cap(kind);
  }
}

export default async function ParentFormsPage({ searchParams }: { searchParams: { sent?: string; open?: string } }) {
  const session = await requireFamilyPage("/child/forms");
  const { dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{t("forms.noInstitute")}</p>;
  const [forms, mine] = await Promise.all([listForms(instituteId), responsesByAccount(session.accountId)]);
  const openId = searchParams.open || searchParams.sent;

  return (
    <div>
      <h1 className="title">{t("forms.title")}</h1>
      <div className="subtitle">{t("forms.subtitle")}</div>

      {searchParams.sent && <p className="badge badge-green mb-4" style={{ display: "inline-block" }}>{t("forms.sent")}</p>}

      {forms.length === 0 && <p className="muted">{t("forms.empty")}</p>}
      {forms.map((f: any) => {
        const fields = safeJson<Field[]>(f.fields_json, []);
        return (
          <div className="card mb-4" key={f.id}>
            <div className="status-card">
              <div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>{f.title}</div>
                <div className="muted small" dir="auto">{formKindLabel(String(f.kind ?? "form"), t)} · {t("forms.responsesSoFar", { count: f.response_count })}{f.description ? ` — ${f.description}` : ""}</div>
              </div>
              {fields.length > 0 && openId !== f.id && (
                <a className="btn btn-primary" href={`/child/forms?open=${f.id}`}>{t("forms.fillIn")}</a>
              )}
            </div>
            {fields.length > 0 && openId === f.id && (
              <form action={submitFormAction} className="mt-3">
                <input type="hidden" name="formId" value={f.id} />
                {fields.map((field, i) => (
                  <div className="field" key={field.id}>
                    <label className="label">{field.label}{field.required ? " *" : ""}</label>
                    <input type="hidden" name={`field_${i}_key`} value={field.id} />
                    <input type="hidden" name={`field_${i}_label`} value={field.label} />
                    {field.type === "textarea" ? (
                      <textarea className="textarea" name={`field_${i}`} required={field.required} />
                    ) : field.type === "select" ? (
                      <select className="select" name={`field_${i}`} required={field.required}>
                        <option value="">—</option>
                        {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : field.type === "checkbox" ? (
                      <label className="row small" style={{ alignItems: "center", gap: 8 }}>
                        <input type="checkbox" name={`field_${i}`} value="yes" /> {t("forms.yes")}
                      </label>
                    ) : (
                      <input className="input" name={`field_${i}`} required={field.required} placeholder={field.label} />
                    )}
                  </div>
                ))}
                <button className="btn btn-primary" type="submit">{t("forms.submit")}</button>{" "}
                <a className="btn btn-ghost" href="/child/forms">{t("common.cancel")}</a>
              </form>
            )}
          </div>
        );
      })}

      <h3 className="subtitle mt-4">{t("forms.mySubmissions")}</h3>
      {mine.length === 0 && <p className="muted small">{t("forms.noSubmissions")}</p>}
      {mine.map((r: any) => (
        <div className="list-item small" key={r.id}>
          <div dir="auto"><strong>{r.form_title}</strong> <span className="muted">({formKindLabel(String(r.form_kind ?? r.kind ?? "form"), t)})</span></div>
          <span className="badge badge-green">{t("forms.submitted")}</span>
        </div>
      ))}
    </div>
  );
}
