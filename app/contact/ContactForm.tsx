"use client";

import { useFormState } from "react-dom";
import { submitContactAction } from "@/lib/actions";

const initialState = { ok: false, error: null as string | null };

export default function ContactForm() {
  const [state, formAction] = useFormState(submitContactAction, initialState);

  if (state.ok) {
    return (
      <div className="card contact-card" role="status" aria-live="polite">
        <h2 className="title">Thanks — we&apos;re on it!</h2>
        <p className="muted">
          Your request was received. Someone from the team will be in touch to
          book your demo or answer your question.
        </p>
        <p className="small mt-3 muted">
          In the meantime, you can explore the seeded demo environment.
        </p>
        <a className="btn btn-primary mt-3" href="/login">
          Try the demo
        </a>
      </div>
    );
  }

  return (
    <div className="card contact-card">
      <h2 className="title">Book a demo</h2>
      <p className="subtitle" style={{ marginBottom: 0 }}>
        Walk through the platform with real daycare data — or just tell us what
        you need.
      </p>
      {state.error ? (
        <p className="form-error" role="alert" aria-live="polite">
          {state.error}
        </p>
      ) : null}
      <form className="mt-3" action={formAction}>
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