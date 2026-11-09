import { requireSession } from "@/lib/require";
import { i18nForAccount } from "@/lib/i18n-session";
import { getDictionary, tr } from "@/lib/i18n";
import { helpLanguageForRequest } from "@/lib/help-lang-server";
import { helpAudiencesForRole, loadHelpCenter, searchHelpCenter } from "@/lib/help-chatwoot";
import HelpCenter from "@/components/HelpCenter";

export const dynamic = "force-dynamic";

// KID-260: the account-menu "Help & Support" entry lands here — the staff
// knowledge base from the Chatwoot help center (KID-428), role-filtered. The
// ticket inbox keeps its own route (/portal/support-inbox); this page no
// longer advertises it (KID-428 acceptance: no "open the support inbox"
// button). The page chrome speaks the help language (KID-403).
export default async function PortalSupportPage(
  props: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const { locale } = await i18nForAccount(session.accountId);
  const language = await helpLanguageForRequest(searchParams.lang, locale);
  const dict = getDictionary(language);
  const audiences = helpAudiencesForRole(session.role);
  const query = typeof searchParams.q === "string" ? searchParams.q : undefined;

  const list = query ? null : await loadHelpCenter(language, audiences);
  const search = query ? await searchHelpCenter(query, language, audiences) : null;

  return (
    <div>
      <h1 className="title">{tr(dict, "topbar.helpSupport")}</h1>
      <HelpCenter
        groups={list && list.ok ? list.groups : null}
        language={language}
        copy={dict.help}
        basePath="/portal/support"
        query={query}
        searchResults={search && search.ok ? search.results : null}
      />
    </div>
  );
}
