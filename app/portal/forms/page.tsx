import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listForms, formResponses, formResponseStatusCounts, formResponsesForInstitute, FORM_RESPONSE_STATUSES, listChildren, listRooms, staffRooms } from "@/lib/store";
import { firstInstituteId, cap } from "@/lib/helpers";
import { createFormAction, generateFormShareLinkAction, setFormResponseStatusAction } from "@/lib/actions";
import { recordToolUsage } from "@/lib/tool-usage";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr, fmtDateTimeFor, type Dict } from "@/lib/i18n";
import { queryGet } from "@/lib/db";
import RecipientsPicker from "@/components/RecipientsPicker";

export const dynamic = "force-dynamic";

function stripHtml(v: unknown): string {
  return String(v ?? "").replace(/<[^>]*>/g, "");
}

function statusLabelFor(dict: Dict, s: string): string {
  const map: Record<string, string> = {
    new: "formsAdmin.funnelNew",
    viewed: "formsAdmin.funnelViewed",
    contacted: "formsAdmin.funnelContacted",
    completed: "formsAdmin.funnelCompleted",
    archived: "formsAdmin.funnelArchived",
  };
  const key = map[s];
  return key ? tr(dict, key) : s;
}

function kindLabel(dict: Dict, kind: unknown): string {
  const k = String(kind ?? "");
  if (k === "form") return tr(dict, "forms.kindForm");
  if (k === "survey") return tr(dict, "forms.kindSurvey");
  if (k === "list") return tr(dict, "formsAdmin.typeList");
  return cap(k);
}

export default async function PortalFormsPage(
  props: {
    searchParams: Promise<{ view?: string; q?: string; status?: string; type?: string; form?: string; error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const { dict, locale, timeZone } = await i18nForAccount(session.accountId);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{tr(dict, "formsAdmin.noInstitute")}</p>;
  await recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "forms", source: "portal", metadata: null });
  const forms = await listForms(instituteId);
  const viewId = searchParams.view;
  const active = forms.find((f: any) => f.id === viewId);

  // KID-86 #10: Inquiries live inside Smart Forms — every submission across all
  // forms, each row showing the source form title, with a filter by form.
  if (viewId === "inquiries") {
    const all = await formResponsesForInstitute(instituteId);
    const q = (searchParams.q ?? "").toLowerCase();
    const statusFilter = searchParams.status ?? "";
    const formFilter = searchParams.form ?? "";

    const byForm = new Map<string, number>();
    for (const r of all) {
      const key = String(r.form_id);
      byForm.set(key, (byForm.get(key) ?? 0) + 1);
    }

    let rows = all;
    if (formFilter) rows = rows.filter((r) => String(r.form_id) === formFilter);
    if (statusFilter) rows = rows.filter((r) => String(r.status ?? "new") === statusFilter);
    if (q) rows = rows.filter((r) => String(r.answers_json ?? "").toLowerCase().includes(q) || `${r.respondent_name ?? ""} ${r.first_name ?? ""} ${r.last_name ?? ""}`.toLowerCase().includes(q));

    const title = formFilter ? forms.find((f: any) => String(f.id) === formFilter)?.title : null;

    return (
      <div>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 className="title" style={{ marginBottom: 0 }}>{tr(dict, "nav.inquiries")}</h1>
            <Link className="small muted" href="/portal/forms">{tr(dict, "formsAdmin.allFormsLink")}</Link>
          </div>
          <span className="muted small">{tr(dict, "formsAdmin.submissionsCount", { shown: rows.length, total: all.length })}</span>
        </div>

        <div className="card mb-4">
          <form method="get" className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="view" value="inquiries" />
            <input className="input" name="q" defaultValue={searchParams.q ?? ""} placeholder={tr(dict, "formsAdmin.searchInquiriesPlaceholder")} style={{ minWidth: 200 }} />
            <select className="select" name="form" defaultValue={formFilter} style={{ maxWidth: 240 }}>
              <option value="">{tr(dict, "formsAdmin.allFormsOption")}</option>
              {forms.map((f: any) => (
                <option key={f.id} value={String(f.id)}>{f.title} ({byForm.get(String(f.id)) ?? 0})</option>
              ))}
            </select>
            <select className="select" name="status" defaultValue={statusFilter} style={{ maxWidth: 150 }}>
              <option value="">{tr(dict, "formsAdmin.anyStatusOption")}</option>
              {FORM_RESPONSE_STATUSES.map((s) => (
                <option key={s} value={s}>{statusLabelFor(dict, s)}</option>
              ))}
            </select>
            <button className="btn btn-ghost small" type="submit">{tr(dict, "formsAdmin.apply")}</button>
            <Link className="btn btn-ghost small" href="/portal/forms?view=inquiries">{tr(dict, "formsAdmin.clear")}</Link>
          </form>
        </div>

        <div className="card">
          {formFilter && <p className="small muted mt-0 mb-2">{tr(dict, "formsAdmin.filteredByForm", { title: title ?? "—" })}</p>}
          {rows.length === 0 && <p className="muted small">{tr(dict, "formsAdmin.noInquiriesMatch")}</p>}
          {rows.map((r: any) => {
            let snippet = "";
            try {
              const answers = JSON.parse(String(r.answers_json ?? "{}")) as Record<string, string>;
              snippet = Object.entries(answers).slice(0, 2).map(([k, v]) => `${stripHtml(k)}: ${String(v).slice(0, 60)}`).join(" · ");
            } catch {
              snippet = "";
            }
            return (
              <div className="list-item" key={r.id}>
                <div className="small" style={{ flex: 1, minWidth: 0 }}>
                  <Link href={`/portal/forms?view=${r.form_id}`} style={{ fontWeight: 700, color: "inherit" }}>{r.form_title}</Link>
                  <span className="badge badge-gray" style={{ marginInlineStart: 8 }}>{kindLabel(dict, r.form_kind)}</span>
                  <div>
                    <strong>{r.respondent_name ?? tr(dict, "formsAdmin.anonymous")}</strong>
                    {r.first_name ? ` ${tr(dict, "formsAdmin.forChild", { first: r.first_name, last: r.last_name ?? "" })}` : ""}
                    <span className="muted"> · {fmtDateTimeFor(locale, r.created_at, timeZone)}</span>
                    <span className="badge" style={{ marginInlineStart: 8 }}>{statusLabelFor(dict, String(r.status ?? "new"))}</span>
                  </div>
                  {snippet && <div className="muted mt-1">{snippet}</div>}
                </div>
                <form action={setFormResponseStatusAction} className="row" style={{ gap: 6, alignItems: "center" }}>
                  <input type="hidden" name="responseId" value={String(r.id)} />
                  <input type="hidden" name="formId" value={String(r.form_id)} />
                  <select className="select small" name="status" defaultValue={String(r.status ?? "new")} style={{ maxWidth: 140 }}>
                    {FORM_RESPONSE_STATUSES.map((s) => (
                      <option key={s} value={s}>{statusLabelFor(dict, s)}</option>
                    ))}
                  </select>
                  <button className="btn btn-ghost small" type="submit">{tr(dict, "formsAdmin.set")}</button>
                </form>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Funnel view: submissions with per-row statuses (New → Viewed → Contacted → Completed → Archived)
  const responses = active ? await formResponses(active.id) : [];
  const counts = active ? await formResponseStatusCounts(active.id) : {};
  const entered = responses.reduce((n, r) => n + (String(r.status) !== "archived" ? 1 : 0), 0);

  if (viewId && active) {
    const funnel = [
      ["new", tr(dict, "formsAdmin.funnelNew"), counts.new ?? 0],
      ["viewed", tr(dict, "formsAdmin.funnelViewed"), counts.viewed ?? 0],
      ["contacted", tr(dict, "formsAdmin.funnelContacted"), counts.contacted ?? 0],
      ["completed", tr(dict, "formsAdmin.funnelCompleted"), counts.completed ?? 0],
      ["archived", tr(dict, "formsAdmin.funnelArchived"), counts.archived ?? 0],
    ] as const;
    return (
      <div>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 className="title" style={{ marginBottom: 0 }}>{tr(dict, "formsAdmin.funnelTitle", { title: active.title })}</h1>
            <Link className="small muted" href="/portal/forms">{tr(dict, "formsAdmin.allFormsLink")}</Link>
          </div>
          <Link className="btn btn-ghost small" href={`/forms/f/${active.share_token}`} target="_blank">{tr(dict, "formsAdmin.openParentLink")}</Link>
        </div>

        <div className="card mb-4">
          <h3 className="subtitle">{tr(dict, "formsAdmin.submissionFunnel")}</h3>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            {funnel.map(([key, label, n], idx) => (
              <div key={key} className="row" style={{ alignItems: "center", gap: 6 }}>
                <div className="card" style={{ minWidth: 130, textAlign: "center", padding: "12px 16px" }}>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>{n}</div>
                  <div className="muted small">{label}</div>
                </div>
                {idx < funnel.length - 1 && <span className="muted">→</span>}
              </div>
            ))}
          </div>
          <p className="small muted mt-2">{tr(dict, "formsAdmin.openTotalSubmissions", { open: entered, total: responses.length })}</p>
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="subtitle">{tr(dict, "formsAdmin.submissionsHeading")}</h3>
            <span className="muted small">{tr(dict, "formsAdmin.totalCount", { count: responses.length })}</span>
          </div>
          {responses.length === 0 && <p className="muted small">{tr(dict, "formsAdmin.noSubmissionsYet")}</p>}
          {responses.map((r: any) => {
            const answers = JSON.parse(String(r.answers_json ?? "{}")) as Record<string, string>;
            const snippet = Object.entries(answers).slice(0, 3).map(([k, v]) => `${stripHtml(k)}: ${String(v).slice(0, 60)}`).join(" · ");
            return (
              <div className="list-item" key={r.id}>
                <div className="small" style={{ flex: 1 }}>
                  <strong>{r.respondent_name ?? tr(dict, "formsAdmin.anonymous")}</strong>
                  {r.first_name ? ` ${tr(dict, "formsAdmin.forChild", { first: r.first_name, last: r.last_name ?? "" })}` : ""}
                  <span className="muted"> · {fmtDateTimeFor(locale, r.created_at, timeZone)}</span>
                  <div className="muted mt-1">{snippet}</div>
                </div>
                <form action={setFormResponseStatusAction} className="row" style={{ gap: 6, alignItems: "center" }}>
                  <input type="hidden" name="responseId" value={String(r.id)} />
                  <input type="hidden" name="formId" value={String(active.id)} />
                  <select className="select small" name="status" defaultValue={String(r.status ?? "new")} style={{ maxWidth: 140 }}>
                    {FORM_RESPONSE_STATUSES.map((s) => (
                      <option key={s} value={s}>{statusLabelFor(dict, s)}</option>
                    ))}
                  </select>
                  <button className="btn btn-ghost small" type="submit">{tr(dict, "formsAdmin.set")}</button>
                </form>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // KID-2485: the builder can create surveys too, so it receives the same
  // picker inputs as the dedicated Surveys composer.
  const [children, rooms] = await Promise.all([listChildren(instituteId), listRooms(instituteId)]);
  let assignedRoomIds: string[] = [];
  if (session.role === "staff" || session.role === "carer") {
    const me = await queryGet("SELECT staff_id FROM account WHERE id = ?", session.accountId);
    if (me?.staff_id) {
      assignedRoomIds = (await staffRooms(String(me.staff_id))).map((r) => String(r.id));
    }
  }
  const q = (searchParams.q ?? "").toLowerCase();
  const statusFilter = searchParams.status ?? "";
  const typeFilter = searchParams.type ?? "";
  const rows = forms.filter((f: any) => {
    if (typeFilter && f.kind !== typeFilter) return false;
    const publish = f.share_token ? "live" : "draft";
    if (statusFilter && publish !== statusFilter) return false;
    if (q && !`${f.title} ${f.kind}`.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div>
      {searchParams.error === "form-title" && (
        <div role="alert" className="card mb-3" style={{ borderLeft: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{tr(dict, "formsAdmin.titleRequired")}</p>
        </div>
      )}
      {searchParams.error === "form-recipients" && (
        <div role="alert" className="card mb-3" style={{ borderLeft: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{tr(dict, "surveysAdmin.recipientsRequired")}</p>
        </div>
      )}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="title" style={{ marginBottom: 0 }}>{tr(dict, "formsAdmin.pageTitle")}</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>{tr(dict, "formsAdmin.pageSubtitle")}</p>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <Link className="btn btn-ghost" href="/portal/forms?view=inquiries">{tr(dict, "nav.inquiries")}</Link>
          <details style={{ position: "relative" }}>
            <summary className="btn btn-primary" style={{ cursor: "pointer", listStyle: "none" }}>{tr(dict, "formsAdmin.buildNewFormBtn")}</summary>
            <div style={{ position: "absolute", insetInlineEnd: 0, top: "calc(100% + 6px)", width: 560, maxWidth: "92vw", zIndex: 50 }}>
              <CreateFormCard
                dict={dict}
                role={session.role}
                assignedRoomIds={assignedRoomIds}
                childOptions={children}
                rooms={rooms}
              />
            </div>
          </details>
        </div>
      </div>

      <div className="card mb-4">
        <form method="get" className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="input" name="q" defaultValue={searchParams.q ?? ""} placeholder={tr(dict, "formsAdmin.searchTitlePlaceholder")} style={{ minWidth: 240 }} />
          <select className="select" name="type" defaultValue={typeFilter} style={{ maxWidth: 160 }}>
            <option value="">{tr(dict, "formsAdmin.allTypesOption")}</option>
            <option value="form">{tr(dict, "forms.kindForm")}</option>
            <option value="survey">{tr(dict, "forms.kindSurvey")}</option>
            <option value="list">{tr(dict, "formsAdmin.typeList")}</option>
          </select>
          <select className="select" name="status" defaultValue={statusFilter} style={{ maxWidth: 150 }}>
            <option value="">{tr(dict, "formsAdmin.anyPublishStateOption")}</option>
            <option value="live">{tr(dict, "formsAdmin.stateLive")}</option>
            <option value="draft">{tr(dict, "formsAdmin.stateDraft")}</option>
          </select>
          <button className="btn btn-ghost small" type="submit">{tr(dict, "formsAdmin.apply")}</button>
          <Link className="btn btn-ghost small" href="/portal/forms">{tr(dict, "formsAdmin.clear")}</Link>
        </form>
      </div>

      <div className="card">
        <table className="data">
          <thead>
            <tr><th>{tr(dict, "common.title")}</th><th>{tr(dict, "formsAdmin.colPayment")}</th><th>{tr(dict, "formsAdmin.colFormType")}</th><th>{tr(dict, "formsAdmin.colSubmissions")}</th><th>{tr(dict, "formsAdmin.colCreatedBy")}</th><th>{tr(dict, "formsAdmin.colPublish")}</th><th>{tr(dict, "common.status")}</th><th>{tr(dict, "common.actions")}</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="muted small">{tr(dict, "formsAdmin.noFormsMatch")}</td></tr>}
            {rows.map((f: any) => {
              const published = !!f.share_token;
              return (
                <tr key={f.id}>
                  <td><strong>{f.title}</strong>{f.description ? <div className="muted small">{f.description}</div> : null}</td>
                  <td className="small muted">—</td>
                  <td className="small">{kindLabel(dict, f.kind)}</td>
                  <td className="small"><Link href={`/portal/forms?view=${f.id}`} className="badge" style={{ textDecoration: "none" }}>{f.response_count}</Link></td>
                  <td className="small">{f.created_by_name ?? "—"}</td>
                  <td className="small">
                    <span className={published ? "badge badge-green" : "badge badge-gray"}>{published ? tr(dict, "formsAdmin.stateLive") : tr(dict, "formsAdmin.stateDraft")}</span>
                  </td>
                  <td className="small">
                    {f.share_token ? <a className="small muted" href={`/forms/f/${f.share_token}`} target="_blank">/forms/f/{String(f.share_token).slice(0, 10)}…</a> : tr(dict, "formsAdmin.notPublished")}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Link className="btn btn-ghost small" href={`/portal/forms?view=${f.id}`}>{tr(dict, "formsAdmin.viewSubmissionsBtn")}</Link>
                      <form action={generateFormShareLinkAction}>
                        <input type="hidden" name="formId" value={String(f.id)} />
                        <button className="btn btn-ghost small" type="submit">{published ? tr(dict, "formsAdmin.regenerateLinkBtn") : tr(dict, "formsAdmin.publishBtn")}</button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateFormCard({
  dict,
  role,
  assignedRoomIds,
  childOptions,
  rooms,
}: {
  dict: Dict;
  role: string;
  assignedRoomIds: string[];
  childOptions: any[];
  rooms: any[];
}) {
  return (
    <div className="card">
      <form action={createFormAction}>
        <div className="row">
          <div className="col field"><label className="label">{tr(dict, "common.title")}</label><input className="input" name="title" required /></div>
          <div className="col field">
            <label className="label">{tr(dict, "formsAdmin.fieldKind")}</label>
            <select className="select" name="kind">
              <option value="form">{tr(dict, "forms.kindForm")}</option>
              <option value="survey">{tr(dict, "forms.kindSurvey")}</option>
              <option value="list">{tr(dict, "forms.kindList")}</option>
            </select>
          </div>
        </div>
        <div className="field"><label className="label">{tr(dict, "common.description")}</label><input className="input" name="description" /></div>
        <div className="field">
          <label className="label">{tr(dict, "surveysAdmin.recipientsLabel")}</label>
          <RecipientsPicker
            dict={dict}
            childOptions={childOptions.map((c: any) => ({ id: String(c.id), first_name: String(c.first_name), last_name: String(c.last_name), room_id: c.room_id ? String(c.room_id) : null, room_name: c.room_name ? String(c.room_name) : null }))}
            rooms={rooms.map((r: any) => ({ id: String(r.id), name: String(r.name) }))}
            role={role}
            assignedRoomIds={assignedRoomIds}
          />
          <span className="small muted">{tr(dict, "formsAdmin.recipientsSurveyHint")}</span>
        </div>
        <h4 className="subtitle">{tr(dict, "formsAdmin.questionsHeading")}</h4>
        {Array.from({ length: 3 }).map((_, i) => (
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
        <button className="btn btn-primary" type="submit">{tr(dict, "formsAdmin.createFormBtn")}</button>
      </form>
    </div>
  );
}