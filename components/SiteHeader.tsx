import Link from "next/link";
import { SITE_BRAND } from "@/lib/site";
import { getDictionary, tr, type Locale } from "@/lib/i18n";
import SiteLangToggle from "@/components/SiteLangToggle";
import HeaderScrollState from "@/components/HeaderScrollState";
import { withLang } from "@/lib/site-lang";

export type SiteHeaderProps = {
  active?: string;
  // KID-1826: the marketing header renders in the request's site language
  // (defaults to English so the static chrome test keeps rendering EN).
  locale?: Locale;
  // KID-1826 deliverable 1: the tenant's brand image sits inline in the
  // lockup, after the K mark and the wordmark. Null (apex/anonymous hosts
  // with no tenant image) renders exactly the [K] Kiddy lockup — no empty
  // slot, no gap.
  brandImage?: string | null;
  brandName?: string;
  // KID-2072: the current path + query, handed to the language switcher so
  // the server switch returns the visitor to exactly where they were.
  nextPath?: string | null;
};

const NAV: { href: string; key: string }[] = [
  { href: "/features", key: "site.nav.features" },
  { href: "/for-parents", key: "site.nav.forParents" },
  { href: "/for-centers", key: "site.nav.forCenters" },
];

export default function SiteHeader({
  active,
  locale = "en",
  brandImage = null,
  brandName,
  nextPath = null,
}: SiteHeaderProps) {
  const dict = getDictionary(locale);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);

  return (
    <header className="site-header">
      <HeaderScrollState />
      <div className="container row" style={{ justifyContent: "space-between" }}>
        <Link href={withLang("/", locale)} className="site-brand" aria-label={t("site.nav.homeAria", { brand: SITE_BRAND })}>
          <span className="site-brand-mark" aria-hidden="true">
            K
          </span>
          <span>{SITE_BRAND}</span>
          {brandImage ? (
            // KID-1826: fixed reserved box (100×32 desktop / 80×24 mobile) so
            // the space exists before the image loads — CLS stays 0 — with
            // object-fit contain handling any tenant aspect ratio. Header
            // imagery is above the fold, so it loads eagerly.
            <span className="site-brand-img-box">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={brandImage}
                alt={t("site.brandImageAlt", { name: brandName || SITE_BRAND })}
                className="site-brand-img"
              />
            </span>
          ) : null}
        </Link>
        <nav className="site-nav" aria-label={t("site.nav.aria")}>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={withLang(item.href, locale)}
              className={active === item.href ? "active" : undefined}
              aria-current={active === item.href ? "page" : undefined}
            >
              {t(item.key)}
            </Link>
          ))}
          <SiteLangToggle
            current={locale}
            label={t("site.lang.label")}
            labels={{ en: t("site.lang.en"), ar: t("site.lang.ar") }}
            nextPath={nextPath}
          />
          <Link href="/login" className="site-nav-signin">
            {t("site.nav.portal")}
          </Link>
          <Link href={withLang("/contact", locale)} className="btn btn-deep site-nav-cta">
            {t("site.nav.bookDemo")}
          </Link>
        </nav>
      </div>
    </header>
  );
}
