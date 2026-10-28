// KID-260: pure search primitives for the in-app Help Center.
// Client-safe: no imports beyond itself. Operating language is per-article
// (one article = one language), so scoring never mixes scripts.

// Arabic normalisation for the alef/hamza/taa-marbuta/ya variants plus
// diacritics and tatweel, so a query like "الإلغاء" also matches "الالغاء".
const AR_DIACRITICS = /[\u064B-\u0655\u0670\u06D6-\u06ED]/g;

export function normalizeSearchText(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(AR_DIACRITICS, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱا]/g, "ا")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئىي]/g, "ي")
    .replace(/[ة]/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/(^|\s)ال(?=\p{L}{2})/gu, "$1")
    .trim();
}

// The expectation line "Email is not confirmed? ..." style titles/keywords
// share the normalisation above.
const WEIGHT_KEYWORD_PHRASE = 60;
const WEIGHT_TOKEN_KEYWORD = 40;
const WEIGHT_TITLE_PHRASE = 50;
const WEIGHT_TOKEN_TITLE = 30;
const WEIGHT_TOKEN_BODY = 10;

export type SearchableHelpArticle = {
  title: string;
  body: string;
  keywords: string[];
};

export type RankedHelpArticle<T> = {
  article: T;
  score: number;
};

// Ranks articles for a user query. An empty query returns every article in
// stored order with score 0 (that is the plain list view, not a search).
export function searchHelpArticles<T extends SearchableHelpArticle>(
  articles: readonly T[],
  query: string,
): RankedHelpArticle<T>[] {
  const phrase = normalizeSearchText(query);
  if (!phrase) return articles.map((article) => ({ article, score: 0 }));
  const tokens = phrase.split(" ").filter(Boolean);
  const ranked: RankedHelpArticle<T>[] = [];
  for (let index = 0; index < articles.length; index += 1) {
    const article = articles[index];
    const keywords = normalizeSearchText(article.keywords.join(" "));
    const title = normalizeSearchText(article.title);
    const body = normalizeSearchText(article.body);
    let score = 0;
    if (keywords.includes(phrase)) score += WEIGHT_KEYWORD_PHRASE;
    if (title.includes(phrase)) score += WEIGHT_TITLE_PHRASE;
    for (const token of tokens) {
      if (keywords.includes(token)) score += token.length >= 3 ? WEIGHT_TOKEN_KEYWORD : WEIGHT_TOKEN_KEYWORD / 2;
      if (title.includes(token)) score += WEIGHT_TOKEN_TITLE;
      if (body.includes(token)) score += WEIGHT_TOKEN_BODY;
    }
    if (score > 0) ranked.push({ article, score });
  }
  return ranked.sort((a, b) => b.score - a.score);
}
