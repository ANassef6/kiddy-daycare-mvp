import { submitContactAction } from "@/lib/actions";

export default function ContactForm() {
  return (
    <div className="card contact-card">
      <h2 className="title">Book a demo</h2>
      <p className="subtitle" style={{ marginBottom: 0 }}>
        Walk through the platform with real daycare data — or just tell us what
        you need.
      </p>
      <form className="mt-3" action={submitContactAction}>
        <div className="field">
          <label className="label" htmlFor="contact-name">
            Your name <span aria-hidden="true">*</span>
          </label>
          <input
            className="input"
            id="contact-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            placeholder="Jordan Smith"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="contact-email">
            Work email <span aria-hidden="true">*</span>
          </label>
          <input
            className="input"
            id="contact-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="jordan@daycare.ca"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="contact-phone">
            Phone <span className="small muted" aria-hidden="true">(optional)</span>
          </label>
          <input
            className="input"
            id="contact-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="555-123-4567"
          />
        </div>
        <div className="field">
          <span className="label">I&apos;m a…</span>
          <div className="row">
            <label className="choice">
              <input type="radio" name="role" value="parent" defaultChecked /> Parent
            </label>
            <label className="choice">
              <input type="radio" name="role" value="center" /> Daycare / center
            </label>
          </div>
        </div>
        <div className="field">
          <span className="label">I&apos;m interested in…</span>
          <div className="row">
            <label className="choice">
              <input type="radio" name="interest" value="demo" defaultChecked /> Book a demo
            </label>
            <label className="choice">
              <input type="radio" name="interest" value="question" /> A question
            </label>
            <label className="choice">
              <input type="radio" name="interest" value="info" /> More info
            </label>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="contact-message">
            Message <span className="small muted" aria-hidden="true">(optional)</span>
          </label>
          <textarea
            className="textarea"
            id="contact-message"
            name="message"
            rows={4}
            placeholder="Tell us about your daycare and what you'd like to see."
          />
        </div>
        <button className="btn btn-primary btn-block btn-lg" type="submit">
          Send request
        </button>
        <p className="muted small mt-2">
          We&apos;ll reply to the email address you provide. No spam, ever.
        </p>
      </form>
    </div>
  );
}