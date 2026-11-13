import { Suspense } from "react";
import { cookies } from "next/headers";
import { LANG_COOKIE, getDictionary, localeOf, tr, type Locale } from "@/lib/i18n";
import { brandNameForTitle } from "@/lib/theme";
import RegisterForm from "./register-form";

export const dynamic = "force-dynamic";

// KID-437: the activation page resolves the brand header per-origin the same
// way /login does (and the KID-435 titles): a known daycare subdomain names
// that tenant in the SSR paint (previously the header stayed a hardcoded
// generic-Kiddy span on the daycare's own address — KID-436 FAIL 1b), a
// signed-in account names its own daycare, and generic hosts stay Kiddy.
// KID-2400: the copy resolves from the lib/i18n dictionary with the SAME
// locale precedence as /login — the kiddy_lang cookie wins; pre-activation
// there is no session to fall back on, so it is English.
export default async function RegisterPage() {
  const cookieStore = await cookies();
  const cookieLang = cookieStore.get(LANG_COOKIE)?.value;
  const locale: Locale = localeOf(cookieLang);
  const dict = getDictionary(locale);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, `register.${key}`, vars);

  const brandName = (await brandNameForTitle()) || dict.app.name;
  const labels = {
    title: t("title"),
    subtitle: t("subtitle"),
    inviteCodeLabel: t("inviteCodeLabel"),
    inviteCodePlaceholder: t("inviteCodePlaceholder"),
    fullNameLabel: tr(dict, "profile.fullName"),
    emailLabel: tr(dict, "common.email"),
    passwordLabel: tr(dict, "login.passwordLabel"),
    pinLabel: t("pinLabel"),
    submitBtn: t("submitBtn"),
    signInLink: t("signInLink"),
    langLabel: tr(dict, "login.langLabel"),
    langEn: tr(dict, "login.langEn"),
    langAr: tr(dict, "login.langAr"),
  };
  return (
    <Suspense>
      <RegisterForm brandName={brandName} locale={locale} labels={labels} />
    </Suspense>
  );
}
