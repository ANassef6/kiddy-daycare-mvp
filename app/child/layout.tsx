import Link from "next/link";
import { requireSession } from "@/lib/require";
import { familiesForAccount } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  const session = requireSession();
  let families: Record<string, unknown>[] = [];
  try {
    families = familiesForAccount(session.accountId);
  } catch {
    // fall through
  }

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <header className="row" style={{ justifyContent: "space-between", padding: "16px 0" }}>
        <span className="brand">Kiddy</span>
        <nav className="nav">
          <Link href="/child">My children</Link>
          <Link href="/child/newsfeed">Newsfeed</Link>
          <Link href="/child/consents">Consents</Link>
          <Link href="/child/incidents">Incidents</Link>
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
