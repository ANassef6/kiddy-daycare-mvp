"use client";

// KID-255: at phone widths the parent header crammed the brand, nine nav
// links, settings and the sign-out button into one wrapping row, and on
// Android the sign-out button landed past the right viewport edge — trimmed
// and untappable. Below the 720px breakpoint the page links (plus Settings)
// now collapse into a hamburger dropdown and the sign-out button is pinned
// as the last header item, so it is always fully visible and tappable at
// 320–430px. Above the breakpoint the inline nav renders exactly as before.
// Close-on-navigate / outside-click / Escape mirrors PortalAccountMenu
// (KID-199.2).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { tr, type Dict } from "@/lib/i18n";
import ActiveLink from "@/components/ActiveLink";

export type ChildNavMenuProps = {
  items: { href: string; label: string }[];
  settingsHref: string;
  settingsLabel: string;
  settingsTitle: string;
  signOutLabel: string;
  dict: Dict;
};

export default function ChildNavMenu({
  items,
  settingsHref,
  settingsLabel,
  settingsTitle,
  signOutLabel,
  dict,
}: ChildNavMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Client-side navigation doesn't remount the layout, so close the menu
  // explicitly whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = rootRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const panel = (
    <div className="child-nav-panel">
      {items.map((item) => (
        <ActiveLink key={item.href} href={item.href}>{item.label}</ActiveLink>
      ))}
      <Link href={settingsHref} title={settingsTitle}>{settingsLabel}</Link>
    </div>
  );

  return (
    <div className="child-nav" ref={rootRef}>
      {/* Phone widths: hamburger + dropdown panel (panel only while open). */}
      <button
        type="button"
        className="child-nav-burger"
        aria-label={open ? `${tr(dict, "nav.collapse")} ${tr(dict, "nav.menu")}` : `${tr(dict, "nav.expand")} ${tr(dict, "nav.menu")}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {open ? (
            <path d="M18 6L6 18M6 6l12 12" />
          ) : (
            <path d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>
      {open && panel}
      {/* Desktop: the original inline nav row, unchanged. */}
      <nav className="nav child-nav-inline">
        {items.map((item) => (
          <ActiveLink key={item.href} href={item.href}>{item.label}</ActiveLink>
        ))}
        <Link href={settingsHref} className="nav-settings-link small" title={settingsTitle}>
          {settingsLabel}
        </Link>
      </nav>
      {/* Pinned last at every width: never pushed off-screen by the links. */}
      <form style={{ margin: 0 }}>
        <button className="btn btn-ghost" formAction="/api/logout">{signOutLabel}</button>
      </form>
    </div>
  );
}
