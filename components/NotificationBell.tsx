import Link from "next/link";

// KID-474: the bell icon both shells share; the unread badge renders only
// when there is something to catch up on (screen readers get a count).
export default function NotificationBell({
  href,
  label,
  badgeAriaLabel,
  unread,
}: {
  href: string;
  label: string;
  badgeAriaLabel: string;
  unread: number;
}) {
  return (
    <Link
      href={href}
      className="portal-topbar-icon"
      style={{ position: "relative", display: "inline-flex" }}
      aria-label={label}
      title={label}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unread > 0 && (
        <span
          style={{
            position: "absolute",
            top: -5,
            right: -7,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            background: "var(--color-danger, #ef4444)",
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            lineHeight: "16px",
            textAlign: "center",
            padding: "0 4px",
          }}
          role="status"
          aria-label={badgeAriaLabel}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
