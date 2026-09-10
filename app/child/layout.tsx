import Link from "next/link";
import ActiveLink from "@/components/ActiveLink";
import { requireSession } from "@/lib/require";
import { familiesForAccount } from "@/lib/store";
import { getBranding } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const session = requireSession();
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

  return (
    <div className="container" style={{ maxWidth: 720 }}>
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
          Your email isn&apos;t confirmed yet — password sign-in is locked until you click the link we sent.
          <Link href="/welcome" className="small" style={{ marginLeft: 8, fontWeight: 600 }}>
            Confirm your email
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
          <ActiveLink href="/child">My children</ActiveLink>
          <ActiveLink href="/child/newsfeed">Newsfeed</ActiveLink>
          <ActiveLink href="/child/events">Events</ActiveLink>
          <ActiveLink href="/child/learning">Learning</ActiveLink>
          <ActiveLink href="/child/drive">Drive</ActiveLink>
          <ActiveLink href="/child/forms">Surveys</ActiveLink>
          <ActiveLink href="/child/consents">Consents</ActiveLink>
          <ActiveLink href="/child/messages">Chat</ActiveLink>
          <ActiveLink href="/child/support">Support</ActiveLink>
          <form style={{ margin: 0 }}>
            <button className="btn btn-ghost" formAction="/api/logout">Sign out</button>
          </form>
        </nav>
      </header>
      {children}
      <footer className="muted small" style={{ padding: "24px 0", borderTop: "1px solid var(--color-border)", marginTop: 40 }}>
        Signed in as {session.email}
      </footer>
    </div>
  );
}
