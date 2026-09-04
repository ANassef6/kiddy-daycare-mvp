import Link from "next/link";
import { getBranding } from "@/lib/theme";

export type SiteHeaderProps = {
  active?: string;
};

const NAV: { href: string; label: string }[] = [
  { href: "/features", label: "Features" },
  { href: "/for-parents", label: "For parents" },
  { href: "/for-centers", label: "For centers" },
  { href: "/contact", label: "Book a demo" },
];

export default async function SiteHeader({ active }: SiteHeaderProps) {
  const branding = await getBranding();
  return (
    <header className="site-header">
      <div className="container row" style={{ justifyContent: "space-between" }}>
        <Link href="/" className="site-brand" aria-label={`${branding.name} — home`}>
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt="" width="32" height="32" className="site-logo" />
          ) : null}
          <span>{branding.name}</span>
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
            Sign in
          </Link>
          <Link href="/contact" className="btn btn-primary site-nav-cta">
            Book a demo
          </Link>
        </nav>
      </div>
    </header>
  );
}