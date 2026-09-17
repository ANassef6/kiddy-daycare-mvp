import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { SITE_BRAND } from "@/lib/site";
import ContactForm from "./ContactForm";

export const metadata = {
  title: `Book a demo — ${SITE_BRAND} childcare management software`,
  description:
    "Book a personalized demo of the white-label childcare management platform, or send us your questions.",
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams?: { sent?: string; error?: string };
}) {
  const errorMessage =
    searchParams?.error === "name"
      ? "Please add your name."
      : searchParams?.error === "email"
        ? "Please add a valid email address."
        : searchParams?.error === "long"
          ? "Your message is too long (max 2,000 characters)."
          : searchParams?.error === "server"
            ? "Something went wrong saving your request. Please try again."
            : null;

  return (
    <>
      <SiteHeader active="/contact" />
      <main id="main">
        <section className="section section-head">
          <div className="container">
            <p className="hero-eyebrow">Contact &amp; demos</p>
            <h1 className="page-title">See {SITE_BRAND} up close</h1>
            <p className="subtitle">
              Book a walkthrough with your daycare&apos;s real setup, or ask us
              anything about the platform. We work with daycares directly.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="container contact-grid">
            {searchParams?.sent ? (
              <div className="card contact-card" role="status" aria-live="polite">
                <h2 className="title">Thanks — we&apos;re on it!</h2>
                <p className="muted">
                  Your request was received. Someone from the team will be in
                  touch to book your demo or answer your question.
                </p>
                <p className="small mt-3 muted">
                  We work with daycares directly. If you&apos;re a parent, ask your
                  daycare&apos;s front desk to get in touch with us.
                </p>
                <Link className="btn btn-primary mt-3" href="/for-parents">
                  Information for parents
                </Link>
              </div>
            ) : (
              <>
                {errorMessage ? (
                  <p className="form-error" role="alert" aria-live="polite">
                    {errorMessage}
                  </p>
                ) : null}
                <ContactForm />
              </>
            )}
            <aside className="card contact-side" aria-label="Contact details">
              <h2 className="title" style={{ marginBottom: "var(--space-3)" }}>
                Other ways to connect
              </h2>
              <ul className="audience-list">
                <li><strong>Centers:</strong> book a demo below — we onboard each daycare directly.</li>
                <li><strong>Parents:</strong> your daycare invites you to {SITE_BRAND}; ask the front desk to get in touch with us.</li>
                <li><strong>Prefer email?</strong> Leave the form above and we&apos;ll reply within one business day.</li>
              </ul>
              <div className="row mt-3">
                <Link className="btn btn-ghost" href="/for-centers">
                  More for centers
                </Link>
              </div>
            </aside>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}