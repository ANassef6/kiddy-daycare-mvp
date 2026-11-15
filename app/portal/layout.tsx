import Link from "next/link";
import PortalSidebar from "@/components/PortalSidebar";
import PortalAccountMenu from "@/components/PortalAccountMenu";
import OperatorViewBanner from "@/components/OperatorViewBanner";
import NotificationBell from "@/components/NotificationBell";
import NotificationSoundWatcher from "@/components/NotificationSoundWatcher";
import { requireSessionWithWithdrawalCheck } from "@/lib/require";
import { requireTenantForPage } from "@/lib/tenant";
import { ensureSchema } from "@/lib/db";
import { ensureSeededSafe } from "@/lib/bootstrap";
import { getBranding } from "@/lib/theme";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { accountProfile, getAccount, mustChangePasswordFor } from "@/lib/auth";
import { unreadNotificationCount } from "@/lib/store";
import { instituteNameForOperatorView } from "@/lib/operator-view";
import { storageSrcFor } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // KID-2406: KID-216's one-time bootstrap now runs here instead of on the
  // public root layout (which every anonymous marketing render paid for).
  await ensureSeededSafe();
  const session = await requireSessionWithWithdrawalCheck();
  // KID-199.3r: on a daycare subdomain the portal serves ONLY the host tenant.
  // Unknown subdomains land on the neutral error page; a session of another
  // daycare is fail-closed refused with the "belongs to <other>" message.
  await requireTenantForPage();
  // KID-147: same reason as app/child/layout.tsx. Only a handful of portal
  // pages and the server actions called ensureSchema(), so a pending migration
  // sat unapplied until an organic write. Both authenticated roots now apply
  // them, which makes a deploy sufficient instead of merely necessary.
  try {
    await ensureSchema();
  } catch (err) {
    console.error("ensureSchema failed on the portal layout:", err);
  }
  // KID-236: the persistent "viewing as platform operator" banner rides every
  // portal page during an operator-view session. requireTenantForPage above
  // has already refused any host other than the session's bound institute.
  // KID-472: these post-session reads are pairwise independent, so they run as
  // one parallel batch instead of four sequential awaits.
  // KID-474: the bell's unread badge counts the durable notification rows
  // (message recipients get a row from the send path; reads bridge back via
  // markRead/markThreadRead).
  const [{ locale, dict }, profile, branding, operatorViewName, staffUnread, tempPasswordFlagged] = await Promise.all([
    i18nForAccount(session.accountId),
    accountProfile(session.accountId),
    getBranding().catch(() => ({ logoUrl: null as string | null, name: "Kiddy" })),
    session.operatorViewInstituteId
      ? instituteNameForOperatorView(session.operatorViewInstituteId).catch((err) => {
          console.error("KID-236 operator-view banner name lookup failed:", err);
          return "";
        })
      : Promise.resolve(""),
    unreadNotificationCount(session.accountId).catch((err) => {
      console.error("KID-474 staff bell unread count failed:", err);
      return 0;
    }),
    // KID-495: the temp-password prompt is non-blocking UI guidance — a failed
    // read must never break the portal shell, so it degrades to "not flagged".
    getAccount(session.accountId)
      .then((row) => !!row && mustChangePasswordFor(row))
      .catch((err) => {
        console.error("KID-495 portal must_change_password read failed:", err);
        return false;
      }),
  ]);
  const displayName = profile.fullName || session.email;
  const logoUrl: string | null = branding.logoUrl;
  const brandName: string = branding.name;
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
          <NotificationBell
            href="/portal/notifications"
            label={tr(dict, "topbar.notifications")}
            badgeAriaLabel={tr(dict, "parent.notificationsBadgeAria", {
              count: staffUnread,
            })}
            unread={staffUnread}
          />
          <PortalAccountMenu
            email={session.email}
            role={session.role}
            displayName={displayName}
            // KID-1177: private photo refs mint their signed URL here, in the
            // server layout — the client menu stays a dumb renderer.
            photoUrl={profile.photoUrl ? await storageSrcFor(profile.photoUrl) : null}
            dict={dict}
          />
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
        {/* KID-495: temp-password accounts are prompted (never locked out) to
            change their password in account settings; a successful change
            clears the flag and this banner disappears. */}
        {tempPasswordFlagged && (
          <div
            className="small"
            role="alert"
            style={{
              background: "#fffbeb",
              border: "1px solid #f59e0b",
              borderRadius: 8,
              padding: "8px 12px",
              marginBottom: 12,
            }}
          >
            {tr(dict, "account.tempPasswordBanner")}
            <Link href="/portal/account" className="small" style={{ marginLeft: 8, fontWeight: 600 }}>
              {tr(dict, "account.tempPasswordBannerAction")}
            </Link>
          </div>
        )}
        {session.operatorViewInstituteId && (
          <OperatorViewBanner instituteName={operatorViewName} dict={dict} />
        )}
        {children}
        {/* KID-685: the KID-480 in-app sound watcher now rides the portal
            shell too — a new unread row for the signed-in staff account plays
            the bundled beep when the browser allows it (audio needs a prior
            user interaction on the page and is not guaranteed in a hidden
            tab; the watcher degrades silently and honors the KID-480
            "kiddy:notificationSound" off switch). */}
        <NotificationSoundWatcher />
      </main>
    </div>
  );
}