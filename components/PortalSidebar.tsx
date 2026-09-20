"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { tr, type Dict, type Locale } from "@/lib/i18n";

export type NavItem = { label: string; href: string };
export type NavGroup = { label: string; href: string; items: NavItem[] };

// Confirmed menu tree (founder, 2026-09-13): five top-level menus plus a
// separate Settings (gear) for center configuration. Every sub-item maps to a
// real route — nothing here may be a dead link. Labels come from the active
// locale dictionary (KID-57).
export function portalNav(dict: Dict): NavGroup[] {
  const t = (key: string) => tr(dict, key);
  return [
    {
      label: t("nav.home"),
      href: "/portal/dashboard",
      items: [
        { label: t("nav.dashboard"), href: "/portal/dashboard" },
        { label: t("nav.newsFeed"), href: "/portal/newsfeed" },
        { label: t("nav.calendar"), href: "/portal/calendar" },
        { label: t("nav.parentDrive"), href: "/portal/drive" },
      ],
    },
    {
      label: t("nav.children"),
      href: "/portal/children",
      items: [
        { label: t("nav.childProfile"), href: "/portal/children" },
        { label: t("nav.attendance"), href: "/portal/attendance" },
      ],
    },
    {
      label: t("nav.learning"),
      href: "/portal/learning",
      items: [
        { label: t("nav.development"), href: "/portal/learning" },
        { label: t("nav.activities"), href: "/portal/learning/activities" },
        { label: t("nav.homework"), href: "/portal/learning/homework" },
      ],
    },
    {
      label: t("nav.staff"),
      href: "/portal/staff",
      items: [
        { label: t("nav.staffProfile"), href: "/portal/staff" },
        { label: t("nav.staffSchedule"), href: "/portal/staff/schedule" },
        { label: t("nav.workingHours"), href: "/portal/staff/hours" },
      ],
    },
    {
      label: t("nav.tools"),
      href: "/portal/report-center",
      items: [
        { label: t("nav.reportCenter"), href: "/portal/report-center" },
        { label: t("nav.inquiries"), href: "/portal/inquiries" },
        { label: t("nav.smartList"), href: "/portal/tags" },
        { label: t("nav.smartForm"), href: "/portal/forms" },
        { label: t("nav.surveys"), href: "/portal/surveys" },
        { label: t("nav.performance"), href: "/portal/performance" },
        { label: t("nav.finance"), href: "/portal/finance" },
        { label: t("nav.supplies"), href: "/portal/supplies" },
      ],
    },
  ];
}

// Settings (center configuration) lives behind its own gear icon, separate from
// the top-level menus.
export function portalSettingsNav(dict: Dict): NavGroup {
  const t = (key: string) => tr(dict, key);
  return {
    label: t("nav.settings"),
    href: "/portal/settings",
    items: [
      { label: t("nav.centerDetails"), href: "/portal/settings" },
      { label: t("nav.rooms"), href: "/portal/rooms" },
    ],
  };
}

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

function PortalSettingsNav({ pathname, dict }: { pathname: string; dict: Dict }) {
  const [open, setOpen] = useState(false);
  const group = portalSettingsNav(dict);
  const activeHref = activeIn(group.items, pathname);
  const expanded = open || !!activeHref;
  const t = (key: string) => tr(dict, key);

  return (
    <div className="portal-nav-settings">
      <button
        type="button"
        className={`portal-nav-settings-toggle${activeHref ? " active" : ""}`}
        aria-label={t("nav.settings")}
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

function PortalSidebarNav({ groups, dict }: { groups: NavGroup[]; dict: Dict }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const t = (key: string) => tr(dict, key);

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
                  aria-label={`${expanded ? t("nav.collapse") : t("nav.expand")} ${group.label}`}
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
      <PortalSettingsNav pathname={pathname} dict={dict} />
    </>
  );
}

export default function PortalSidebar({
  brandName,
  logoUrl,
  locale,
  dict,
}: {
  brandName: string;
  logoUrl?: string | null;
  locale: Locale;
  dict: Dict;
}) {
  const t = (key: string) => tr(dict, key);
  const groups = useMemo(() => portalNav(dict), [dict]);
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
        <PortalSidebarNav groups={groups} dict={dict} />
        <a href="/api/logout" className="small muted mt-3" style={{ display: "inline-block" }}>
          {t("nav.signOut")}
        </a>
      </div>
    </aside>
  );
}