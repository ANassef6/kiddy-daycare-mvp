import { notFound } from "next/navigation";
import { requireFamilyPage } from "@/lib/require";
import { i18nForAccount } from "@/lib/i18n-session";
import { getDictionary, tr } from "@/lib/i18n";
import { helpLanguageForRequest } from "@/lib/help-lang-server";
import { helpAudiencesForRole, loadHelpArticle } from "@/lib/help-chatwoot";
import HelpArticleDetail from "@/components/HelpArticleDetail";

export const dynamic = "force-dynamic";

// KID-260/KID-428: article detail for the family Help Center (id-based
// Chatwoot URL). The audience filter is enforced again here on direct URL
// access: a family viewer cannot open a staff-only article URL, and nothing
// unpublished renders (both degrade to a not-found, consistent with the
// /child page family gates). The support-request form below the list stays
// the human escalation path.
export default async function ParentSupportArticlePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const session = await requireFamilyPage(`/child/support/${params.id}`);
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
      basePath="/child/support"
      language={language}
      exitHref="/child/support#support-form"
      exitLabel={tr(dict, "help.articleContactExit")}
    />
  );
}
