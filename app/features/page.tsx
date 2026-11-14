import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SiteReveal from "@/components/SiteReveal";
import { SITE_BRAND } from "@/lib/site";
import { siteContext } from "@/lib/site-i18n";
import { withLang } from "@/lib/site-lang";

// KID-1826: every rendered string is localized (site.features.*).
// KID-2077: data-reveal / data-reveal-stagger drive the once-per-load scroll
// reveal (<SiteReveal />); the cards also lift on hover / :focus-visible.
export async function generateMetadata() {
  const { t } = await siteContext();
  return {
    title: t("site.meta.featuresTitle", { brand: SITE_BRAND }),
    description: t("site.meta.featuresDesc"),
  };
}

export default async function FeaturesPage() {
  const { locale, t, brandImage, brandName, nextPath } = await siteContext();

  return (
    <>
      <SiteHeader active="/features" locale={locale} brandImage={brandImage} brandName={brandName} nextPath={nextPath} />
      <main id="main">
        <section className="section section-head">
          <div className="container" data-reveal>
            <p className="hero-eyebrow">{t("site.features.eyebrow")}</p>
            <h1 className="page-title">{t("site.features.title")}</h1>
            <p className="subtitle">{t("site.features.subtitle")}</p>
          </div>
        </section>

        <section className="section">
          <div className="container grid" data-reveal-stagger>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <div className="card feature-card" key={n}>
                <h3 className="mt-2">{t(`site.features.f${n}Title`)}</h3>
                <p className="muted small mt-1">{t(`site.features.f${n}Body`)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section section-cta">
          <div className="container">
            <div className="card cta-card" data-reveal>
              <h2 className="title">{t("site.features.ctaTitle")}</h2>
              <p className="subtitle" style={{ marginBottom: 0 }}>
                {t("site.features.ctaSub")}
              </p>
              <div className="row mt-3">
                <Link className="btn btn-deep btn-lg" href={withLang("/contact", locale)}>
                  {t("site.features.ctaBook")}
                </Link>
                <Link className="btn btn-ghost btn-lg" href={withLang("/for-centers", locale)}>
                  {t("site.features.ctaCenters")}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} />
      <SiteReveal />
    </>
  );
}
