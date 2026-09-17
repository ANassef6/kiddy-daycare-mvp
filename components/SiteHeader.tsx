import Link from "next/link";
import { SITE_BRAND } from "@/lib/site";

export type SiteHeaderProps = {
  active?: string;
};

const NAV: { href: string; label: string }[] = [
  { href: "/features", label: "Features" },
  { href: "/for-parents", label: "For parents" },
  { href: "/for-centers", label: "For centers" },
  { href: "/contact", label: "Book a demo" },
];

export default function SiteHeader({ active }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <div className="container row" style={{ justifyContent: "space-between" }}>
        <Link href="/" className="site-brand" aria-label={`${SITE_BRAND} — home`}>
          <span className="site-brand-mark" aria-hidden="true">
            K
          </span>
          <span>{SITE_BRAND}</span>
        </Link>
        <nav className="site-nav" aria-label="Main navigation">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={active === item.href ? "active" : undefined}
              aria-current={active === item.href ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
          <Link href="/login" className="site-nav-signin">
            Staff sign in
          </Link>
          <Link href="/contact" className="btn btn-primary site-nav-cta">
            Book a demo
          </Link>
        </nav>
      </div>
    </header>
  );
}
