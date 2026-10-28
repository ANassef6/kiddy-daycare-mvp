// KID-260: which language renders the Help Center.
//
// Priority: explicit ?lang= on the URL, then the help-language cookie the
// client toggle writes (localStorage holds the same value for client state),
// then the account's app language, then English. The help language is
// intentionally independent of the account app language.
import { cookies } from "next/headers";
import { HELP_LANG_COOKIE, HELP_LANGUAGES, type HelpLanguage } from "./help-kb";

export function isHelpLanguage(value: unknown): value is HelpLanguage {
  return typeof value === "string" && (HELP_LANGUAGES as readonly string[]).includes(value);
}

export function resolveHelpLanguage(
  searchParam: string | string[] | undefined,
  cookieJar: Pick<Cookies, "get">,
  accountLanguage: string | undefined,
): HelpLanguage {
  const explicit = Array.isArray(searchParam) ? searchParam[0] : searchParam;
  if (isHelpLanguage(explicit)) return explicit;
  const cookie = cookieJar.get(HELP_LANG_COOKIE)?.value;
  if (isHelpLanguage(cookie)) return cookie;
  return accountLanguage?.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export async function helpLanguageForRequest(
  searchParam: string | string[] | undefined,
  accountLanguage: string | undefined,
): Promise<HelpLanguage> {
  const cookieJar = await cookies();
  return resolveHelpLanguage(searchParam, cookieJar, accountLanguage);
}

type Cookies = Awaited<ReturnType<typeof cookies>>;
