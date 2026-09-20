import Link from "next/link";
import ActiveLink from "@/components/ActiveLink";
import { requireSession } from "@/lib/require";
import { familiesForAccount } from "@/lib/store";
import { getBranding } from "@/lib/theme";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const session = requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  let families: Record<string, unknown>[] = [];
  let logoUrl: string | null = null;
  let brandName = "Kiddy";
  try {
    [families] = await Promise.all([
      familiesForAccount(session.accountId),
      getBranding().then((b) => { logoUrl = b.logoUrl; brandName = b.name; }),
    ]);
  } catch {
    // fall through
  }

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
      <header className="row" style={{ justifyContent: "space-between", padding: "16px 0" }}>
        <Link href="/child" className="site-brand" style={{ textDecoration: "none" }}>
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" width={28} height={28} className="site-logo" />
          )}
          <span className="brand">{brandName}</span>
        </Link>
        <nav className="nav">
          {navItems.map((item) => (
            <ActiveLink key={item.href} href={item.href}>{item.label}</ActiveLink>
          ))}
          <Link href="/child/settings" className="nav-settings-link small" title={tr(dict, "topbar.accountSettings")}>
            {tr(dict, "nav.settings")}
          </Link>
          <form style={{ margin: 0 }}>
            <button className="btn btn-ghost" formAction="/api/logout">{tr(dict, "nav.signOut")}</button>
          </form>
        </nav>
      </header>
      {children}
      <footer className="muted small" style={{ padding: "24px 0", borderTop: "1px solid var(--color-border)", marginTop: 40 }}>
        {tr(dict, "topbar.signedInAs", { email: session.email })}
      </footer>
    </div>
  );
}