import Link from "next/link";
import { requireSession } from "@/lib/require";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { redirect } from "next/navigation";
import ResendConfirmButton from "@/components/resend-confirm";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const session = await requireSession();
  if (session.emailConfirmed) {
    redirect(session.role === "parent" ? "/child" : "/portal/dashboard");
  }
  const home = session.role === "parent" ? "/child" : "/portal/dashboard";
  // KID-2400: the copy follows the signed-in account's language preference
  // (account.language is canonical for signed-in sessions, OBS-001).
  const { dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, `welcome.${key}`, vars);
  const labels = {
    resendBtn: tr(dict, "resendConfirm.resendBtn"),
    sentMessage: tr(dict, "resendConfirm.sentMessage"),
    fallbackError: tr(dict, "resendConfirm.fallbackError"),
    sending: tr(dict, "messages.sending"),
  };

  return (
    <div className="container" style={{ maxWidth: 520, paddingTop: 80 }}>
      <span className="brand">Kiddy</span>
      <div className="card mt-4">
        <h1 className="title">{t("title")}</h1>
        <p className="subtitle">
          {t("subtitle")} <strong>{session.email}</strong>
          {t("subtitleEmailTail")}
        </p>
        <div className="card" style={{ background: "var(--color-surface-alt, #f9fafb)", marginTop: 16 }}>
          <p className="small muted" style={{ margin: 0 }}>
            <strong>{t("sessionActiveTitle")}</strong>
            {t("sessionActiveBody")}
          </p>
        </div>
        <div className="row mt-4" style={{ gap: 8, flexWrap: "wrap" }}>
          <ResendConfirmButton labels={labels} />
          <Link className="btn btn-primary" href={home}>
            {t("continueBtn")}
          </Link>
        </div>
      </div>
      <p className="small mt-3">
        <a href="/api/logout">{t("signOutLink", { email: session.email })}</a>
      </p>
    </div>
  );
}
