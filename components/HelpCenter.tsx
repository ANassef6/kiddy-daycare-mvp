// KID-260/KID-428: the Help Center list view shared by the family surface
// (/child/support) and the staff portal surface (/portal/support).
//
// KID-428: this is now a server component. The article set (and the search
// ranking) comes from the Chatwoot help center via lib/help-chatwoot — the
// bundled 96-record file is retired, so the view can never drift back to stale
// copies. The EN/AR control stays the client island (components/
// HelpLanguageToggle) with the KID-403 contract; the search box is a plain GET
// form so Chatwoot's own search runs on the server flight the submit triggers.
//
// The family surface keeps its on-page support-request form below the list as
// the human escalation path. The staff surface no longer links to the ticket
// inbox from here (KID-428 acceptance: no "open the support inbox" button).
import Link from "next/link";
import { type HelpCopy } from "@/lib/i18n";
import { type HelpArticleRef, type HelpLanguage } from "@/lib/help-chatwoot";
import HelpLanguageToggle from "@/components/HelpLanguageToggle";

export type HelpCenterGroup = { area: string; ref: HelpArticleRef };

function groupByArea(
  groups: readonly HelpCenterGroup[],
): { area: string; articles: HelpArticleRef[] }[] {
  const out: { area: string; articles: HelpArticleRef[] }[] = [];
  for (const { area, ref } of groups) {
    const last = out[out.length - 1];
    if (last && last.area === area) last.articles.push(ref);
    else out.push({ area, articles: [ref] });
  }
  return out;
}

export type HelpCenterProps = {
  // Server-resolved, Chatwoot-backed article groups for the current language.
  // `null` means the help center is not configured (or its fetch failed) — the
  // view must degrade to the unavailable card, never to bundled articles.
  groups: HelpCenterGroup[] | null;
  language: HelpLanguage;
  copy: HelpCopy;
  basePath: string;
  // Family surface: the no-result/empty state exits to the on-page request
  // form. Staff surface: no inbox link anymore.
  requestFormHref?: string;
  // Server-side Chatwoot search results for the active ?q= (null when the
  // page was opened without a query).
  query?: string;
  searchResults: HelpArticleRef[] | null;
};

export default function HelpCenter({
  groups,
  language,
  copy,
  basePath,
  requestFormHref,
  query,
  searchResults,
}: HelpCenterProps) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const trimmedQuery = (query ?? "").trim();
  const hasQuery = trimmedQuery.length > 0;
  const resultsCount = (count: number) => copy.resultsCount.replaceAll("{count}", String(count));
  const noResultsTitle = copy.noResultsTitle.replaceAll("{query}", trimmedQuery);
  const articleHref = (article: HelpArticleRef) => `${basePath}/${article.id}?lang=${language}`;

  return (
    <div className="help-center" data-testid="help-center" dir={dir}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h3 className="subtitle" style={{ marginBottom: 2 }}>
            {copy.title}
          </h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            {copy.subtitle}
          </p>
        </div>
        <HelpLanguageToggle
          current={language}
          basePath={basePath}
          label={copy.langLabel}
          labels={{ en: copy.langEn, ar: copy.langAr }}
        />
      </div>

      <form action={basePath} method="get" role="search">
        <input type="hidden" name="lang" value={language} />
        <div className="field">
          <label className="label" htmlFor="help-search-input">
            {copy.searchLabel}
          </label>
          <input
            id="help-search-input"
            className="input"
            type="search"
            name="q"
            defaultValue={query ?? ""}
            placeholder={copy.searchPlaceholder}
          />
        </div>
      </form>

      {hasQuery && searchResults !== null && (
        <p className="small muted" data-testid="help-results-count">
          {resultsCount(searchResults.length)}
        </p>
      )}

      {hasQuery && (
        <>
          <div className="help-list" data-testid="help-search-results">
            {(searchResults ?? []).map((article) => (
              <Link key={article.id} className="help-article-row" href={articleHref(article)}>
                <span className="help-article-title">{article.title}</span>
              </Link>
            ))}
          </div>
          {searchResults !== null && searchResults.length === 0 && (
            <div className="card help-empty-state" data-testid="help-empty-state">
              <p className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
                {noResultsTitle}
              </p>
              <p className="small muted" style={{ marginTop: 0 }}>
                {copy.noResultsHint}
              </p>
              {requestFormHref && (
                <a className="btn btn-ghost" href={requestFormHref}>
                  {copy.sendRequest}
                </a>
              )}
            </div>
          )}
        </>
      )}

      {!hasQuery && (
        <div>
          {groups === null ? (
            <div className="card help-empty-state" data-testid="help-unavailable">
              <p className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
                {copy.unavailableTitle}
              </p>
              <p className="small muted" style={{ marginTop: 0 }}>
                {copy.unavailableHint}
              </p>
              {requestFormHref && (
                <a className="btn btn-ghost" href={requestFormHref}>
                  {copy.sendRequest}
                </a>
              )}
            </div>
          ) : (
            <>
              {groupByArea(groups).map(({ area, articles }) => (
                <div key={area} className="help-area-group">
                  <div className="help-area-head">{area}</div>
                  <div className="help-list">
                    {articles.map((article) => (
                      <Link key={article.id} className="help-article-row" href={articleHref(article)}>
                        <span className="help-article-title">{article.title}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
              <p className="small muted" data-testid="help-results-count">
                {resultsCount(groups.length)}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
