import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SiteReveal from "@/components/SiteReveal";
import { SITE_BRAND, PLATFORM_CONTACT_EMAIL } from "@/lib/site";
import ContactForm from "./ContactForm";
import { siteContext } from "@/lib/site-i18n";

// KID-1826: every rendered string is localized (site.contact.*).
// KID-2077: data-reveal / data-reveal-stagger drive the once-per-load scroll
// reveal (<SiteReveal />); the contact cards also lift on hover/:focus-visible.
export async function generateMetadata() {
  const { t } = await siteContext();
  return {
    title: t("site.meta.contactTitle", { brand: SITE_BRAND }),
    description: t("site.meta.contactDesc"),
  };
}

export default async function ContactPage(
  props: {
    searchParams?: Promise<{ sent?: string; error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const { locale, t, brandImage, brandName } = await siteContext();
  const errorMessage =
    searchParams?.error === "name"
      ? t("site.contact.errName")
      : searchParams?.error === "email"
        ? t("site.contact.errEmail")
        : searchParams?.error === "long"
          ? t("site.contact.errLong")
          : searchParams?.error === "server"
            ? t("site.contact.errServer")
            : null;

  return (
    <>
      <SiteHeader active="/contact" locale={locale} brandImage={brandImage} brandName={brandName} />
      <main id="main">
        <section className="section section-head">
          <div className="container" data-reveal>
            <p className="hero-eyebrow">{t("site.contact.eyebrow")}</p>
            <h1 className="page-title">{t("site.contact.title", { brand: SITE_BRAND })}</h1>
            <p className="subtitle">{t("site.contact.subtitle")}</p>
          </div>
        </section>

        <section className="section">
          <div className="container contact-grid" data-reveal-stagger>
            {searchParams?.sent ? (
              <div className="card contact-card" role="status" aria-live="polite">
                <h2 className="title">{t("site.contact.sentTitle")}</h2>
                <p className="muted">{t("site.contact.sentBody")}</p>
                <p className="small mt-3 muted">{t("site.contact.sentNote")}</p>
                <Link className="btn btn-deep mt-3" href="/for-parents">
                  {t("site.contact.sentCta")}
                </Link>
              </div>
            ) : (
              <>
                {errorMessage ? (
                  <p className="form-error" role="alert" aria-live="polite">
                    {errorMessage}
                  </p>
                ) : null}
                <ContactForm locale={locale} />
              </>
            )}
            <aside className="card contact-side" aria-label={t("site.contact.sideAria")}>
              <h2 className="title" style={{ marginBottom: "var(--space-3)" }}>
                {t("site.contact.sideTitle")}
              </h2>
              <ul className="audience-list">
                <li>
                  <strong>{t("site.contact.sideCentersLabel")}</strong>{" "}
                  {t("site.contact.sideCentersBody")}
                </li>
                <li>
                  <strong>{t("site.contact.sideParentsLabel")}</strong>{" "}
                  {t("site.contact.sideParentsBody", { brand: SITE_BRAND })}
                </li>
                <li>
                  <strong>{t("site.contact.sideEmailLabel")}</strong>{" "}
                  {t("site.contact.sideEmailBody", { email: PLATFORM_CONTACT_EMAIL })}
                </li>
              </ul>
              <div className="row mt-3">
                <a className="btn btn-deep" href={`mailto:${PLATFORM_CONTACT_EMAIL}`}>
                  {t("site.contact.sideEmailBtn", { email: PLATFORM_CONTACT_EMAIL })}
                </a>
                <Link className="btn btn-ghost" href="/for-centers">
                  {t("site.contact.sideMore")}
                </Link>
              </div>
            </aside>
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} />
      <SiteReveal />
    </>
  );
}
