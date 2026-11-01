// KID-260: which language renders the Help Center.
//
// Priority: explicit ?lang= on the URL, then the help-language cookie the
// toggle writes (localStorage holds the same value for client state),
// then the account's app language, then English. The help language is
// intentionally independent of the account app language.
//
// KID-428: the article set itself now comes from Chatwoot (lib/help-chatwoot);
// the language control and its persistence stay exactly as KID-403 shipped
// them. This module is pure (no next/headers import) so the client toggle can
// reuse the same constants; the server-side request resolver lives in
// lib/help-lang-server.ts.
export const HELP_LANGUAGES = ["en", "ar"] as const;
export type HelpLanguage = (typeof HELP_LANGUAGES)[number];

export function isHelpLanguage(value: unknown): value is HelpLanguage {
  return typeof value === "string" && (HELP_LANGUAGES as readonly string[]).includes(value);
}

export const HELP_LANG_COOKIE = "kiddy_help_lang";

export function otherHelpLanguage(language: HelpLanguage): HelpLanguage {
  return language === "en" ? "ar" : "en";
}

export function resolveHelpLanguage(
  searchParam: string | string[] | undefined,
  cookieJar: { get: (name: string) => { value: string } | undefined },
  accountLanguage: string | undefined,
): HelpLanguage {
  const explicit = Array.isArray(searchParam) ? searchParam[0] : searchParam;
  if (isHelpLanguage(explicit)) return explicit;
  const cookie = cookieJar.get(HELP_LANG_COOKIE)?.value;
  if (isHelpLanguage(cookie)) return cookie;
  return accountLanguage?.toLowerCase().startsWith("ar") ? "ar" : "en";
}
