import { requireFamilyPage } from "@/lib/require";
import { ticketsForAccount } from "@/lib/store";
import { cap } from "@/lib/helpers";
import { createSupportTicketAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { getDictionary, tr } from "@/lib/i18n";
import { helpLanguageForRequest } from "@/lib/help-lang-server";
import { helpAudiencesForRole, loadHelpCenter, searchHelpCenter } from "@/lib/help-chatwoot";
import HelpCenter from "@/components/HelpCenter";

export const dynamic = "force-dynamic";

// KID-260: the parent Help & support landing is the Chatwoot knowledge base
// (KID-428; search bar, EN/AR toggle) with the support-ticket form preserved
// below as the human escalation path. The old hardcoded FAQ block, the
// KID-388 bundled article set and the Notion export behind it are all gone.
//
// KID-403: the whole surface chrome (title, KB copy, support form, requests
// list) speaks the help language — the same resolved value that picks the
// article set and the direction — not the account's app language.
export default async function ParentSupportPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const session = await requireFamilyPage("/child/support");
  const { locale } = await i18nForAccount(session.accountId);
  const language = await helpLanguageForRequest(searchParams.lang, locale);
  const dict = getDictionary(language);
  const audiences = helpAudiencesForRole(session.role);
  const query = typeof searchParams.q === "string" ? searchParams.q : undefined;

  const list = query ? null : await loadHelpCenter(language, audiences);
  const search = query ? await searchHelpCenter(query, language, audiences) : null;
  const tickets = await ticketsForAccount(session.accountId);

  return (
    <div>
      <h1 className="title">{tr(dict, "help.title")}</h1>

      <HelpCenter
        groups={list && list.ok ? list.groups : null}
        language={language}
        copy={dict.help}
        basePath="/child/support"
        requestFormHref="#support-form"
        query={query}
        searchResults={search && search.ok ? search.results : null}
      />

      <div className="grid mt-4" id="support-form">
        <div className="card">
          <h3 className="subtitle">{tr(dict, "help.sendRequest")}</h3>
          <p className="small muted">{tr(dict, "help.requestIntro")}</p>
          {typeof searchParams.sent === "string" && (
            <p className="badge badge-green mb-4" style={{ display: "inline-block" }}>
              {tr(dict, "help.requestSent")}
            </p>
          )}
          <form action={createSupportTicketAction}>
            <div className="field">
              <label className="label">{tr(dict, "help.formSubject")}</label>
              <input className="input" name="subject" required placeholder={tr(dict, "help.formSubjectPlaceholder")} />
            </div>
            <div className="field">
              <label className="label">{tr(dict, "help.formMessage")}</label>
              <textarea className="textarea" name="body" required />
            </div>
            <button className="btn btn-primary" type="submit">
              {tr(dict, "help.sendRequest")}
            </button>
          </form>
        </div>
        <div className="card">
          <h3 className="subtitle">{tr(dict, "help.myRequests")}</h3>
          {tickets.length === 0 && <p className="muted small">{tr(dict, "help.noRequests")}</p>}
          {tickets.map((t: any) => (
            <div className="list-item small" key={t.id}>
              <div>
                <strong>{t.subject}</strong>
                <br />
                <span className="muted">{t.body}</span>
              </div>
              <span className={t.status === "closed" ? "badge badge-gray" : t.status === "answered" ? "badge badge-green" : "badge"}>
                {cap(t.status)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
