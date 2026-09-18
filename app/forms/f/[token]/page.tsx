import { getFormByShareToken } from "@/lib/store";
import { safeJson } from "@/lib/helpers";
import { submitPublicFormAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

type Field = { id: string; label: string; type: string; required?: boolean; options?: string[] };

export default async function PublicFormFillPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { sent?: string };
}) {
  const form = await getFormByShareToken(params.token);
  if (!form) return <p className="muted">This form link is invalid or expired.</p>;
  const fields = safeJson<Field[]>(form.fields_json, []);
  if (searchParams.sent) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: "40px auto" }}>
        <h1 className="title">Thank you</h1>
        <p className="muted">Your response to “{form.title}” was recorded.</p>
      </div>
    );
  }
  return (
    <div className="card" style={{ maxWidth: 560, margin: "40px auto" }}>
      <h1 className="title">{form.title}</h1>
      {form.description && <p className="muted small">{form.description}</p>}
      <form action={submitPublicFormAction} className="mt-3">
        <input type="hidden" name="token" value={params.token} />
        {fields.map((f, i) => (
          <div className="field" key={f.id ?? i}>
            <label className="label">{f.label}{f.required ? " *" : ""}</label>
            {f.type === "textarea" ? (
              <textarea className="textarea" name={`field_${i}`} required={!!f.required} />
            ) : (
              <input className="input" name={`field_${i}`} required={!!f.required} />
            )}
          </div>
        ))}
        <button className="btn btn-primary" type="submit">Submit</button>
      </form>
    </div>
  );
}
