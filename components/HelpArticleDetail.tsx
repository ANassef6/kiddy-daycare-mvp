// KID-260/KID-428: server-rendered article detail view shared by the family
// surface (/child/support/[id]) and the staff portal surface
// (/portal/support/[id]). The route enforces the audience gate before this
// component ever renders: it only ever receives a published Chatwoot article
// the signed-in role may open.
//
// KID-428: the body HTML from Chatwoot is pre-sanitized by
// sanitizeHelpHtml (lib/help-chatwoot): scripts/iframes/event attributes/
// javascript: URLs are stripped, the Notion cross-language footer is removed
// and the "Related:" line becomes the in-app related-article links below the
// body. If the footer named the article's other-language counterpart, the
// EN/AR switch jumps straight to that paired article id.
import Link from "next/link";
import { type HelpCopy } from "@/lib/i18n";
import { type HelpArticleRef, type HelpArticleView, type HelpLanguage } from "@/lib/help-chatwoot";
import HelpLanguageToggle from "@/components/HelpLanguageToggle";

export type HelpArticleDetailProps = {
  article: HelpArticleView;
  related: HelpArticleRef[];
  // Chatwoot article id of the same article in the other language (resolved
  // from the footer pairing key). null → the toggle falls back to the list.
  alternateId: number | null;
  copy: HelpCopy;
  basePath: string;
  language: HelpLanguage;
  exitHref: string;
  exitLabel: string;
};

export default function HelpArticleDetail({
  article,
  related,
  alternateId,
  copy,
  basePath,
  language,
  exitHref,
  exitLabel,
}: HelpArticleDetailProps) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const next = language === "en" ? "ar" : "en";
  return (
    <div data-testid="help-article" dir={dir}>
      <p className="small" style={{ marginBottom: 8 }}>
        <Link href={`${basePath}?lang=${language}`}>← {copy.backToList}</Link>
      </p>
      <div className="help-center">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 className="title" style={{ marginBottom: 4 }}>
              {article.title}
            </h2>
          </div>
          <HelpLanguageToggle
            current={language}
            basePath={`${basePath}/${article.id}`}
            alternateHref={alternateId !== null ? `${basePath}/${alternateId}?lang=${next}` : undefined}
            label={copy.langLabel}
            labels={{ en: copy.langEn, ar: copy.langAr }}
          />
        </div>
        <div
          className="help-article-body"
          dir={dir}
          data-testid="help-article-body"
          dangerouslySetInnerHTML={{ __html: article.html }}
        />
        {related.length > 0 && (
          <div style={{ marginTop: 14 }} data-testid="help-article-related">
            <div className="label">{copy.articleRelated}</div>
            <div>
              {related.map((item) => (
                <div key={item.id}>
                  <Link href={`${basePath}/${item.id}?lang=${language}`}>{item.title}</Link>
                </div>
              ))}
            </div>
          </div>
        )}
        <p style={{ marginTop: 18 }}>
          <a className="btn btn-ghost" href={exitHref}>
            {exitLabel}
          </a>
        </p>
      </div>
    </div>
  );
}
