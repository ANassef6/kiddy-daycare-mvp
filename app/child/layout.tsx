import Link from "next/link";
import { redirect } from "next/navigation";
import ChildNavMenu from "@/components/ChildNavMenu";
import OperatorViewBanner from "@/components/OperatorViewBanner";
import { requireSessionWithWithdrawalCheck } from "@/lib/require";
import { requireTenantForPage } from "@/lib/tenant";
import { familyAccessForAccount } from "@/lib/store";
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
  const [{ dict }, branding, access, operatorViewName] = await Promise.all([
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
    { href: "/child/support", label: tr(dict, "nav.support") },
  ];

  // KID-112: no_access links never render parent pages (login already blocks;
  // this covers sessions issued before the admin disabled the account).
  // Pickup links only register pickup time, so the nav shrinks to MyChildren.
  let visibleNav = navItems;
  if (session.role === "parent") {
    if (access === "no_access") redirect("/login?error=disabled");
    if (access === "pickup") visibleNav = navItems.slice(0, 1);
  }

  return (
    <div className="container" style={{ maxWidth: 760 }}>
      {!session.emailConfirmed && (
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
        />
      </header>
      {session.operatorViewInstituteId && (
        <OperatorViewBanner instituteName={operatorViewName} dict={dict} />
      )}
      {children}
      <footer className="muted small" style={{ padding: "24px 0", borderTop: "1px solid var(--color-border)", marginTop: 40 }}>
        {tr(dict, "topbar.signedInAs", { email: session.email })}
      </footer>
    </div>
  );
}