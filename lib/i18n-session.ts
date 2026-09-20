import { getAccount } from "@/lib/auth";
import { type Dict, type Locale, dirFor, getDictionary, localeOf } from "@/lib/i18n";

export type I18nContext = { locale: Locale; dict: Dict; dir: "ltr" | "rtl" };

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