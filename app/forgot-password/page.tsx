import { cookies } from "next/headers";
import { LANG_COOKIE, getDictionary, localeOf, tr, type Locale } from "@/lib/i18n";
import { brandNameForTitle } from "@/lib/theme";
import ForgotPasswordForm from "./forgot-password-form";

export const dynamic = "force-dynamic";

// KID-437: the reset page resolves the brand header per-origin the same way
// /login does (and the KID-435 titles): a known daycare subdomain names that
// tenant in the SSR paint (previously the header stayed a hardcoded
// generic-Kiddy span on the daycare's own address — KID-436 FAIL 1b), a
// signed-in account names its own daycare, and generic hosts stay Kiddy.
//
// KID-443 (defect 3): the page copy used to be hardcoded English while the
// same pre-sign-in visitor could already get /login localized by the kiddy_lang
// cookie (KID-368). The copy now resolves from the forgot section (same
// precedence as /login) and the page pre-signin-shows the same EN/AR toggle.
export default async function ForgotPasswordPage() {
  const cookieStore = cookies();
  const locale: Locale = localeOf(cookieStore.get(LANG_COOKIE)?.value);
  const dict = getDictionary(locale);
  const brandName = (await brandNameForTitle()) || dict.app.name;
  const copy = dict.forgot;
  return (
    <ForgotPasswordForm
      brandName={brandName}
      copy={copy}
      locale={locale}
      toggle={{ locale, label: tr(dict, "login.langLabel"), en: tr(dict, "login.langEn"), ar: tr(dict, "login.langAr") }}
    />
  );
}
