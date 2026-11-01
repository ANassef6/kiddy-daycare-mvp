// KID-428: the in-app Help Center is Chatwoot-backed.
//
// Content source: the board's Chatwoot help-center portal (account 1, portal
// slug `help-center`, locales en + ar) — the single docs source since KID-426.
// The 96-record bundled article set is gone (KID-388/KID-260 retired with this
// module), so nothing can drift back: the app renders exactly what Chatwoot
// publishes, and Chatwoot's own search (`?query=`) does the ranking.
//
// Access model (verified against the live portal, KID-428):
//   GET {BASE}/api/v1/accounts/{account}/portals/{portal}
//     ?locale=<en|ar>          categories: [{ id, slug, locale, name, ... }]
//     ?category_slug=<slug>    articles (25/page, full `content` HTML)
//   GET  .../articles/{id}    one article
//   GET  .../articles?query=  Chatwoot search across the whole portal
//
// The admin API needs a server-side secret: CHATWOOT_ACCESS_TOKEN
// (Chatwoot user access token). The widget env (NEXT_PUBLIC_CHATWOOT_*) is a
// client-side concern and stays independent of everything here.
//
// Deliverables of this module are pure view shapes:
//   HelpArticleRef — id/title/audience for the list view (no HTML payload)
//   HelpArticleView — adds the sanitized HTML body + pairing metadata
//
// Pure helpers below (parsing, sanitizing, pairing) are exported so unit tests
// pin the parsing contract without any network access.

// ── Language ─────────────────────────────────────────────────────────────────

import { isHelpLanguage, type HelpLanguage } from "./help-lang";

export type { HelpLanguage };

// ── Config (server-side env only; never shipped to the browser) ──────────────

export const CHATWOOT_REVALIDATE_SECONDS = 300;

export type ChatwootHelpConfig = {
  baseUrl: string;
  accountId: string;
  portal: string;
  token: string;
};

export function chatwootHelpConfig(
  env: Record<string, string | undefined> = process.env,
): ChatwootHelpConfig | null {
  const base = (env.CHATWOOT_BASE_URL ?? "").trim();
  const token = (env.CHATWOOT_ACCESS_TOKEN ?? "").trim();
  if (!base || !token) return null;
  return {
    baseUrl: base.replace(/\/+$/, ""),
    accountId: (env.CHATWOOT_ACCOUNT_ID ?? "").trim() || "1",
    portal: (env.CHATWOOT_PORTAL_SLUG ?? "").trim() || "help-center",
    token,
  };
}

function chatwootHelpUrl(
  config: ChatwootHelpConfig,
  path: string,
  params: Record<string, string>,
): string {
  const url = new URL(
    `/api/v1/accounts/${config.accountId}/portals/${config.portal}/${path}`,
    config.baseUrl,
  );
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url.toString();
}

async function chatwootHelpFetch<T>(
  config: ChatwootHelpConfig,
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const response = await fetch(chatwootHelpUrl(config, path, params), {
    headers: { api_access_token: config.token },
    next: { revalidate: CHATWOOT_REVALIDATE_SECONDS },
  });
  if (!response.ok) {
    throw new Error(`Chatwoot help center ${path}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

// ── Audience (role → category visibility; KID-260 semantics kept) ────────────

export type HelpAudience = "public" | "parent" | "staff";

const AUDIENCE_BY_CATEGORY_PREFIX: Record<string, HelpAudience> = {
  public: "public",
  parents: "parent",
  "staff-and-admin": "staff",
};

export function audienceForCategorySlug(slug: string | null | undefined): HelpAudience | null {
  const value = String(slug ?? "").toLowerCase();
  for (const [prefix, audience] of Object.entries(AUDIENCE_BY_CATEGORY_PREFIX)) {
    if (value.startsWith(prefix)) return audience;
  }
  return null;
}

export function helpAudiencesForRole(role: string): HelpAudience[] {
  switch (role) {
    case "parent":
      return ["public", "parent"];
    case "carer":
      return ["public"];
    case "owner":
      return ["public", "staff"];
    case "admin":
      return ["public", "staff"];
    default:
      return ["public", "staff"];
  }
}

export function canViewHelpAudience(role: string, audience: HelpAudience): boolean {
  return helpAudiencesForRole(role).includes(audience);
}

// ── View shapes ──────────────────────────────────────────────────────────────

export type HelpArticleRef = {
  id: number;
  title: string;
  language: HelpLanguage;
  audience: HelpAudience;
};

export type HelpArticleView = HelpArticleRef & {
  html: string;
  alternateTitle: string | null;
};

// ── Chatwoot response parsing (pure) ────────────────────────────────────────

type ChatwootCategory = { id: number; slug: string; locale: string; name: string };

type ChatwootArticle = {
  id: number;
  title: string;
  status: string;
  content?: string;
  category?: { slug?: string; locale?: string } | null;
};

type ChatwootListResponse = { payload?: ChatwootArticle[]; meta?: Record<string, unknown> };

function parseArticle(raw: ChatwootArticle, fallbackLanguage?: HelpLanguage): HelpArticleRef | null {
  if (!raw || typeof raw.id !== "number" || raw.status !== "published") return null;
  const language = isHelpLanguage(raw.category?.locale)
    ? raw.category.locale
    : fallbackLanguage;
  const audience = audienceForCategorySlug(raw.category?.slug);
  if (!audience || !language) return null;
  return { id: raw.id, title: raw.title ?? "", language, audience };
}

export function categoriesForLanguage(
  categories: readonly ChatwootCategory[],
  language: HelpLanguage,
): ChatwootCategory[] {
  return categories.filter((category) => category.locale === language);
}

function parseCategories(response: unknown): ChatwootCategory[] {
  const payload = (response as { payload?: ChatwootCategory[] })?.payload;
  return Array.isArray(payload) ? payload.filter((item) => item && item.slug) : [];
}

function parseArticles(response: unknown, fallbackLanguage?: HelpLanguage): HelpArticleRef[] {
  const payload = (response as ChatwootListResponse)?.payload;
  return Array.isArray(payload)
    ? payload
        .map((raw) => parseArticle(raw, fallbackLanguage))
        .filter((article): article is HelpArticleRef => article !== null)
    : [];
}

// Chatwoot pages at a fixed 25 per page; `meta.articles_count` reports the
// count for the served filter.
export const CHATWOOT_HELP_PAGE_SIZE = 25;

function articlesCount(response: unknown): number {
  const meta = (response as ChatwootListResponse)?.meta;
  const count = meta?.articles_count;
  return typeof count === "number" ? count : Infinity;
}

// Reads every page of a category's published article list. Page 1 is always
// fetched; page N>1 is fetched while page N-1 could hold more articles
// (25*(N-2) < total). An empty page also stops immediately — installation
// fallback so a missing `meta` cannot loop forever.
async function categoryArticleRefs(
  config: ChatwootHelpConfig,
  category: ChatwootCategory,
  language: HelpLanguage,
): Promise<HelpArticleRef[]> {
  const refs: HelpArticleRef[] = [];
  const first = await chatwootHelpFetch<unknown>(config, "articles", {
    category_slug: category.slug,
    locale: language,
    page: "1",
  });
  const total = articlesCount(first);
  refs.push(...parseArticles(first, language));
  for (let page = 2; CHATWOOT_HELP_PAGE_SIZE * (page - 1) < total; page += 1) {
    const next = await chatwootHelpFetch<unknown>(config, "articles", {
      category_slug: category.slug,
      locale: language,
      page: String(page),
    });
    const parsed = parseArticles(next, language);
    if (!parsed.length) break;
    refs.push(...parsed);
  }
  return refs;
}

// ── Body helpers (pure) ──────────────────────────────────────────────────────

// The sync adds a footer per article: "<hr><p><strong>النسخة العربية:</strong>
// <a …>AR title</a></p>" (EN) or "English version:" (AR) pointing at Notion
// (the KID-425 exit target). The app removes the paragraph — the Notion link
// must not ship — and reuses its title as the alternate-language pairing key
// (titles are exact duplicates across the two locales in this portal).
const ALTERNATE_FOOTER = /<p>\s*<strong>\s*(?:النسخة العربية|English version)\s*:\s*<\/strong>([\s\S]*?)<\/p>/i;

export function extractAlternateTitle(content: string): string | null {
  const match = String(content ?? "").match(ALTERNATE_FOOTER);
  if (!match) return null;
  const anchor = match[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i);
  const title = (anchor ? anchor[1] : match[1])
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title || null;
}

export function stripAlternateFooter(content: string): string {
  return String(content ?? "").replace(ALTERNATE_FOOTER, "");
}

export function stripKeywordParagraph(content: string): string {
  const KEYWORDS = /<p>\s*<strong>\s*(?:Keywords|الكلمات المفتاحية)\s*:\s*<\/strong>[\s\S]*?<\/p>/i;
  return String(content ?? "").replace(KEYWORDS, "");
}

// "Related:" paragraph: same content line the bundle rendered as in-app links.
const RELATED_LINE = /<p>\s*<strong>\s*(?:Related|ذات صلة)\s*:\s*<\/strong>([\s\S]*?)<\/p>/i;

export function extractRelatedTitles(content: string): string[] {
  const match = String(content ?? "").match(RELATED_LINE);
  if (!match) return [];
  const text = match[1].replace(/<[^>]+>/g, " ");
  const names = text
    .split("·")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 1 && !names[0]) return [];
  return names;
}

export function stripRelatedParagraph(content: string): string {
  return String(content ?? "").replace(RELATED_LINE, "");
}

export function stripDanglingDivider(content: string): string {
  // Removing trailing meta paragraphs can leave a trailing <hr> behind.
  return String(content ?? "").replace(/(?:\s<hr>\s*)+$/i, "").trimEnd();
}

function normalizeTitle(title: string): string {
  return String(title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

const NONE_NAMES = new Set(["none", "لا يوجد"]);

export function relatedRefs(relatedTitles: string[], candidates: readonly HelpArticleRef[]): HelpArticleRef[] {
  const used = new Set<number>();
  const out: HelpArticleRef[] = [];
  for (const title of relatedTitles) {
    const normalized = normalizeTitle(title);
    if (!normalized || normalized.length < 4 || NONE_NAMES.has(normalized)) continue;
    const found =
      candidates.find((c) => normalizeTitle(c.title) === normalized) ??
      candidates.find(
        (c) =>
          normalizeTitle(c.title).includes(normalized) || normalized.includes(normalizeTitle(c.title)),
      );
    if (found && !used.has(found.id)) {
      used.add(found.id);
      out.push(found);
    }
  }
  return out;
}

export function articleRefByTitle(
  title: string | null,
  candidates: readonly HelpArticleRef[],
): HelpArticleRef | null {
  if (!title) return null;
  const normalized = normalizeTitle(title);
  return candidates.find((candidate) => normalizeTitle(candidate.title) === normalized) ?? null;
}

// ── HTML sanitizer (pure) ────────────────────────────────────────────────────
//
// Chatwoot renders bodies as rich HTML from team-authored markdown, but the
// app cannot trust it blindly (the docs pipeline can paste anything). The
// renderer ships only an allowlist of content tags with no attributes left:
// <a> is re-issued with rel="noopener noreferrer" after a scheme check.

const ALLOWED_TAGS = new Set([
  "p", "br", "hr",
  "strong", "em", "b", "i", "u", "s", "sub", "sup",
  "code", "pre", "kbd", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "a", "img", "table", "thead", "tbody", "tr", "th", "td",
]);

export function sanitizeHelpHtml(html: string): string {
  let out = String(html ?? "");
  out = out.replace(/<(script|style|iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, "");
  out = out.replace(/<(script|style|iframe|object|embed|form)[^>]*\/?>/gi, "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<\/([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (match, tag) =>
    ALLOWED_TAGS.has(tag.toLowerCase()) ? match : "",
  );
  out = out.replace(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*?)\/?>/g, (match, tag, attrs) => {
    const lower = tag.toLowerCase();
    if (match.startsWith("</")) {
      return ALLOWED_TAGS.has(lower) ? `</${lower}>` : "";
    }
    if (!ALLOWED_TAGS.has(lower)) return "";
    if (lower === "a") {
      const href = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/);
      const value = href ? (href[2] ?? href[3] ?? href[4] ?? "").trim() : "";
      const safe = /^(https?:|mailto:|#|\/)/i.test(value) && !/[\r\n]/.test(value);
      const target = safe && /^https?:/i.test(value) ? ' target="_blank" rel="noopener noreferrer"' : "";
      return safe ? `<a href="${value.replace(/"/g, "&quot;")}"${target}>` : "<a>";
    }
    if (lower === "img") {
      const src = attrs.match(/src\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/);
      const value = src ? (src[2] ?? src[3] ?? src[4] ?? "").trim() : "";
      return /^(https?:\/\/|\/)/i.test(value) && !/[\r\n]/.test(value)
        ? `<img src="${value.replace(/"/g, "&quot;")}" alt="">`
        : "";
    }
    return `<${lower}>`;
  });
  return out;
}

// ── Data loaders (server; cached through Next's fetch cache) ────────────────

export type HelpCenterLoad =
  | { ok: true; groups: { area: string; ref: HelpArticleRef }[] }
  | { ok: false };

export async function loadHelpCenter(
  language: HelpLanguage,
  audiences: readonly HelpAudience[],
): Promise<HelpCenterLoad> {
  const config = chatwootHelpConfig();
  if (!config) return { ok: false };
  const allowed = new Set(audiences);
  try {
    const categories = categoriesForLanguage(
      parseCategories(
        await chatwootHelpFetch<unknown>(config, "categories", { locale: language }),
      ),
      language,
    );
    const groups: { area: string; ref: HelpArticleRef }[] = [];
    for (const category of categories) {
      const audience = audienceForCategorySlug(category.slug);
      if (!audience || !allowed.has(audience)) continue;
      const refs = await categoryArticleRefs(config, category, language);
      for (const ref of refs) groups.push({ area: category.name, ref });
    }
    return { ok: true, groups };
  } catch (error) {
    console.error("Chatwoot help center is unavailable:", error);
    return { ok: false };
  }
}

export type HelpArticleLoad =
  | { ok: true; article: HelpArticleView; related: HelpArticleRef[]; alternateId: number | null }
  | { ok: false };

export async function loadHelpArticle(
  id: number,
  language: HelpLanguage,
  audiences: readonly HelpAudience[],
): Promise<HelpArticleLoad> {
  const config = chatwootHelpConfig();
  if (!config) return { ok: false };
  try {
    const raw = (await chatwootHelpFetch<unknown>(config, `articles/${id}`, {})) as ChatwootArticle;
    const audience = audienceForCategorySlug(raw.category?.slug);
    const allowed = new Set(audiences);
    if (!audience || raw.status !== "published" || !allowed.has(audience)) return { ok: false };
    const alternateTitle = extractAlternateTitle(raw.content ?? "");
    const relatedTitles = extractRelatedTitles(raw.content ?? "");
    const html = sanitizeHelpHtml(
      stripDanglingDivider(
        stripRelatedParagraph(stripKeywordParagraph(stripAlternateFooter(raw.content ?? ""))),
      ),
    );
    let alternateId: number | null = null;
    if (alternateTitle) {
      const opposite = language === "en" ? "ar" : "en";
      const oppositeRefs = await languageArticleRefs(opposite, audiences);
      alternateId = articleRefByTitle(alternateTitle, oppositeRefs)?.id ?? null;
    }
    return {
      ok: true,
      article: {
        id: raw.id,
        title: raw.title ?? "",
        language,
        audience,
        html,
        alternateTitle,
      },
      related: relatedRefs(relatedTitles, await languageArticleRefs(language, audiences)),
      alternateId,
    };
  } catch (error) {
    console.error(`Chatwoot help article ${id} is unavailable:`, error);
    return { ok: false };
  }
}

async function languageArticleRefs(
  language: HelpLanguage,
  audiences: readonly HelpAudience[],
): Promise<HelpArticleRef[]> {
  const config = chatwootHelpConfig();
  if (!config) throw new Error("Chatwoot help center is not configured");
  const allowed = new Set(audiences);
  const categories = categoriesForLanguage(
    parseCategories(await chatwootHelpFetch<unknown>(config, "categories", { locale: language })),
    language,
  );
  const refs: HelpArticleRef[] = [];
  for (const category of categories) {
    const audience = audienceForCategorySlug(category.slug);
    if (!audience || !allowed.has(audience)) continue;
    refs.push(...(await categoryArticleRefs(config, category, language)));
  }
  return refs;
}

export type HelpSearchLoad =
  | { ok: true; results: HelpArticleRef[] }
  | { ok: false };

export async function searchHelpCenter(
  query: string,
  language: HelpLanguage,
  audiences: readonly HelpAudience[],
): Promise<HelpSearchLoad> {
  const config = chatwootHelpConfig();
  const normalized = String(query ?? "").trim();
  if (!config || !normalized) return { ok: false };
  const allowed = new Set(audiences);
  try {
    // Chatwoot's search spans the whole portal (both locales); deliver only
    // results the viewer's audience may see, in the language the user is
    // browsing — everything else is dropped — so the ranking stays Chatwoot's
    // own and the language/audience view stays pure.
    const results: HelpArticleRef[] = [];
    const pages = 4; // 25/page; this portal is 96 articles, 4 pages is a safe ceiling
    for (let page = 1; page <= pages; page += 1) {
      const response = await chatwootHelpFetch<unknown>(config, "articles", {
        query: normalized,
        page: String(page),
      });
      const raw = parseArticles(response);
      if (!raw.length) break;
      results.push(
        ...raw.filter(
          (ref) => ref.language === language && allowed.has(ref.audience),
        ),
      );
      const meta = (response as ChatwootListResponse).meta;
      const total = typeof meta?.articles_count === "number" ? meta.articles_count : 0;
      if (total <= page * CHATWOOT_HELP_PAGE_SIZE) break;
    }
    const seen = new Set<number>();
    return {
      ok: true,
      results: results.filter((ref) => (seen.has(ref.id) ? false : (seen.add(ref.id), true))),
    };
  } catch (error) {
    console.error("Chatwoot help center search is unavailable:", error);
    return { ok: false };
  }
}
