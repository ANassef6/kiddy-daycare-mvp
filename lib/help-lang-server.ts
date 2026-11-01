// KID-428: the server-side help-language resolver (cookies + request
// searchParams) split from the pure lib/help-lang constants so the client
// toggle never pulls next/headers into its bundle.
import { cookies } from "next/headers";
import { HELP_LANG_COOKIE, isHelpLanguage, type HelpLanguage } from "./help-lang";

export async function helpLanguageForRequest(
  searchParam: string | string[] | undefined,
  accountLanguage: string | undefined,
): Promise<HelpLanguage> {
  const cookieJar = await cookies();
  const explicit = Array.isArray(searchParam) ? searchParam[0] : searchParam;
  if (isHelpLanguage(explicit)) return explicit;
  const cookie = cookieJar.get(HELP_LANG_COOKIE)?.value;
  if (isHelpLanguage(cookie)) return cookie;
  return accountLanguage?.toLowerCase().startsWith("ar") ? "ar" : "en";
}
