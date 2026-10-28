"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { tr, type Dict, type Locale } from "@/lib/i18n";
import { isAdminRole } from "@/lib/role";

export type NavItem = { label: string; href: string };
export type NavGroup = { label: string; href: string; items: NavItem[] };

// Confirmed menu tree (founder, 2026-09-13): five top-level menus. Every
// sub-item maps to a real route — nothing here may be a dead link. Labels come
// from the active locale dictionary (KID-57).
// KID-179: the sidebar Settings (gear) group is gone. Account settings
// (/portal/account) and center settings (/portal/settings) live in the
// top-right user menu (app/portal/layout.tsx), and Rooms now sits in Tools.
export function portalNav(dict: Dict, role?: string): NavGroup[] {
  const t = (key: string) => tr(dict, key);
  const groups: NavGroup[] = [
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
  ];

  // KID-105 #14: the Tools menu exposes center-wide admin surfaces (staff
  // accounts, all children, finance, etc.). Keep it visible only to admins.
  // KID-179 item 4: Rooms joins the Tools group. The Rooms page itself stays
  // scoped to the staff member's assigned classrooms (KID-105 #16, unchanged).
  if (isAdminRole(role ?? "")) {
    const tools: NavItem[] = [
      { label: t("nav.reportCenter"), href: "/portal/report-center" },
      // KID-86 #10: Inquiries moved under Smart Forms — no standalone entry.
      { label: t("nav.smartList"), href: "/portal/tags" },
      { label: t("nav.smartForm"), href: "/portal/forms" },
      { label: t("nav.surveys"), href: "/portal/surveys" },
      { label: t("nav.performance"), href: "/portal/performance" },
      { label: t("nav.finance"), href: "/portal/finance" },
      { label: t("nav.supplies"), href: "/portal/supplies" },
      { label: t("nav.rooms"), href: "/portal/rooms" },
    ];
    // KID-246: "Account billing" is the daycare OWNER's own surface — the
    // subscription plan, the read-only rates and the daycare's invoice
    // ledger. A plain admin (staff-level manager) must not see or reach it,
    // which is why this is the exact owner role, not isAdminRole. The page
    // itself (app/portal/account-billing) re-checks the session and refuses
    // every non-owner, so the tab and the URL stay in sync.
    if (role === "owner") {
      tools.push({ label: t("nav.accountBilling"), href: "/portal/account-billing" });
      // KID-258 A1 (KID-264): "Enhancements requests" rides the same EXACT
      // owner gate as Account billing (not isAdminRole — a plain admin must
      // not see it either). The page (app/portal/enhancements) re-checks the
      // session and refuses every non-owner, so the tab and the URL stay in
      // sync. Submissions land in the queue for the KID-258 Linear sync
      // agent; the app itself never calls Linear.
      tools.push({ label: t("nav.enhancements"), href: "/portal/enhancements" });
    }
    groups.push({
      label: t("nav.tools"),
      href: "/portal/report-center",
      items: tools,
    });
  }

  return groups;
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
    </>
  );
}

export default function PortalSidebar({
  brandName,
  logoUrl,
  locale,
  dict,
  role,
}: {
  brandName: string;
  logoUrl?: string | null;
  locale: Locale;
  dict: Dict;
  role?: string;
}) {
  const groups = useMemo(() => portalNav(dict, role), [dict, role]);
  return (
    <aside className="shell-side">
      <Link href="/portal/dashboard" className="site-brand" style={{ textDecoration: "none" }}>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" width={28} height={28} className="site-logo" />
        )}
        <span className="brand">{brandName}</span>
      </Link>
      {/* KID-199.1: sign-out lives only in the top-right account menu. */}
      <div className="mt-4 d-flex-col">
        <PortalSidebarNav groups={groups} dict={dict} />
      </div>
    </aside>
  );
}