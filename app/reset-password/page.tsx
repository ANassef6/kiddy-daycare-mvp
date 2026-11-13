import { cookies } from "next/headers";
import { LANG_COOKIE, getDictionary, localeOf, tr } from "@/lib/i18n";
import ResetPasswordForm from "./reset-form";

export const dynamic = "force-dynamic";

// KID-2400: the reset flow was an English-only client island. The server
// wrapper now resolves the kiddy_lang cookie locale (same precedence as
// /login — pre-auth, no session) and hands the strings to the client form.
export default async function ResetPasswordPage() {
  const cookieLang = (await cookies()).get(LANG_COOKIE)?.value;
  const dict = getDictionary(localeOf(cookieLang));
  const labels = {
    title: tr(dict, "resetPassword.title"),
    checking: tr(dict, "resetPassword.checking"),
    notConfigured: tr(dict, "resetPassword.notConfigured"),
    invalidLink: tr(dict, "resetPassword.invalidLink"),
    tooShort: tr(dict, "resetPassword.tooShort"),
    mismatch: tr(dict, "resetPassword.mismatch"),
    newPassword: tr(dict, "account.newPassword"),
    confirmPassword: tr(dict, "account.confirmPassword"),
    updateBtn: tr(dict, "resetPassword.updateBtn"),
    done: tr(dict, "resetPassword.done"),
    signIn: tr(dict, "login.signIn"),
    noToken: tr(dict, "resetPassword.noToken"),
    requestLink: tr(dict, "resetPassword.requestLink"),
    requestNewLink: tr(dict, "resetPassword.requestNewLink"),
    backToSignin: tr(dict, "forgot.backToSignin"),
  };
  return <ResetPasswordForm labels={labels} />;
}
