import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { getBranding } from "@/lib/theme";
import ContactForm from "./ContactForm";

export const metadata = {
  title: "Book a demo — Parent childcare management software",
  description:
    "Book a personalized demo of the white-label childcare management platform, or send us your questions.",
};

export default async function ContactPage() {
  const branding = await getBranding();

  return (
    <>
      <SiteHeader active="/contact" />
      <main id="main">
        <section className="section section-head">
          <div className="container">
            <p className="hero-eyebrow">Contact &amp; demos</p>
            <h1 className="page-title">See {branding.name} up close</h1>
            <p className="subtitle">
              Book a walkthrough with your daycare&apos;s real setup, or ask us
              anything about the platform.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="container contact-grid">
            <ContactForm />
            <aside className="card contact-side" aria-label="Contact details">
              <h2 className="title" style={{ marginBottom: "var(--space-3)" }}>
                Other ways to connect
              </h2>
              <ul className="audience-list">
                <li><strong>Parents:</strong> your daycare decides if {branding.name} is a fit — ask the front desk about the parent app.</li>
                <li><strong>Centers:</strong> we work with one pilot daycare at a time and onboard every family.</li>
                <li><strong>Prefer email?</strong> Leave the form above and we&apos;ll reply within one business day.</li>
              </ul>
              <div className="row mt-3">
                <Link className="btn btn-ghost" href="/login">
                  Or try the demo now
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