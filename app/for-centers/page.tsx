import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { getBranding } from "@/lib/theme";

export const metadata = {
  title: "For centers — run the day from one place",
  description:
    "Attendance, daily care, newsfeed, messaging, and white-label branding — childcare management software for Canadian daycares.",
};

const BENEFITS: { title: string; body: string }[] = [
  {
    title: "Rooms, staff & children",
    body: "Set up rooms, roles, and child records in minutes. Everything the day needs, in one place.",
  },
  {
    title: "Staff check-in & attendance",
    body: "Staff tap children in and out; you see today's attendance live and can correct a mis-tap.",
  },
  {
    title: "Daily care reporting",
    body: "Post meals, sleep, mood, and a note per child — families see it the moment it's posted.",
  },
  {
    title: "Newsfeed & media",
    body: "Share photos and announcements with the families who care. Boost trust and cut last-minute calls.",
  },
  {
    title: "Messaging & notifications",
    body: "Private parent–staff messages plus in-app notifications for status changes.",
  },
  {
    title: "White-label branding",
    body: "Your name, your logo, your colors — on every page and app surface. Branding is a config change, not code.",
  },
  {
    title: "Consents & incidents",
    body: "Send consent requests and log incident reports with parent acknowledgement — built-in and auditable.",
  },
  {
    title: "Simple onboarding",
    body: "Enroll a child and invite the family in under five minutes. No training marathon required.",
  },
];

export default async function ForCentersPage() {
  const branding = await getBranding();
  return (
    <>
      <SiteHeader active="/for-centers" />
      <main id="main">
        <section className="section section-head">
          <div className="container">
            <p className="hero-eyebrow">For centers</p>
            <h1 className="page-title">Run the day from one place</h1>
            <p className="subtitle">
              Attendance, daily care, the newsfeed, and your families' trust — in a
              clean portal that reflects your own branding.
            </p>
            <div className="row mt-3">
              <Link className="btn btn-primary btn-lg" href="/contact">
                Book a demo
              </Link>
              <Link className="btn btn-ghost btn-lg" href="/login">
                Open the staff portal
              </Link>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container grid">
            {BENEFITS.map((b) => (
              <div className="card feature-card" key={b.title}>
                <h3 className="mt-2">{b.title}</h3>
                <p className="muted small mt-1">{b.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section section-alt">
          <div className="container">
            <h2 className="title center">Less admin, more time with children</h2>
            <p className="subtitle center" style={{ maxWidth: 640, marginInline: "auto" }}>
              A childcare management platform should take work off your plate, not
              add to it. See how {branding.name}{" "}
              keeps the operation calm and parents informed.
            </p>
            <p className="center mt-3">
              <Link className="btn btn-accent btn-lg" href="/contact">
                Get a personalized demo
              </Link>
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}