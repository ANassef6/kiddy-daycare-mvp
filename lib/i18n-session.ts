import { cookies, headers } from "next/headers";
import { getAccount } from "@/lib/auth";
import { DEFAULT_LOCALE, LANG_COOKIE, type Dict, type Locale, dirFor, getDictionary, localeOf } from "@/lib/i18n";
import { SITE_LANG_COOKIE, lastCookieValue, localeFromParam } from "@/lib/site-lang";
import { LANG_OVERRIDE_HEADER } from "@/middleware";

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

// KID-1826: the request-wide locale resolution the root layout used to own
// inline, shared with the public marketing pages so the rendered copy always
// agrees with <html lang dir>. Same precedence: account.language is canonical
// for signed-in sessions; the kiddy_lang device cookie decides for anonymous
// visitors (the audience of the public EN/AR switcher).
export async function resolveRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const langCookie = cookieStore.get(LANG_COOKIE)?.value;
  let accountLanguage: string | null | undefined = null;
  try {
    const { readSessionFromCookieValue } = await import("@/lib/auth");
    const session = readSessionFromCookieValue(cookieStore.get("kiddy_sess")?.value ?? null);
    if (session?.accountId) {
      const account = await getAccount(session.accountId);
      accountLanguage = account?.language ?? null;
    }
  } catch {
    // never block render on DB availability; the cookie then decides
  }
  return effectiveLocale(langCookie, accountLanguage);
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

// KID-2072: the public marketing site's own locale resolution. The EN/AR
// switcher is the visitor's control on those pages, so the site decision is
// deliberately independent of the signed-in account preference and of the
// app's kiddy_lang shadowing behavior:
//   1. the per-request ?lang override (middleware promotes the query param to
//      a request header) — renders Arabic even when cookies are unavailable;
//   2. kiddy_site_lang — the site's own cookie, read LAST-duplicate-wins from
//      the raw Cookie header so a stale same-name duplicate (host-only +
//      Domain cookies, different paths) can never shadow the most recent
//      explicit site choice — the failure that made the old client-side
//      switcher a silent no-op for some visitors;
//   3. the legacy kiddy_lang device cookie (also last-wins here) so existing
//      device choices keep working until the visitor uses the site switcher;
//   4. English.
// App/portal/auth surfaces keep resolveRequestLocale: account.language stays
// canonical there (OBS-001), and kiddy_site_lang never decides those pages.
export async function resolveSiteLocale(): Promise<Locale> {
  let override: string | null = null;
  let rawCookie: string | null = null;
  try {
    const h = await headers();
    override = h.get(LANG_OVERRIDE_HEADER);
    rawCookie = h.get("cookie");
  } catch {
    // no request scope (static render/tests): fall through to cookies()
  }
  let siteCookie = lastCookieValue(rawCookie, SITE_LANG_COOKIE);
  let langCookie = lastCookieValue(rawCookie, LANG_COOKIE);
  try {
    const cookieStore = await cookies();
    if (!siteCookie) siteCookie = cookieStore.get(SITE_LANG_COOKIE)?.value ?? null;
    if (!langCookie) langCookie = cookieStore.get(LANG_COOKIE)?.value ?? null;
  } catch {
    // no request scope: the defaults below hold
  }
  return (
    localeFromParam(override) ??
    localeFromParam(siteCookie) ??
    localeFromParam(langCookie) ??
    DEFAULT_LOCALE
  );
}