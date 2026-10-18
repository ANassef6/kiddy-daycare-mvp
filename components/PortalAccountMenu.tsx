"use client";

// KID-199.2: the account menu used to live in the server layout as a plain
// <details>. Client-side navigation doesn't remount the layout, so the menu
// stayed open across page transitions. It now lives here as a client
// component that closes on navigation, outside interaction and Escape.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { tr, type Dict } from "@/lib/i18n";
import { isAdminRole } from "@/lib/role";
import Avatar from "@/components/Avatar";

export type PortalAccountMenuProps = {
  email: string;
  role: string;
  displayName: string;
  photoUrl?: string | null;
  dict: Dict;
};

export const accountMenuItems = (role: string): { key: string; href: string; adminOnly?: boolean }[] => [
  { key: "topbar.accountSettings", href: "/portal/account" },
  { key: "topbar.centerSettings", href: "/portal/settings", adminOnly: true },
  { key: "topbar.helpSupport", href: "/portal/support" },
];

export default function PortalAccountMenu({ email, role, displayName, photoUrl, dict }: PortalAccountMenuProps) {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  // Client-side navigation doesn't remount the portal layout, so close the
  // menu explicitly whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = detailsRef.current;
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

  const toggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    // Keep React state in sync with native summary clicks. Avoid setState on
    // toggles we caused ourselves (rendered `open` already matches state).
    const next = detailsRef.current?.open ?? e.currentTarget.open;
    if (next !== open) setOpen(next);
  };

  return (
    <details
      ref={detailsRef}
      className="portal-account"
      open={open}
      onToggle={toggle}
    >
      <summary className="portal-account-toggle" aria-label={tr(dict, "topbar.accountSettings")} title={email}>
        <Avatar src={photoUrl} name={displayName} size={28} className="portal-account-avatar" />
        <span className="portal-account-name">{displayName}</span>
      </summary>
      <div className="portal-account-menu">
        <div className="portal-account-meta">
          <div className="portal-account-email">{email}</div>
          <div className="small muted">{role}</div>
        </div>
        {accountMenuItems(role).map((item) => {
          if (item.adminOnly && !isAdminRole(role)) return null;
          return (
            <Link key={item.key} href={item.href} className="portal-account-link" onClick={() => setOpen(false)}>
              {tr(dict, item.key)}
            </Link>
          );
        })}
        <a href="/api/logout" className="portal-account-link" onClick={() => setOpen(false)}>
          {tr(dict, "topbar.logout")}
        </a>
      </div>
    </details>
  );
}
