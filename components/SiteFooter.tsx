import Link from "next/link";
import { getBranding } from "@/lib/theme";

export default async function SiteFooter() {
  const branding = await getBranding();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer-cols">
          <div className="site-footer-blurb">
            <span className="site-brand">{branding.name}</span>
            <p className="muted small">
              White-label childcare management software for Canadian daycares
              and the families they care for.
            </p>
          </div>
          <div>
            <h3 className="site-footer-heading">Product</h3>
            <ul className="site-footer-links">
              <li><Link href="/features">Features</Link></li>
              <li><Link href="/for-parents">For parents</Link></li>
              <li><Link href="/for-centers">For centers</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="site-footer-heading">Company</h3>
            <ul className="site-footer-links">
              <li><Link href="/contact">Book a demo</Link></li>
              <li><Link href="/contact">Contact us</Link></li>
              <li><Link href="/login">Parent sign in</Link></li>
            </ul>
          </div>
        </div>
        <div className="site-footer-bottom muted small">
          © {new Date().getFullYear()} {branding.name}. Built for childcare,
          by childcare.
        </div>
      </div>
    </footer>
  );
}