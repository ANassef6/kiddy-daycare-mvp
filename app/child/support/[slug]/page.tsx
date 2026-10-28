import { notFound } from "next/navigation";
import { requireFamilyPage } from "@/lib/require";
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

// KID-260: article detail for the family Help Center. The audience filter is
// enforced again here on direct URL access: a family viewer cannot open a
// staff- or owner-only article URL, and nothing drafts or unpublished renders
// (both degrade to a not-found, consistent with the /child page family gates).
export default async function ParentSupportArticlePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const session = await requireFamilyPage(`/child/support/${params.slug}`);
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
      basePath="/child/support"
      language={language}
      backHref={`/child/support?lang=${language}`}
      contactHref="/child/support#support-form"
      contactLabel={tr(dict, "help.articleContactExit")}
    />
  );
}
