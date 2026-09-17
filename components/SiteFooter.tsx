import Link from "next/link";
import { SITE_BRAND, SITE_MARKET } from "@/lib/site";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer-cols">
          <div className="site-footer-blurb">
            <span className="site-brand">{SITE_BRAND}</span>
            <p className="muted small">
              {`Childcare management software for ${SITE_MARKET} and the families they care for.`}
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
              <li><Link href="/login">Sign in</Link></li>
            </ul>
          </div>
        </div>
        <div className="site-footer-bottom muted small">
          © {new Date().getFullYear()} {SITE_BRAND}. Built for childcare, by
          childcare.
        </div>
      </div>
    </footer>
  );
}
