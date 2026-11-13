import { getFormByShareToken } from "@/lib/store";
import { safeJson } from "@/lib/helpers";
import { submitPublicFormAction } from "@/lib/actions";
import { cookies } from "next/headers";
import { LANG_COOKIE, getDictionary, localeOf, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Field = { id: string; label: string; type: string; required?: boolean; options?: string[] };

// KID-2400: the public share-link form page ships its chrome in the
// visitor's language (kiddy_lang cookie; no session on this surface).
// Field labels and the form title/description are the daycare's own data.
export default async function PublicFormFillPage(
  props: {
    params: Promise<{ token: string }>;
    searchParams: Promise<{ sent?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const cookieLang = (await cookies()).get(LANG_COOKIE)?.value;
  const dict = getDictionary(localeOf(cookieLang));
  const form = await getFormByShareToken(params.token);
  if (!form) return <p className="muted">{tr(dict, "formsPublic.invalidLink")}</p>;
  const fields = safeJson<Field[]>(form.fields_json, []);
  if (searchParams.sent) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: "40px auto" }}>
        <h1 className="title">{tr(dict, "formsPublic.thanksTitle")}</h1>
        <p className="muted">{tr(dict, "formsPublic.thanksBody", { title: form.title })}</p>
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
        <button className="btn btn-primary" type="submit">{tr(dict, "forms.submit")}</button>
      </form>
    </div>
  );
}
