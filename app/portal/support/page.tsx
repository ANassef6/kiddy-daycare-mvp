import Link from "next/link";
import { requireSession } from "@/lib/require";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { helpLanguageForRequest } from "@/lib/help-lang";
import {
  HELP_ARTICLES,
  helpAudiencesForRole,
  visibleHelpArticles,
} from "@/lib/help-kb";
import HelpCenter from "@/components/HelpCenter";

export const dynamic = "force-dynamic";

// KID-260: the account-menu "Help & Support" entry lands here — the staff
// Knowledge Base (Wren's articles, search bar, EN/AR toggle, role-filtered).
// The ticket inbox stays reachable below as the human escalation path.
export default async function PortalSupportPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const session = requireSession();
  const { dict, locale } = await i18nForAccount(session.accountId);
  const language = await helpLanguageForRequest(searchParams.lang, locale);
  const audiences = helpAudiencesForRole(session.role);
  const articles = [...visibleHelpArticles(HELP_ARTICLES, audiences, "en"), ...visibleHelpArticles(HELP_ARTICLES, audiences, "ar")];

  return (
    <div>
      <h1 className="title">{tr(dict, "topbar.helpSupport")}</h1>
      <HelpCenter
        articles={articles}
        dict={dict}
        defaultLanguage={language}
        mode="staff"
        basePath="/portal/support"
        inboxHref="/portal/support-inbox"
      />
      <p style={{ marginTop: 12 }}>
        <Link href="/portal/support-inbox">{tr(dict, "help.inboxLink")}</Link>
      </p>
    </div>
  );
}
