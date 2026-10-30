import { getAccount } from "@/lib/auth";
import { type Dict, type Locale, dirFor, getDictionary, localeOf } from "@/lib/i18n";

export type I18nContext = { locale: Locale; dict: Dict; dir: "ltr" | "rtl" };

// OBS-001: the kiddy_lang device cookie and account.language used to resolve
// independently — a cookie left stale by a language change from another device
// made the root layout render dir=rtl while the page dictionaries rendered
// English text. account.language is the canonical preference (saveLanguageAction
// writes the cookie + the column together), so when it is set to a valid locale
// it wins and a mismatched cookie is treated as stale. The cookie only decides
// when there is no account preference (anonymous visitors, or legacy rows
// without a language), which keeps the login-screen device choice working.
export function effectiveLocale(
  langCookie: string | null | undefined,
  accountLanguage: string | null | undefined
): Locale {
  if (accountLanguage) {
    const accountLocale = localeOf(accountLanguage);
    if (accountLocale === "en" || accountLocale === "ar") return accountLocale;
  }
  if (langCookie === "en" || langCookie === "ar") return langCookie;
  return "en";
}

// Resolve the active locale for a signed-in account from the persisted
// `account.language` column. The value is read live so a language change in
// Account Settings is applied on the next navigation/reload.
export async function i18nForAccount(accountId: string | undefined | null): Promise<I18nContext> {
  let locale: Locale = "en";
  if (accountId) {
    const account = await getAccount(accountId);
    if (account?.language) locale = localeOf(account.language);
  }
  return { locale, dict: getDictionary(locale), dir: dirFor(locale) };
}