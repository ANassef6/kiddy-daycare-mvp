// KID-260: server-rendered article detail view shared by the family surface
// (/child/support/[slug]) and the staff portal surface (/portal/support/[slug]).
// The audience check has already happened in the route: it only ever receives a
// published article the signed-in role may open.
import Link from "next/link";
import { tr, type Dict } from "@/lib/i18n";
import { type HelpArticle, type HelpLanguage } from "@/lib/help-kb";
import { HelpArticleBody } from "@/lib/help-markdown";

export type HelpArticleDetailProps = {
  article: HelpArticle;
  related: HelpArticle[];
  relatedBody: string;
  dict: Dict;
  basePath: string;
  language: HelpLanguage;
  backHref: string;
  contactHref: string;
  contactLabel: string;
};

export default function HelpArticleDetail({
  article,
  related,
  relatedBody,
  dict,
  basePath,
  language,
  backHref,
  contactHref,
  contactLabel,
}: HelpArticleDetailProps) {
  const dir = language === "ar" ? "rtl" : "ltr";
  return (
    <div data-testid="help-article" dir={dir}>
      <p className="small" style={{ marginBottom: 8 }}>
        <Link href={`${basePath}?lang=${language}`}>← {tr(dict, "help.backToList")}</Link>
      </p>
      <div className="help-center">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 className="title" style={{ marginBottom: 4 }}>
              {article.title}
            </h2>
            <p className="small muted" style={{ margin: 0 }}>
              <span dir="ltr">{article.area}</span>
            </p>
          </div>
          <div className="help-lang-toggle" role="group" aria-label={tr(dict, "help.langLabel")} style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {(["en", "ar"] as HelpLanguage[]).map((code) => (
              <Link
                key={code}
                className={code === language ? "btn btn-primary" : "btn btn-ghost"}
                href={`${basePath}/${article.slug}?lang=${code}`}
                lang={code}
                dir={code === "ar" ? "rtl" : "ltr"}
                style={{ padding: "4px 10px", fontSize: 13 }}
              >
                {tr(dict, code === "en" ? "help.langEn" : "help.langAr")}
              </Link>
            ))}
          </div>
        </div>
        <HelpArticleBody body={relatedBody} dir={dir} />
        {related.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="label">{tr(dict, "help.articleRelated")}</div>
            <div>
              {related.map((item) => (
                <div key={item.slug}>
                  <Link href={`${basePath}/${item.slug}?lang=${language}`}>{item.title}</Link>
                </div>
              ))}
            </div>
          </div>
        )}
        <p style={{ marginTop: 18 }}>
          <Link className="btn btn-ghost" href={contactHref}>
            {contactLabel}
          </Link>
        </p>
      </div>
    </div>
  );
}
