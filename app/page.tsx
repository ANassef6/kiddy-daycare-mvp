import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { SITE_BRAND } from "@/lib/site";
import { siteContext } from "@/lib/site-i18n";

// KID-1632 rebrand — "the center's day". The landing shows the product's own
// world instead of selling at it: a live day panel in the hero, a timeline
// band anchoring the app to the real rhythm of a center, feature rows tied to
// the moment of the day when each thing happens, and a genuine numbered
// sequence only where the content really is one (getting started).
// KID-1826: every rendered string is localized (site.landing.*) and the
// tenant brand image rides inline in the header lockup.
export async function generateMetadata() {
  const { locale, t } = await siteContext();
  return {
    title: t("site.meta.homeTitle", { brand: SITE_BRAND }),
    description: t("site.meta.homeDesc"),
  };
}

export default async function HomePage() {
  const { locale, t, brandImage, brandName } = await siteContext();
  // Sample-day names: localized per locale so no mixed-language page ships.
  const amira = locale === "ar" ? "أميرة" : "Amira";
  const omar = locale === "ar" ? "عمر" : "Omar";

  return (
    <>
      <SiteHeader active="/" locale={locale} brandImage={brandImage} brandName={brandName} />
      <main id="main">
        <section className="hero">
          <div className="container hero-grid">
            <div className="hero-copy">
              <h1>{t("site.landing.heroTitle")}</h1>
              <p className="hero-sub">{t("site.landing.heroSub")}</p>
              <div className="row mt-4">
                <Link className="btn btn-deep btn-lg" href="/contact">
                  {t("site.landing.heroCta")}
                </Link>
                <Link className="btn btn-ghost btn-lg" href="/for-parents">
                  {t("site.landing.heroParentCta")}
                </Link>
              </div>
            </div>

            <aside className="day-panel" aria-label={t("site.landing.dayPanelAria")}>
              <div className="day-panel-head">
                <h2>{t("site.landing.dayPanelTitle")}</h2>
                <p className="muted small">{t("site.landing.dayPanelSub")}</p>
              </div>
              <ul className="day-list">
                <li className="day-row">
                  <span className="day-name">{amira}</span>
                  <span className="day-detail">{t("site.landing.dayArrived", { time: "7:58" })}</span>
                  <span className="status-chip">{t("site.landing.dayCheckedIn")}</span>
                </li>
                <li className="day-row">
                  <span className="day-name">{omar}</span>
                  <span className="day-detail">{t("site.landing.dayArrived", { time: "8:12" })}</span>
                  <span className="status-chip">{t("site.landing.dayCheckedIn")}</span>
                </li>
                <li className="day-row day-row-report">
                  <div className="day-report-head">
                    <span className="day-name">{t("site.landing.dayNoonReport", { name: amira })}</span>
                    <span className="status-chip status-chip-mood">{t("site.landing.dayCheerful")}</span>
                  </div>
                  <div className="day-report-chips">
                    <span className="status-chip status-chip-diaper">{t("site.landing.dayLunch")}</span>
                    <span className="status-chip status-chip-sleep">
                      {t("site.landing.dayNap", { duration: locale === "ar" ? "١ س ٢٠ د" : "1h 20m" })}
                    </span>
                  </div>
                  <p className="day-report-note small">{t("site.landing.dayNote")}</p>
                </li>
              </ul>
              <p className="day-panel-foot muted small">{t("site.landing.dayPanelFoot")}</p>
            </aside>
          </div>
        </section>

        <section className="day-band" aria-label={t("site.landing.bandAria")}>
          <div className="container day-band-grid">
            <div className="day-band-item">
              <span className="day-band-time">{t("site.landing.band1Time")}</span>
              <p>{t("site.landing.band1Body")}</p>
            </div>
            <div className="day-band-item">
              <span className="day-band-time">{t("site.landing.band2Time")}</span>
              <p>{t("site.landing.band2Body")}</p>
            </div>
            <div className="day-band-item">
              <span className="day-band-time">{t("site.landing.band3Time")}</span>
              <p>{t("site.landing.band3Body")}</p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <h2 className="section-title center">{t("site.landing.whatRunsTitle")}</h2>
            <p className="subtitle center">{t("site.landing.whatRunsSub")}</p>
            <div className="feature-rows">
              <div className="feature-row">
                <span className="feature-moment">{t("site.landing.momentMorning")}</span>
                <div>
                  <h3>{t("site.landing.checkInOutTitle")}</h3>
                  <p>{t("site.landing.checkInOutBody")}</p>
                </div>
              </div>
              <div className="feature-row">
                <span className="feature-moment">{t("site.landing.momentMidday")}</span>
                <div>
                  <h3>{t("site.landing.dailyReportsTitle")}</h3>
                  <p>{t("site.landing.dailyReportsBody")}</p>
                </div>
              </div>
              <div className="feature-row">
                <span className="feature-moment">{t("site.landing.momentAllDay")}</span>
                <div>
                  <h3>{t("site.landing.newsfeedTitle")}</h3>
                  <p>{t("site.landing.newsfeedBody")}</p>
                </div>
              </div>
            </div>
            <p className="center mt-5">
              <Link href="/features" className="btn btn-ghost">
                {t("site.landing.exploreFeatures")}
              </Link>
            </p>
          </div>
        </section>

        <section className="section section-alt">
          <div className="container">
            <h2 className="section-title center">{t("site.landing.startedTitle")}</h2>
            <ol className="step-flow">
              <li className="step-flow-item">
                <span className="step-num" aria-hidden="true">1</span>
                <h3>{t("site.landing.step1Title")}</h3>
                <p>{t("site.landing.step1Body")}</p>
              </li>
              <li className="step-flow-item">
                <span className="step-num" aria-hidden="true">2</span>
                <h3>{t("site.landing.step2Title")}</h3>
                <p>{t("site.landing.step2Body")}</p>
              </li>
              <li className="step-flow-item">
                <span className="step-num" aria-hidden="true">3</span>
                <h3>{t("site.landing.step3Title")}</h3>
                <p>{t("site.landing.step3Body")}</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="section">
          <div className="container audience-grid">
            <div className="audience-panel audience-parents">
              <h2>{t("site.landing.parentsTitle")}</h2>
              <p className="muted">{t("site.landing.parentsBody")}</p>
              <ul className="audience-list">
                <li>{t("site.landing.parentsItem1")}</li>
                <li>{t("site.landing.parentsItem2")}</li>
                <li>{t("site.landing.parentsItem3")}</li>
                <li>{t("site.landing.parentsItem4")}</li>
              </ul>
              <Link className="btn btn-deep" href="/for-parents">
                {t("site.landing.parentsCta")}
              </Link>
            </div>
            <div className="audience-panel audience-centers">
              <h2>{t("site.landing.centersTitle")}</h2>
              <p>{t("site.landing.centersBody")}</p>
              <ul className="audience-list">
                <li>{t("site.landing.centersItem1")}</li>
                <li>{t("site.landing.centersItem2")}</li>
                <li>{t("site.landing.centersItem3")}</li>
                <li>{t("site.landing.centersItem4")}</li>
              </ul>
              <Link className="btn btn-deep" href="/for-centers">
                {t("site.landing.centersCta")}
              </Link>
            </div>
          </div>
        </section>

        <section id="demo" className="section section-cta">
          <div className="container">
            <div className="cta-band">
              <h2>{t("site.landing.ctaTitle", { brand: SITE_BRAND })}</h2>
              <p>{t("site.landing.ctaBody")}</p>
              <div className="row">
                <Link className="btn btn-deep btn-lg" href="/contact">
                  {t("site.landing.ctaBook")}
                </Link>
                <Link className="btn btn-ghost btn-lg" href="/features">
                  {t("site.landing.ctaExplore")}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
