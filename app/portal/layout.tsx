import Link from "next/link";
import PortalSidebar from "@/components/PortalSidebar";
import Avatar from "@/components/Avatar";
import { requireSessionWithWithdrawalCheck } from "@/lib/require";
import { isAdminRole } from "@/lib/role";
import { getBranding } from "@/lib/theme";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { accountProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSessionWithWithdrawalCheck();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const profile = await accountProfile(session.accountId);
  const displayName = profile.fullName || session.email;
  let logoUrl: string | null = null;
  let brandName = "Kiddy";
  try {
    const b = await getBranding();
    logoUrl = b.logoUrl;
    brandName = b.name;
  } catch {}
  return (
    <div className="shell">
      <PortalSidebar brandName={brandName} logoUrl={logoUrl} locale={locale} dict={dict} role={session.role} />
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
              <Avatar src={profile.photoUrl} name={displayName} size={28} className="portal-account-avatar" />
              <span className="portal-account-name">{displayName}</span>
            </summary>
            <div className="portal-account-menu">
              <div className="portal-account-meta">
                <div className="portal-account-email">{session.email}</div>
                <div className="small muted">{session.role}</div>
              </div>
              <Link href="/portal/account" className="portal-account-link">{tr(dict, "topbar.accountSettings")}</Link>
              {isAdminRole(session.role) && (
                <Link href="/portal/settings" className="portal-account-link">{tr(dict, "topbar.centerSettings")}</Link>
              )}
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