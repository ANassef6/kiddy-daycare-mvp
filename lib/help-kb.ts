// KID-260: the in-app Help Center knowledge base.
//
// Content source: Wren's Kiddy Documentation Index (Notion), exported to a
// static tracked bundle — `data/help-articles.json` — so the Vercel build
// always ships the articles without a runtime fs read or a live Notion call.
// One record per article and language; the contract the bundle follows is
// documented on KID-260/KID-261:
//   id, slug (shared across the language pair), language (en/ar),
//   audience (parent | staff | carer | owner | public), area, title,
//   body (markdown), keywords (string[]), status (published | draft),
//   source (Notion page id).
//
// Pure, client-safe module: JSON import only, no server APIs.

import articlesJson from "@/data/help-articles.json";

export const HELP_LANGUAGES = ["en", "ar"] as const;
export type HelpLanguage = (typeof HELP_LANGUAGES)[number];

export const HELP_AUDIENCES = ["parent", "staff", "carer", "owner", "public"] as const;
export type HelpAudience = (typeof HELP_AUDIENCES)[number];

// KID-223: the AR query "عرض الحضور" must rank A-STA-06 (staff attendance)
// first. The Notion row for that pair does not carry the phrase verbatim, so
// the supplemental keyword ships here (Wren's KID-261 bundle supersedes this
// map when it lands — the map only fills verified-in-app search gaps).
const SUPPLEMENTAL_KEYWORDS: Record<string, Record<HelpLanguage, string[]>> = {
  "A-STA-06": { en: [], ar: ["عرض الحضور"] },
};

export type HelpArticle = {
  id: string;
  slug: string;
  language: HelpLanguage;
  audience: HelpAudience;
  area: string;
  title: string;
  body: string;
  keywords: string[];
  status: string;
  source: string;
};

export const HELP_ARTICLES: HelpArticle[] = mergeSupplementalKeywords(
  articlesJson as HelpArticle[],
);

function mergeSupplementalKeywords(articles: HelpArticle[]): HelpArticle[] {
  for (const article of articles) {
    const extra = SUPPLEMENTAL_KEYWORDS[article.id]?.[article.language];
    if (extra) {
      const keywords = new Set(article.keywords);
      for (const keyword of extra) keywords.add(keyword);
      article.keywords = [...keywords];
    }
  }
  return articles;
}

// Help Center language preference. Held in localStorage + a (non-httpOnly)
// cookie so the server-rendered article detail pages can render the language
// the user picked in the list, without mixing.
export const HELP_LANG_COOKIE = "kiddy_help_lang";

// KID-259/1: the account app roles map onto the article audience so the list
// and the detail view agree on exactly what a signed-in user may open. "public"
// is the baseline set every signed-in audience gets (account/password topics
// authored for anyone using Kiddy).
export function helpAudiencesForRole(role: string): HelpAudience[] {
  switch (role) {
    case "parent":
      return ["public", "parent"];
    case "carer":
      return ["public", "carer"];
    case "owner":
      return ["public", "staff", "owner"];
    case "admin":
      return ["public", "staff"];
    default:
      return ["public", "staff"];
  }
}

export function canViewHelpAudience(role: string, audience: HelpAudience): boolean {
  return helpAudiencesForRole(role).includes(audience);
}

// Only published records render, and only for the viewer's audiences.
export function visibleHelpArticles(
  articles: readonly HelpArticle[],
  audiences: readonly string[],
  language: HelpLanguage,
): HelpArticle[] {
  const allowed = new Set(audiences);
  return articles.filter(
    (article) =>
      article.status === "published" &&
      article.language === language &&
      allowed.has(article.audience),
  );
}

export function helpArticleBySlug(
  articles: readonly HelpArticle[],
  slug: string,
  audiences: readonly string[],
  language: HelpLanguage,
): HelpArticle | null {
  const allowed = new Set(audiences);
  const match = articles.find(
    (article) =>
      article.slug === slug &&
      article.language === language &&
      article.status === "published" &&
      allowed.has(article.audience),
  );
  return match ?? null;
}

export function otherHelpLanguage(language: HelpLanguage): HelpLanguage {
  return language === "en" ? "ar" : "en";
}

// Resolves the "Related:" / "ذات صلة:" body line into same-language articles
// the given viewer may actually open. Names that resolve are replaced by
// in-app links; names that do not resolve (prose drift, or Notion's "none")
// simply stay as plain text in the body — no dead links.
const NONE_NAMES = new Set(["none", "لا يوجد"]);
const RELATED_LINE = /^\*\*(Related|ذات صلة):\*\*\s*(.+)$/m;

function titleTokens(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Fallback for Wren's free-prose Related names: the best title-token overlap
// wins (≥ 3 shared tokens AND ≥ 60% coverage) so a shortened Arabic title like
// "عرض أطفالك وحالة حضور اليوم" still meets its canonical pair without ever
// matching on a single generic word.
function bestOverlap(name: string, candidates: HelpArticle[]): HelpArticle | undefined {
  const nameTokens = new Set(titleTokens(name));
  if (nameTokens.size < 3) return undefined;
  let best: HelpArticle | undefined;
  let bestRatio = 0;
  for (const candidate of candidates) {
    const candidateTokens = titleTokens(candidate.title);
    const common = candidateTokens.filter((token) => nameTokens.has(token)).length;
    const ratio = common / Math.min(nameTokens.size, candidateTokens.length);
    if (common >= 3 && ratio >= 0.6 && ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

export function relatedHelpArticles(
  articles: readonly HelpArticle[],
  article: HelpArticle,
  audiences: readonly string[],
): { related: HelpArticle[]; bodyWithoutRelated: string } {
  const match = article.body.match(RELATED_LINE);
  if (!match) return { related: [], bodyWithoutRelated: article.body };
  const names = match[2]
    .split("·")
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => name.length > 3 && !NONE_NAMES.has(name.toLowerCase()));
  if (!names.length) return { related: [], bodyWithoutRelated: article.body };
  const allowed = new Set(audiences);
  const candidates = articles.filter(
    (candidate) =>
      candidate.language === article.language &&
      candidate.status === "published" &&
      allowed.has(candidate.audience) &&
      candidate.slug !== article.slug,
  );
  const related: HelpArticle[] = [];
  const usedSlugs = new Set<string>();
  for (const name of names) {
    const free = candidates.filter((candidate) => !usedSlugs.has(candidate.slug));
    const found =
      free.find((candidate) => candidate.title === name) ??
      free.find(
        (candidate) => candidate.title.includes(name) || name.includes(candidate.title),
      ) ??
      bestOverlap(name, free);
    if (found) {
      usedSlugs.add(found.slug);
      related.push(found);
    }
  }
  if (!related.length) return { related: [], bodyWithoutRelated: article.body };
  return { related, bodyWithoutRelated: article.body.replace(RELATED_LINE, "").trim() };
}

// Distinct group headings (areas) in stored order, for the list grouping.
export function helpAreas(articles: readonly HelpArticle[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const article of articles) {
    if (!seen.has(article.area)) {
      seen.add(article.area);
      out.push(article.area);
    }
  }
  return out;
}

// Areas are content taxonomy (EN-coded in Notion), not shipped chrome strings:
// they are stable keys the AR chrome darkens but does not translate.
export function articlesByArea(
  articles: readonly HelpArticle[],
): { area: string; articles: HelpArticle[] }[] {
  const areas = helpAreas(articles);
  return areas.map((area) => ({
    area,
    articles: articles.filter((a) => a.area === area),
  }));
}
