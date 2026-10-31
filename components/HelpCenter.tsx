"use client";

// KID-260: the Knowledge Base list view shared by the family surface
// (/child/support) and the staff portal surface (/portal/support).
//
// The server already narrowed `articles` to the viewer's audiences + published
// only (both languages, so the toggle never makes authority decisions; only the
// selected language renders at any time, never mixed).
//
// The help language is independent of the account app language and defaults to
// it; the choice persists through localStorage + a cookie (the cookie keeps the
// server-rendered article detail pages in the same language).
//
// KID-403: the chrome copy (title, subtitle, search label/placeholder, results
// count, empty state) follows the selected help language too — the page hands
// over both dictionaries and the chrome strings resolve from the language state
// at render time, so they flip together with the article set and the direction.
// The toggle also syncs the URL (?lang=) via router.replace (cookie already
// written), which re-renders the server chrome (page title, support form)
// in the same language on the next flight.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { type HelpCopy } from "@/lib/i18n";
import {
  articlesByArea,
  HELP_LANG_COOKIE,
  type HelpArticle,
  type HelpLanguage,
} from "@/lib/help-kb";
import { searchHelpArticles } from "@/lib/help-search";

export function persistHelpLanguage(language: HelpLanguage) {
  try {
    window.localStorage.setItem(HELP_LANG_COOKIE, language);
    document.cookie = `${HELP_LANG_COOKIE}=${language}; path=/; max-age=31536000; SameSite=Lax`;
  } catch (err) {
    console.error("Could not persist the help language preference:", err);
  }
}

export type HelpCenterProps = {
  articles: readonly HelpArticle[];
  // KID-403: chrome copy per help language — the component picks the entry
  // matching the current language state so the chrome always matches the
  // rendered article set and direction.
  dicts: { en: HelpCopy; ar: HelpCopy };
  defaultLanguage: HelpLanguage;
  // "family" sends the no-result exit to the on-page support request form;
  // "staff" sends it to the ticket inbox.
  mode: "family" | "staff";
  basePath: string;
  inboxHref?: string;
};

export default function HelpCenter({
  articles,
  dicts,
  defaultLanguage,
  mode,
  basePath,
  inboxHref,
}: HelpCenterProps) {
  const router = useRouter();
  const [language, setLanguage] = useState<HelpLanguage>(defaultLanguage);
  const [query, setQuery] = useState("");
  const copy = dicts[language];

  const selectLanguage = (next: HelpLanguage) => {
    if (next === language) return;
    setLanguage(next);
    persistHelpLanguage(next);
    // KID-403: keep the URL in step with the chosen help language so the
    // server-resolved chrome dictionary (page title, support form, the dict
    // props on the next flight) follows the same value the article set uses.
    const params = new URLSearchParams(window.location.search);
    params.set("lang", next);
    router.replace(`${basePath}?${params.toString()}`, { scroll: false });
  };

  const langArticles = useMemo(
    () => articles.filter((article) => article.language === language),
    [articles, language],
  );

  const ranked = useMemo(
    () => searchHelpArticles(langArticles, query),
    [langArticles, query],
  );

  const compactQuery = query.trim();
  const dir = language === "ar" ? "rtl" : "ltr";

  // Direct property access on the typed HelpCopy slice (the template vars are
  // interpolated the same way tr() does it).
  const resultsCount = (count: number) => copy.resultsCount.replaceAll("{count}", String(count));
  const noResultsTitle = (queryText: string) =>
    copy.noResultsTitle.replaceAll("{query}", queryText);

  const articleHref = (article: HelpArticle) =>
    `${basePath}/${article.slug}?lang=${language}`;

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
        <div
          className="help-lang-toggle"
          role="group"
          aria-label={copy.langLabel}
          style={{ display: "flex", gap: 6, flexShrink: 0 }}
        >
          {(["en", "ar"] as HelpLanguage[]).map((code) => (
            <button
              key={code}
              type="button"
              className={code === language ? "btn btn-primary" : "btn btn-ghost"}
              aria-pressed={code === language}
              lang={code}
              dir={code === "ar" ? "rtl" : "ltr"}
              onClick={() => selectLanguage(code)}
              style={{ padding: "4px 10px", fontSize: 13 }}
            >
              {code === "en" ? copy.langEn : copy.langAr}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="help-search-input">
          {copy.searchLabel}
        </label>
        <input
          id="help-search-input"
          className="input"
          type="search"
          value={query}
          placeholder={copy.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {compactQuery && (
        <p className="small muted" data-testid="help-results-count">
          {resultsCount(ranked.length)}
        </p>
      )}

      {compactQuery && (
        <>
          <div className="help-list">
            {ranked.map(({ article }) => (
              <Link key={article.slug} className="help-article-row" href={articleHref(article)}>
                <span className="help-article-title">{article.title}</span>
                <span className="help-article-area">{article.area}</span>
              </Link>
            ))}
          </div>
          {ranked.length === 0 && (
            <div className="card help-empty-state" data-testid="help-empty-state">
              <p className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
                {noResultsTitle(compactQuery)}
              </p>
              <p className="small muted" style={{ marginTop: 0 }}>
                {copy.noResultsHint}
              </p>
              {mode === "staff" ? (
                inboxHref && (
                  <Link className="btn btn-ghost" href={inboxHref}>
                    {copy.contactSupport}
                  </Link>
                )
              ) : (
                <a className="btn btn-ghost" href={inboxHref ?? "#support-form"}>
                  {copy.sendRequest}
                </a>
              )}
            </div>
          )}
        </>
      )}

      {!query.trim() && (
        <div>
          {articlesByArea(langArticles).map(({ area, articles: group }) => (
            <div key={area} className="help-area-group">
              <div className="help-area-head">{area}</div>
              <div className="help-list">
                {group.map((article) => (
                  <Link key={article.slug} className="help-article-row" href={articleHref(article)}>
                    <span className="help-article-title">{article.title}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
          {langArticles.length === 0 && (
            <p className="small muted">{resultsCount(0)}</p>
          )}
        </div>
      )}
    </div>
  );
}
