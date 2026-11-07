import Link from "next/link";
import { redirect } from "next/navigation";
import ChildNavMenu from "@/components/ChildNavMenu";
import OperatorViewBanner from "@/components/OperatorViewBanner";
import NotificationBell from "@/components/NotificationBell";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import NotificationSoundWatcher from "@/components/NotificationSoundWatcher";
import { requireSessionWithWithdrawalCheck } from "@/lib/require";
import { emailConfirmedDisplayFor } from "@/lib/auth";
import { requireTenantForPage } from "@/lib/tenant";
import { familyAccessForAccount, unreadNotificationCount } from "@/lib/store";
import { ensureSchema } from "@/lib/db";
import { getBranding } from "@/lib/theme";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { instituteNameForOperatorView } from "@/lib/operator-view";

export const dynamic = "force-dynamic";

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSessionWithWithdrawalCheck();
  // KID-199.3r: on a daycare subdomain the parent pages serve ONLY the host
  // tenant. Unknown subdomains land on the neutral error page; a session of
  // another daycare is fail-closed refused with the "belongs to" message.
  await requireTenantForPage();
  // KID-147: the parent read path is pure SELECT, so it never triggered
  // ensureSchema(). A migration that backfills family_member rows could
  // therefore stay unapplied until some unrelated staff write action ran,
  // and the parent still saw a stale child list. Migrations are applied here
  // so "deploy" and "parent sees the backfill" are the same event. Warm
  // requests are a single ledger read (see ensurePgSchema).
  try {
    await ensureSchema();
  } catch (err) {
    console.error("ensureSchema failed on the parent layout:", err);
  }
  // KID-236: same persistent operator-view banner as the portal layout — the
  // parent surface is a tenant surface too. KID-472: the post-session reads
  // below are pairwise independent, so they now run as one parallel batch;
  // the unused familiesForAccount() call the layout never consumed is gone.
  // KID-499: the banner renders from the LIVE account row whenever the cookie
  // snapshot says unconfirmed, so a confirmation completed without a fresh
  // sign-in can never leave a stale yellow banner contradicting the verified
  // state. Snapshot-confirmed sessions skip the DB entirely (fast path).
  const bannerEmailConfirmed = await emailConfirmedDisplayFor(session);
  const [{ dict }, branding, access, operatorViewName, parentUnread] = await Promise.all([
    i18nForAccount(session.accountId),
    // branding failure falls back to neutral Kiddy defaults (unchanged).
    getBranding().catch(() => ({ logoUrl: null as string | null, name: "Kiddy" })),
    session.role === "parent" ? familyAccessForAccount(session.accountId) : Promise.resolve(null),
    session.operatorViewInstituteId
      ? instituteNameForOperatorView(session.operatorViewInstituteId).catch((err) => {
          console.error("KID-236 operator-view banner name lookup failed:", err);
          return "";
        })
      : Promise.resolve(""),
    // KID-474: the parent bell rides every page so the badge stays live.
    unreadNotificationCount(session.accountId).catch((err) => {
      console.error("KID-474 parent bell unread count failed:", err);
      return 0;
    }),
  ]);
  const logoUrl: string | null = branding.logoUrl;
  const brandName: string = branding.name;

  const navItems = [
    { href: "/child", label: tr(dict, "nav.myChildren") },
    { href: "/child/newsfeed", label: tr(dict, "nav.newsFeed") },
    { href: "/child/events", label: tr(dict, "nav.events") },
    { href: "/child/learning", label: tr(dict, "nav.learning") },
    { href: "/child/drive", label: tr(dict, "nav.parentDrive") },
    { href: "/child/forms", label: tr(dict, "nav.surveys") },
    { href: "/child/consents", label: tr(dict, "nav.childrenConsents") },
    { href: "/child/messages", label: tr(dict, "nav.chat") },
    { href: "/child/notifications", label: tr(dict, "parent.notificationsTitle") },
    { href: "/child/support", label: tr(dict, "nav.support") },
  ];

  // KID-112: no_access links never render parent pages (login already blocks;
  // this covers sessions issued before the admin disabled the account).
  // KID-486: pickup links only see the minimal /child pickup page, so the nav
  // shrinks to MyChildren. Family links are view-only: the messages item
  // disappears from their nav (requireFamilyPage redirects the page too).
  let visibleNav = navItems;
  if (session.role === "parent") {
    if (access === "no_access") redirect("/login?error=disabled");
    if (access === "pickup") visibleNav = navItems.slice(0, 1);
    if (access === "family") visibleNav = navItems.filter((n) => n.href !== "/child/messages");
  }

  return (
    <div className="container" style={{ maxWidth: 760 }}>
      {!bannerEmailConfirmed && (
        <div
          className="small"
          style={{
            background: "#fef3c7",
            border: "1px solid #f59e0b",
            borderRadius: 8,
            padding: "8px 12px",
            marginTop: 12,
          }}
        >
          {tr(dict, "topbar.emailNotConfirmed")}
          <Link href="/welcome" className="small" style={{ marginLeft: 8, fontWeight: 600 }}>
            {tr(dict, "topbar.confirmEmail")}
          </Link>
        </div>
      )}
      <header className="row child-header" style={{ justifyContent: "space-between", padding: "16px 0" }}>
        <Link href="/child" className="site-brand" style={{ textDecoration: "none" }}>
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" width={28} height={28} className="site-logo" />
          )}
          <span className="brand">{brandName}</span>
        </Link>
        {/* KID-255: below 720px the nav links collapse into a hamburger
            dropdown while the sign-out button stays pinned in the header row —
            at 320–430px it used to be pushed past the right viewport edge
            (trimmed, untappable on Android). Desktop keeps the inline row. */}
        <ChildNavMenu
          items={visibleNav}
          settingsHref="/child/settings"
          settingsLabel={tr(dict, "nav.settings")}
          settingsTitle={tr(dict, "topbar.accountSettings")}
          signOutLabel={tr(dict, "nav.signOut")}
          dict={dict}
          bell={
            <NotificationBell
              href="/child/notifications"
              label={tr(dict, "parent.notificationsTitle")}
              badgeAriaLabel={tr(dict, "parent.notificationsBadgeAria", { count: parentUnread })}
              unread={parentUnread}
            />
          }
        />
      </header>
      {session.operatorViewInstituteId && (
        <OperatorViewBanner instituteName={operatorViewName} dict={dict} />
      )}
      {/* KID-480: service worker registration + in-app notification sound
          live on the parent shell so pushes and sounds follow the account
          across every parent page. */}
      <ServiceWorkerRegister />
      <NotificationSoundWatcher />
      {children}
      <footer className="muted small" style={{ padding: "24px 0", borderTop: "1px solid var(--color-border)", marginTop: 40 }}>
        {tr(dict, "topbar.signedInAs", { email: session.email })}
      </footer>
    </div>
  );
}