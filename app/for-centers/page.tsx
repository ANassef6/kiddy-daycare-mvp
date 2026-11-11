import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { SITE_BRAND } from "@/lib/site";
import { siteContext } from "@/lib/site-i18n";

// KID-1826: every rendered string is localized (site.centers.*).
export async function generateMetadata() {
  const { t } = await siteContext();
  return {
    title: t("site.meta.centersTitle"),
    description: t("site.meta.centersDesc"),
  };
}

export default async function ForCentersPage() {
  const { locale, t, brandImage, brandName } = await siteContext();

  return (
    <>
      <SiteHeader active="/for-centers" locale={locale} brandImage={brandImage} brandName={brandName} />
      <main id="main">
        <section className="section section-head">
          <div className="container">
            <p className="hero-eyebrow">{t("site.centers.eyebrow")}</p>
            <h1 className="page-title">{t("site.centers.title")}</h1>
            <p className="subtitle">{t("site.centers.subtitle")}</p>
            <div className="row mt-3">
              <Link className="btn btn-deep btn-lg" href="/contact">
                {t("site.centers.ctaBook")}
              </Link>
              <Link className="btn btn-ghost btn-lg" href="/login">
                {t("site.centers.ctaPortal")}
              </Link>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container grid">
            {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
              <div className="card feature-card" key={n}>
                <h3 className="mt-2">{t(`site.centers.b${n}Title`)}</h3>
                <p className="muted small mt-1">{t(`site.centers.b${n}Body`)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section section-alt">
          <div className="container">
            <h2 className="title center">{t("site.centers.closeTitle")}</h2>
            <p className="subtitle center" style={{ maxWidth: 640, marginInline: "auto" }}>
              {t("site.centers.closeBody", { brand: SITE_BRAND })}
            </p>
            <p className="center mt-3">
              <Link className="btn btn-deep btn-lg" href="/contact">
                {t("site.centers.closeCta")}
              </Link>
            </p>
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
