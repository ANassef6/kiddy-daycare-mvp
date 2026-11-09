import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import { i18nForAccount } from "@/lib/i18n-session";
import { getDictionary, tr } from "@/lib/i18n";
import { helpLanguageForRequest } from "@/lib/help-lang-server";
import { helpAudiencesForRole, loadHelpArticle } from "@/lib/help-chatwoot";
import HelpArticleDetail from "@/components/HelpArticleDetail";

export const dynamic = "force-dynamic";

// KID-260/KID-428: staff-side Chatwoot article detail (id-based URL). Family
// roles hitting a staff-only article URL get a not-found here, and staff
// roles cannot open parent-only article URLs — the URL gate mirrors the list
// filter exactly. The exit button keeps the ticket-inbox escalation path
// (this is a distinct page from the Help & Support list, which carries no
// inbox link since KID-428).
export default async function PortalSupportArticlePage(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const session = await requireSession();
  const { locale } = await i18nForAccount(session.accountId);
  const language = await helpLanguageForRequest(searchParams.lang, locale);
  const dict = getDictionary(language);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const load = await loadHelpArticle(id, language, helpAudiencesForRole(session.role));
  if (!load.ok) notFound();
  return (
    <HelpArticleDetail
      article={load.article}
      related={load.related}
      alternateId={load.alternateId}
      copy={dict.help}
      basePath="/portal/support"
      language={language}
      exitHref="/portal/support-inbox"
      exitLabel={tr(dict, "help.contactSupport")}
    />
  );
}
