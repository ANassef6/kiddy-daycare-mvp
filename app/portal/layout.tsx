import Link from "next/link";
import { requireSession } from "@/lib/require";

export const dynamic = "force-dynamic";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  requireSession();
  const links = [
    { href: "/portal/dashboard", label: "Dashboard" },
    { href: "/portal/children", label: "Children" },
    { href: "/portal/rooms", label: "Rooms" },
    { href: "/portal/staff", label: "Staff" },
    { href: "/portal/attendance", label: "Attendance" },
    { href: "/portal/reports", label: "Daily reports" },
    { href: "/portal/newsfeed", label: "Newsfeed" },
    { href: "/portal/consents", label: "Consents" },
    { href: "/portal/incidents", label: "Incidents" },
    { href: "/portal/settings", label: "Branding" },
  ];
  return (
    <div className="shell">
      <aside className="shell-side">
        <span className="brand">Kiddy</span>
        <div className="mt-4" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {links.map((l) => (
            <Link key={l.href} href={l.href}>{l.label}</Link>
          ))}
          <a href="/api/logout" className="small muted mt-3">Sign out</a>
        </div>
      </aside>
      <main className="shell-main">{children}</main>
    </div>
  );
}
