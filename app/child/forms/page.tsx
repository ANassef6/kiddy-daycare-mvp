import { requireSession } from "@/lib/require";
import { listForms, responsesByAccount, getForm } from "@/lib/store";
import { firstInstituteId, safeJson } from "@/lib/helpers";
import { submitFormAction } from "@/lib/actions";

export const dynamic = "force-dynamic";
type Field = { id: string; label: string; type: string; required?: boolean; options?: string[] };

export default async function ParentFormsPage({ searchParams }: { searchParams: { sent?: string; open?: string } }) {
  const session = requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No daycare configured yet.</p>;
  const [forms, mine] = await Promise.all([listForms(instituteId), responsesByAccount(session.accountId)]);
  const openId = searchParams.open || searchParams.sent;

  return (
    <div>
      <h1 className="title">Forms &amp; surveys</h1>
      <div className="subtitle">Answer questions from the daycare — surveys, permission lists, and more.</div>

      {searchParams.sent && <p className="badge badge-green mb-4" style={{ display: "inline-block" }}>✅ Response sent. Thank you!</p>}

      {forms.length === 0 && <p className="muted">No forms to complete right now.</p>}
      {forms.map((f: any) => {
        const fields = safeJson<Field[]>(f.fields_json, []);
        return (
          <div className="card mb-4" key={f.id}>
            <div className="status-card">
              <div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>{f.title}</div>
                <div className="muted small">{f.kind.toUpperCase()} · {f.response_count} response{f.response_count === 1 ? "" : "s"} so far{f.description ? ` — ${f.description}` : ""}</div>
              </div>
              {fields.length > 0 && openId !== f.id && (
                <a className="btn btn-primary" href={`/child/forms?open=${f.id}`}>Fill in</a>
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
                        <input type="checkbox" name={`field_${i}`} value="yes" /> Yes
                      </label>
                    ) : (
                      <input className="input" name={`field_${i}`} required={field.required} placeholder={field.label} />
                    )}
                  </div>
                ))}
                <button className="btn btn-primary" type="submit">Submit</button>{" "}
                <a className="btn btn-ghost" href="/child/forms">Cancel</a>
              </form>
            )}
          </div>
        );
      })}

      <h3 className="subtitle mt-4">My submissions</h3>
      {mine.length === 0 && <p className="muted small">You haven&apos;t submitted any forms yet.</p>}
      {mine.map((r: any) => (
        <div className="list-item small" key={r.id}>
          <div><strong>{r.form_title}</strong> <span className="muted">({cap(r.kind)})</span></div>
          <span className="badge badge-green">Submitted</span>
        </div>
      ))}
    </div>
  );
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }