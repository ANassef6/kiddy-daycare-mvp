import { submitContactAction } from "@/lib/actions";
import { getDictionary, tr, type Locale } from "@/lib/i18n";

// KID-1826: the contact form's labels, placeholders and button copy render in
// the request's site language — the server component resolves the dictionary
// itself, so no client boundary or prop plumbing beyond the locale.
export default function ContactForm({ locale = "en" }: { locale?: Locale }) {
  const dict = getDictionary(locale);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);

  return (
    <div className="card contact-card">
      <h2 className="title">{t("site.contact.formTitle")}</h2>
      <p className="subtitle" style={{ marginBottom: 0 }}>
        {t("site.contact.formSub")}
      </p>
      <form className="mt-3" action={submitContactAction}>
        <div className="field">
          <label className="label" htmlFor="contact-name">
            {t("site.contact.nameLabel")} <span aria-hidden="true">*</span>
          </label>
          <input
            className="input"
            id="contact-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            placeholder={t("site.contact.namePlaceholder")}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="contact-email">
            {t("site.contact.emailLabel")} <span aria-hidden="true">*</span>
          </label>
          <input
            className="input"
            id="contact-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder={t("site.contact.emailPlaceholder")}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="contact-phone">
            {t("site.contact.phoneLabel")}{" "}
            <span className="small muted" aria-hidden="true">{t("site.contact.optional")}</span>
          </label>
          <input
            className="input"
            id="contact-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+20 1XX XXX XXXX"
          />
        </div>
        <input type="hidden" name="role" value="center" />
        <div className="field">
          <span className="label">{t("site.contact.interestLabel")}</span>
          <div className="row">
            <label className="choice">
              <input type="radio" name="interest" value="demo" defaultChecked /> {t("site.contact.interestDemo")}
            </label>
            <label className="choice">
              <input type="radio" name="interest" value="question" /> {t("site.contact.interestQuestion")}
            </label>
            <label className="choice">
              <input type="radio" name="interest" value="info" /> {t("site.contact.interestInfo")}
            </label>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="contact-message">
            {t("site.contact.messageLabel")}{" "}
            <span className="small muted" aria-hidden="true">{t("site.contact.optional")}</span>
          </label>
          <textarea
            className="textarea"
            id="contact-message"
            name="message"
            rows={4}
            placeholder={t("site.contact.messagePlaceholder")}
          />
        </div>
        <button className="btn btn-deep btn-block btn-lg" type="submit">
          {t("site.contact.submit")}
        </button>
        <p className="muted small mt-2">{t("site.contact.privacyNote")}</p>
      </form>
    </div>
  );
}
