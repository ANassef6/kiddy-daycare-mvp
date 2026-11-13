import { cookies } from "next/headers";
import { LANG_COOKIE, getDictionary, localeOf, tr } from "@/lib/i18n";
import AuthConfirmForm from "./confirm-form";

export const dynamic = "force-dynamic";

// KID-2400: the email-confirmation flow was an English-only client island.
// The server wrapper resolves the kiddy_lang cookie locale (same precedence
// as /login — pre-auth, no session) and hands the strings to the client form.
export default async function AuthConfirmPage() {
  const cookieLang = (await cookies()).get(LANG_COOKIE)?.value;
  const dict = getDictionary(localeOf(cookieLang));
  const labels = {
    brand: dict.app.name,
    title: tr(dict, "topbar.confirmEmail"),
    checking: tr(dict, "authConfirm.checking"),
    notConfigured: tr(dict, "authConfirm.notConfigured"),
    invalidLink: tr(dict, "authConfirm.invalidLink"),
    noEmail: tr(dict, "authConfirm.noEmail"),
    noSessionToken: tr(dict, "authConfirm.noSessionToken"),
    confirmed: tr(dict, "authConfirm.confirmed"),
    signInNow: tr(dict, "authConfirm.signInNow"),
    signIn: tr(dict, "login.signIn"),
    noToken: tr(dict, "authConfirm.noToken"),
  };
  return <AuthConfirmForm labels={labels} />;
}
