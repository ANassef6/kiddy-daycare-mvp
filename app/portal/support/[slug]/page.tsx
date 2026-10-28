import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { helpLanguageForRequest } from "@/lib/help-lang";
import {
  HELP_ARTICLES,
  helpArticleBySlug,
  helpAudiencesForRole,
  relatedHelpArticles,
} from "@/lib/help-kb";
import HelpArticleDetail from "@/components/HelpArticleDetail";

export const dynamic = "force-dynamic";

// KID-260: staff-side article detail. Family roles hitting a staff-only
// article URL get a not-found here, and staff roles cannot open parent-only
// article URLs — the URL gate mirrors the list filter exactly.
export default async function PortalSupportArticlePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const session = requireSession();
  const { dict, locale } = await i18nForAccount(session.accountId);
  const language = await helpLanguageForRequest(searchParams.lang, locale);
  const audiences = helpAudiencesForRole(session.role);
  const article = helpArticleBySlug(HELP_ARTICLES, params.slug, audiences, language);
  if (!article) notFound();
  const { related, bodyWithoutRelated } = relatedHelpArticles(HELP_ARTICLES, article, audiences);
  return (
    <HelpArticleDetail
      article={article}
      related={related}
      relatedBody={bodyWithoutRelated}
      dict={dict}
      basePath="/portal/support"
      language={language}
      backHref={`/portal/support?lang=${language}`}
      contactHref="/portal/support-inbox"
      contactLabel={tr(dict, "help.contactSupport")}
    />
  );
}
