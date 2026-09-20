import Link from "next/link";
import PortalSidebar from "@/components/PortalSidebar";
import { requireSessionWithWithdrawalCheck } from "@/lib/require";
import { getBranding } from "@/lib/theme";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSessionWithWithdrawalCheck();
  const { locale, dict } = await i18nForAccount(session.accountId);
  let logoUrl: string | null = null;
  let brandName = "Kiddy";
  try {
    const b = await getBranding();
    logoUrl = b.logoUrl;
    brandName = b.name;
  } catch {}
  return (
    <div className="shell">
      <PortalSidebar brandName={brandName} logoUrl={logoUrl} locale={locale} dict={dict} />
      <main className="shell-main">
        {/* KID-52 #12: messages, notifications and account settings live in the
            top-right corner on every portal page. */}
        <div className="portal-topbar">
          <Link href="/portal/messages" className="portal-topbar-icon" aria-label={tr(dict, "topbar.messages")} title={tr(dict, "topbar.messages")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </Link>
          <Link href="/portal/notifications" className="portal-topbar-icon" aria-label={tr(dict, "topbar.notifications")} title={tr(dict, "topbar.notifications")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </Link>
          <details className="portal-account">
            <summary className="portal-account-toggle" aria-label={tr(dict, "topbar.accountSettings")} title={session.email}>
              <span className="portal-account-avatar" aria-hidden="true">
                {session.email.charAt(0).toUpperCase()}
              </span>
              <span className="portal-account-name">{session.email}</span>
            </summary>
            <div className="portal-account-menu">
              <div className="portal-account-meta">
                <div className="portal-account-email">{session.email}</div>
                <div className="small muted">{session.role}</div>
              </div>
              <Link href="/portal/settings" className="portal-account-link">{tr(dict, "topbar.accountSettings")}</Link>
              <Link href="/portal/support" className="portal-account-link">{tr(dict, "topbar.helpSupport")}</Link>
              <a href="/api/logout" className="portal-account-link">{tr(dict, "topbar.logout")}</a>
            </div>
          </details>
        </div>
        {!session.emailConfirmed && (
          <div
            className="small"
            style={{
              background: "#fef3c7",
              border: "1px solid #f59e0b",
              borderRadius: 8,
              padding: "8px 12px",
              marginBottom: 12,
            }}
          >
            {tr(dict, "topbar.emailNotConfirmed")}
            <Link href="/welcome" className="small" style={{ marginLeft: 8, fontWeight: 600 }}>
              {tr(dict, "topbar.confirmEmail")}
            </Link>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}