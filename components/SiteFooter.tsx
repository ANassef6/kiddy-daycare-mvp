import Link from "next/link";
import { SITE_BRAND } from "@/lib/site";
import { getDictionary, tr, type Locale } from "@/lib/i18n";
import { withLang } from "@/lib/site-lang";

export type SiteFooterProps = {
  // KID-1826: the footer renders in the request's site language (defaults to
  // English so the static chrome tests keep rendering EN).
  locale?: Locale;
};

export default function SiteFooter({ locale = "en" }: SiteFooterProps = {}) {
  const dict = getDictionary(locale);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);

  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer-cols">
          <div className="site-footer-blurb">
            <span className="site-brand">{SITE_BRAND}</span>
            <p className="muted small">{t("site.footer.blurb")}</p>
          </div>
          <div>
            <h3 className="site-footer-heading">{t("site.footer.productHeading")}</h3>
            <ul className="site-footer-links">
              <li><Link href={withLang("/features", locale)}>{t("site.footer.features")}</Link></li>
              <li><Link href={withLang("/for-parents", locale)}>{t("site.footer.forParents")}</Link></li>
              <li><Link href={withLang("/for-centers", locale)}>{t("site.footer.forCenters")}</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="site-footer-heading">{t("site.footer.companyHeading")}</h3>
            <ul className="site-footer-links">
              <li><Link href={withLang("/contact", locale)}>{t("site.footer.bookDemo")}</Link></li>
              <li><Link href={withLang("/contact", locale)}>{t("site.footer.contactUs")}</Link></li>
              <li><Link href="/login">{t("site.footer.signIn")}</Link></li>
            </ul>
          </div>
        </div>
        <div className="site-footer-bottom muted small">
          {t("site.footer.bottom", { year: new Date().getFullYear(), brand: SITE_BRAND })}
        </div>
      </div>
    </footer>
  );
}
