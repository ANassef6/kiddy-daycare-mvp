"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

export type NavItem = { label: string; href: string };
export type NavGroup = { label: string; href: string; items: NavItem[] };

export const PORTAL_NAV: NavGroup[] = [
  { label: "Dashboard", href: "/portal/dashboard", items: [{ label: "Dashboard", href: "/portal/dashboard" }] },
  {
    label: "Children",
    href: "/portal/children",
    items: [
      { label: "All children", href: "/portal/children" },
      { label: "Child profile", href: "/portal/children" },
      { label: "Billing", href: "/portal/children" },
    ],
  },
  {
    label: "Rooms",
    href: "/portal/rooms",
    items: [
      { label: "All rooms", href: "/portal/rooms" },
      { label: "Room profile", href: "/portal/rooms" },
    ],
  },
  { label: "Staff", href: "/portal/staff", items: [{ label: "Staff list", href: "/portal/staff" }] },
  { label: "Attendance", href: "/portal/attendance", items: [{ label: "Attendance register", href: "/portal/attendance" }] },
  { label: "Daily reports", href: "/portal/reports", items: [{ label: "Daily reports", href: "/portal/reports" }] },
  { label: "Newsfeed", href: "/portal/newsfeed", items: [{ label: "Newsfeed", href: "/portal/newsfeed" }] },
  { label: "Events & video", href: "/portal/events", items: [{ label: "Events", href: "/portal/events" }] },
  {
    label: "Learning",
    href: "/portal/learning",
    items: [
      { label: "Observations", href: "/portal/learning" },
      { label: "Curriculum", href: "/portal/learning/curriculum" },
    ],
  },
  { label: "Parent drive", href: "/portal/drive", items: [{ label: "Parent drive", href: "/portal/drive" }] },
  { label: "Forms & surveys", href: "/portal/forms", items: [{ label: "Forms & surveys", href: "/portal/forms" }] },
  { label: "Tags & lists", href: "/portal/tags", items: [{ label: "Tags & lists", href: "/portal/tags" }] },
  { label: "Report center", href: "/portal/report-center", items: [{ label: "Report center", href: "/portal/report-center" }] },
  { label: "Consents", href: "/portal/consents", items: [{ label: "Consents", href: "/portal/consents" }] },
  { label: "Incidents", href: "/portal/incidents", items: [{ label: "Incidents", href: "/portal/incidents" }] },
  { label: "Live chat", href: "/portal/messages", items: [{ label: "Messages", href: "/portal/messages" }] },
  { label: "Support inbox", href: "/portal/support", items: [{ label: "Support inbox", href: "/portal/support" }] },
  { label: "Branding", href: "/portal/settings", items: [{ label: "Branding & settings", href: "/portal/settings" }] },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href.endsWith("/") ? href : `${href}/`);
}

function PortalSidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Keep the group containing the current page expanded.
  const activeGroup = useMemo(() => groups.find((g) => isActive(pathname, g.href))?.label ?? "", [groups, pathname]);
  useEffect(() => {
    if (activeGroup) setOpen((prev) => (prev[activeGroup] ? prev : { ...prev, [activeGroup]: true }));
  }, [activeGroup]);

  return (
    <nav className="portal-nav" aria-label="Portal">
      {groups.map((group) => {
        const groupActive = isActive(pathname, group.href);
        const expanded = !!open[group.label] || groupActive;
        const single = group.items.length === 1;
        return (
          <div className="portal-nav-group" key={group.label}>
            <div className={`portal-nav-head${groupActive ? " active" : ""}`}>
              {single ? (
                <Link className="portal-nav-label" href={group.href}>
                  {group.label}
                </Link>
              ) : (
                <>
                  <Link
                    className="portal-nav-label"
                    href={group.href}
                    onClick={() => setOpen((prev) => ({ ...prev, [group.label]: !prev[group.label] }))}
                  >
                    {group.label}
                  </Link>
                  <button
                    type="button"
                    className="portal-nav-toggle"
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${group.label}`}
                    aria-expanded={expanded}
                    onClick={() => setOpen((prev) => ({ ...prev, [group.label]: !prev[group.label] }))}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {expanded ? <path d="M18 15l-6-6-6 6" /> : <path d="M9 18l6-6-6-6" />}
                    </svg>
                  </button>
                </>
              )}
            </div>
            {expanded && (
              <div className="portal-nav-sub">
                {group.items.map((item) => (
                  <Link
                    key={`${item.href}-${item.label}`}
                    href={item.href}
                    className={`portal-nav-sub-link${isActive(pathname, item.href) ? " active" : ""}`}
                    aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default function PortalSidebar({
  brandName,
  logoUrl,
}: {
  brandName: string;
  logoUrl?: string | null;
}) {
  return (
    <aside className="shell-side">
      <Link href="/portal/dashboard" className="site-brand" style={{ textDecoration: "none" }}>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" width={28} height={28} className="site-logo" />
        )}
        <span className="brand">{brandName}</span>
      </Link>
      <div className="mt-4">
        <PortalSidebarNav groups={PORTAL_NAV} />
        <a href="/api/logout" className="small muted mt-3" style={{ display: "inline-block" }}>
          Sign out
        </a>
      </div>
    </aside>
  );
}