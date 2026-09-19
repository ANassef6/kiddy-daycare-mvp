"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

export type NavItem = { label: string; href: string };
export type NavGroup = { label: string; href: string; items: NavItem[] };

// Confirmed menu tree (founder, 2026-09-13): five top-level menus plus a
// separate Settings (gear) for center configuration. Every sub-item maps to a
// real route — nothing here may be a dead link.
export const PORTAL_NAV: NavGroup[] = [
  {
    label: "Home",
    href: "/portal/dashboard",
    items: [
      { label: "Dashboard", href: "/portal/dashboard" },
      { label: "News feed", href: "/portal/newsfeed" },
      { label: "Calendar", href: "/portal/calendar" },
      { label: "Parent drive", href: "/portal/drive" },
    ],
  },
  {
    label: "Children",
    href: "/portal/children",
    items: [
      { label: "Child profile", href: "/portal/children" },
      { label: "Attendance", href: "/portal/attendance" },
    ],
  },
  {
    label: "Learning",
    href: "/portal/learning",
    items: [
      { label: "Development", href: "/portal/learning" },
      { label: "Activities", href: "/portal/learning/activities" },
      { label: "Homework", href: "/portal/learning/homework" },
    ],
  },
  {
    label: "Staff",
    href: "/portal/staff",
    items: [
      { label: "Staff profile", href: "/portal/staff" },
      { label: "Staff schedule", href: "/portal/staff/schedule" },
      { label: "Working hours", href: "/portal/staff/hours" },
    ],
  },
  {
    label: "Tools",
    href: "/portal/report-center",
    items: [
      { label: "Report center", href: "/portal/report-center" },
      { label: "Inquiries", href: "/portal/inquiries" },
      { label: "Smart list", href: "/portal/tags" },
      { label: "Smart form", href: "/portal/forms" },
      { label: "Surveys", href: "/portal/surveys" },
      { label: "Performance", href: "/portal/performance" },
      { label: "Finance", href: "/portal/finance" },
      { label: "Supplies", href: "/portal/supplies" },
    ],
  },
];

// Settings (center configuration) lives behind its own gear icon, separate from
// the top-level menus.
export const SETTINGS_NAV: NavGroup = {
  label: "Settings",
  href: "/portal/settings",
  items: [
    { label: "Center details", href: "/portal/settings" },
    { label: "Rooms", href: "/portal/rooms" },
  ],
};

function matches(pathname: string, href: string): boolean {
  // Prefix match, so child pages stay highlighted under their menu item.
  return pathname === href || pathname.startsWith(href.endsWith("/") ? href : `${href}/`);
}

// Longest-prefix wins inside a menu, so the parent label (e.g. "Child profile")
// doesn't stay highlighted when a deeper page (e.g. children/development) is
// the active route.
function activeIn(items: NavItem[], pathname: string): string {
  const hit = items.filter((i) => matches(pathname, i.href));
  if (hit.length === 0) return "";
  return hit.sort((a, b) => b.href.length - a.href.length)[0].href;
}

function PortalSettingsNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const group = SETTINGS_NAV;
  const activeHref = activeIn(group.items, pathname);
  const expanded = open || !!activeHref;

  return (
    <div className="portal-nav-settings">
      <button
        type="button"
        className={`portal-nav-settings-toggle${activeHref ? " active" : ""}`}
        aria-label="Settings — center configuration"
        aria-expanded={expanded}
        onClick={() => setOpen((prev) => !prev)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {expanded && (
        <div className="portal-nav-sub">
          {group.items.map((item) => (
            <Link
              key={`${item.href}-${item.label}`}
              href={item.href}
              className={`portal-nav-sub-link${item.href === activeHref ? " active" : ""}`}
              aria-current={item.href === activeHref ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function PortalSidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Keep the menu containing the current page expanded.
  const activeGroup = useMemo(
    () => groups.find((g) => g.items.some((item) => matches(pathname, item.href)))?.label ?? "",
    [groups, pathname]
  );
  useEffect(() => {
    // KID-52 #13: single-open accordion — navigating to another menu's page
    // collapses the previous group instead of stacking them.
    if (!activeGroup) return;
    setOpen((prev) => (prev[activeGroup] && Object.keys(prev).length === 1 ? prev : { [activeGroup]: true }));
  }, [activeGroup]);

  // KID-52 #13: accordion — expanding one group collapses the others.
  const toggle = (label: string) => () =>
    setOpen((prev) => (prev[label] ? {} : { [label]: true }));

  return (
    <>
      <div className="portal-nav">
        {groups.map((group) => {
          const activeHref = activeIn(group.items, pathname);
          const expanded = !!open[group.label] || !!activeHref;
          return (
            <div className="portal-nav-group" key={group.label}>
              <div className={`portal-nav-head${matches(pathname, group.href) ? " active" : ""}`}>
                <Link className="portal-nav-label" href={group.href} onClick={toggle(group.label)}>
                  {group.label}
                </Link>
                <button
                  type="button"
                  className="portal-nav-toggle"
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${group.label}`}
                  aria-expanded={expanded}
                  onClick={toggle(group.label)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {expanded ? <path d="M18 15l-6-6-6 6" /> : <path d="M9 18l6-6-6-6" />}
                  </svg>
                </button>
              </div>
              {expanded && (
                <div className="portal-nav-sub">
                  {group.items.map((item) => (
                    <Link
                      key={`${item.href}-${item.label}`}
                      href={item.href}
                      className={`portal-nav-sub-link${item.href === activeHref ? " active" : ""}`}
                      aria-current={item.href === activeHref ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <PortalSettingsNav pathname={pathname} />
    </>
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
      <div className="mt-4 d-flex-col">
        <PortalSidebarNav groups={PORTAL_NAV} />
        <a href="/api/logout" className="small muted mt-3" style={{ display: "inline-block" }}>
          Sign out
        </a>
      </div>
    </aside>
  );
}