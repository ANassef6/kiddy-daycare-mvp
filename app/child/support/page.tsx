import { requireFamilyPage } from "@/lib/require";
import { i18nForAccount } from "@/lib/i18n-session";
import { getDictionary, tr } from "@/lib/i18n";
import { helpLanguageForRequest } from "@/lib/help-lang-server";
import { helpAudiencesForRole, loadHelpCenter, searchHelpCenter } from "@/lib/help-chatwoot";
import HelpCenter from "@/components/HelpCenter";

export const dynamic = "force-dynamic";

// KID-260: the parent Help & support landing is the Chatwoot knowledge base
// (KID-428; search bar, EN/AR toggle). The old hardcoded FAQ block, the
// KID-388 bundled article set and the Notion export behind it are all gone.
//
// KID-478 item 6: the manual "Send request" form and the "My requests" list
// were removed with it — the Chatwoot knowledge base plus the live-chat
// bubble (app/layout.tsx ChatwootWidget) is the whole parent-facing support
// surface. The staff support inbox and the support_ticket table stay for
// historical/staff use only.
//
// KID-403: the whole surface chrome (title, KB copy) speaks the help language
// — the same resolved value that picks the article set and the direction —
// not the account's app language.
export default async function ParentSupportPage(
  props: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireFamilyPage("/child/support");
  const { locale } = await i18nForAccount(session.accountId);
  const language = await helpLanguageForRequest(searchParams.lang, locale);
  const dict = getDictionary(language);
  const audiences = helpAudiencesForRole(session.role);
  const query = typeof searchParams.q === "string" ? searchParams.q : undefined;

  const list = query ? null : await loadHelpCenter(language, audiences);
  const search = query ? await searchHelpCenter(query, language, audiences) : null;

  return (
    <div>
      <h1 className="title">{tr(dict, "help.title")}</h1>

      <HelpCenter
        groups={list && list.ok ? list.groups : null}
        language={language}
        copy={dict.help}
        basePath="/child/support"
        query={query}
        searchResults={search && search.ok ? search.results : null}
      />
    </div>
  );
}
