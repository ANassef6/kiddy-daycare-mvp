import Link from "next/link";
import ActiveLink from "@/components/ActiveLink";
import { requireSession } from "@/lib/require";

export const dynamic = "force-dynamic";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = requireSession();
  const links = [
    { href: "/portal/dashboard", label: "Dashboard" },
    { href: "/portal/children", label: "Children" },
    { href: "/portal/rooms", label: "Rooms" },
    { href: "/portal/staff", label: "Staff" },
    { href: "/portal/attendance", label: "Attendance" },
    { href: "/portal/reports", label: "Daily reports" },
    { href: "/portal/newsfeed", label: "Newsfeed" },
    { href: "/portal/events", label: "Events & video" },
    { href: "/portal/learning", label: "Learning" },
    { href: "/portal/drive", label: "Parent drive" },
    { href: "/portal/forms", label: "Forms & surveys" },
    { href: "/portal/tags", label: "Tags & lists" },
    { href: "/portal/report-center", label: "Report center" },
    { href: "/portal/consents", label: "Consents" },
    { href: "/portal/incidents", label: "Incidents" },
    { href: "/portal/messages", label: "Live chat" },
    { href: "/portal/support", label: "Support inbox" },
    { href: "/portal/settings", label: "Branding" },
  ];
  return (
    <div className="shell">
      <aside className="shell-side">
        <span className="brand">Kiddy</span>
        <div className="mt-4" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {links.map((l) => (
            <ActiveLink key={l.href} href={l.href}>{l.label}</ActiveLink>
          ))}
          <a href="/api/logout" className="small muted mt-3">Sign out</a>
        </div>
      </aside>
      <main className="shell-main">
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
            ⚠️ Your email isn&apos;t confirmed yet — password sign-in is locked until you click the link we sent.
            <Link href="/welcome" className="small" style={{ marginLeft: 8, fontWeight: 600 }}>
              Confirm your email
            </Link>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
