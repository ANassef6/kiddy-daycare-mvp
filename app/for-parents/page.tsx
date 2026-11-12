import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SiteReveal from "@/components/SiteReveal";
import { SITE_BRAND } from "@/lib/site";
import { siteContext } from "@/lib/site-i18n";

// KID-1826: every rendered string is localized (site.parents.*).
// KID-2077: data-reveal / data-reveal-stagger drive the once-per-load scroll
// reveal (<SiteReveal />); the benefit cards also lift on hover/:focus-visible.
export async function generateMetadata() {
  const { t } = await siteContext();
  return {
    title: t("site.meta.parentsTitle"),
    description: t("site.meta.parentsDesc"),
  };
}

export default async function ForParentsPage() {
  const { locale, t, brandImage, brandName } = await siteContext();

  return (
    <>
      <SiteHeader active="/for-parents" locale={locale} brandImage={brandImage} brandName={brandName} />
      <main id="main">
        <section className="section section-head">
          <div className="container" data-reveal>
            <p className="hero-eyebrow">{t("site.parents.eyebrow")}</p>
            <h1 className="page-title">{t("site.parents.title")}</h1>
            <p className="subtitle">{t("site.parents.subtitle")}</p>
            <p className="muted mt-3" style={{ maxWidth: 620 }}>
              {t("site.parents.intro", { brand: SITE_BRAND })}
            </p>
          </div>
        </section>

        <section className="section">
          <div className="container grid" data-reveal-stagger>
            {Array.from({ length: 6 }, (_, i) => i + 1).map((n) => (
              <div className="card feature-card" key={n}>
                <h3 className="mt-2">{t(`site.parents.b${n}Title`)}</h3>
                <p className="muted small mt-1">{t(`site.parents.b${n}Body`)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section section-alt">
          <div className="container" data-reveal>
            <h2 className="title center">{t("site.parents.closeTitle")}</h2>
            <p className="subtitle center" style={{ maxWidth: 640, marginInline: "auto" }}>
              {t("site.parents.closeBody")}
            </p>
            <p className="center muted mt-3" style={{ maxWidth: 640, marginInline: "auto" }}>
              {t("site.parents.closeAsk", { brand: SITE_BRAND })}
            </p>
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} />
      <SiteReveal />
    </>
  );
}
