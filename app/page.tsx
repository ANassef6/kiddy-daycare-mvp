import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { SITE_BRAND } from "@/lib/site";

export const metadata = {
  title: `${SITE_BRAND} — childcare management software for Egyptian daycares`,
  description:
    "Check-in, check-out, daily reports, and the newsfeed — in one simple app. Your daycare's day, in one place.",
};

export default function HomePage() {
  return (
    <>
      <SiteHeader active="/" />
      <main id="main">
        <section className="hero">
          <div className="container">
            <p className="hero-eyebrow">Childcare management software</p>
            <h1>{SITE_BRAND} — childcare management software for Egyptian daycares.</h1>
            <p className="hero-sub">
              Check-in, check-out, daily reports, and the newsfeed — in one simple
              app for your daycare and the families it serves.
            </p>
            <div className="row mt-4">
              <Link className="btn btn-accent btn-lg" href="/contact">
                Book a daycare demo
              </Link>
              <Link className="btn btn-ghost btn-lg hero-ghost" href="/for-parents">
                I&apos;m a parent
              </Link>
            </div>
          </div>
        </section>

        <section className="proof-strip" aria-label="Trusted by daycare programs">
          <div className="container row" style={{ justifyContent: "space-around" }}>
            <span className="muted small">Built for daycare operations</span>
            <span className="muted small">Real check-in/out records</span>
            <span className="muted small">Daily reports parents actually read</span>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <h2 className="title center">One app for the whole day</h2>
            <p className="subtitle center">
              Everything a daycare runs on and a parent wants to know — without the
              paper trails and phone calls.
            </p>
            <div className="grid">
              <div className="card feature-card">
                <div className="badge">01</div>
                <h3>Check-in &amp; out</h3>
                <p className="muted small">
                  Staff tap children in and out; parents see live status the second
                  it happens.
                </p>
              </div>
              <div className="card feature-card">
                <div className="badge">02</div>
                <h3>Daily reports</h3>
                <p className="muted small">
                  Meals, sleep, mood, diaper, and a note from the team — every single
                  day.
                </p>
              </div>
              <div className="card feature-card">
                <div className="badge">03</div>
                <h3>Newsfeed</h3>
                <p className="muted small">
                  Photos, announcements, and today&apos;s moments from the classroom.
                </p>
              </div>
            </div>
            <p className="center mt-4">
              <Link href="/features" className="btn btn-ghost">
                Explore all features
              </Link>
            </p>
          </div>
        </section>

        <section className="section section-alt">
          <div className="container">
            <h2 className="title center">How it works</h2>
            <div className="grid">
              <div className="card step-card">
                <div className="badge badge-green">1 · Setup</div>
                <p className="muted small mt-2">
                  Your daycare sets up rooms, staff, profiles, and each child&apos;s
                  daily rhythm. Parents are invited by the daycare.
                </p>
              </div>
              <div className="card step-card">
                <div className="badge badge-green">2 · The day</div>
                <p className="muted small mt-2">
                  Staff check children in and out, and post a daily report.
                </p>
              </div>
              <div className="card step-card">
                <div className="badge badge-green">3 · Stay informed</div>
                <p className="muted small mt-2">
                  Parents see live status, read the report, and follow the newsfeed
                  from anywhere.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="grid">
              <div className="card audience-card">
                <h2 className="title">For parents</h2>
                <p className="muted">
                  Your child&apos;s day, without the guesswork. See exactly when they
                  checked in, what they ate, how they slept, and what they learned.
                  Your daycare invites you to the app.
                </p>
                <ul className="audience-list">
                  <li>Live check-in &amp; check-out status</li>
                  <li>Daily reports from the classroom</li>
                  <li>Newsfeed photos &amp; updates</li>
                  <li>Direct messaging with staff</li>
                </ul>
                <Link className="btn btn-primary" href="/for-parents">
                  Learn more for parents
                </Link>
              </div>
              <div className="card audience-card">
                <h2 className="title">For centers</h2>
                <p className="muted">
                  Run the daily operation from one place — attendance, daily care,
                  newsfeed, and staff — and keep every family in the loop.
                </p>
                <ul className="audience-list">
                  <li>Rooms, staff &amp; child records in one place</li>
                  <li>Staff check-in/out and attendance</li>
                  <li>Newsfeed, messaging &amp; media gallery</li>
                  <li>Your brand, your colors — white-label</li>
                </ul>
                <Link className="btn btn-primary" href="/for-centers">
                  Learn more for centers
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="demo" className="section section-cta">
          <div className="container">
            <div className="card cta-card">
              <h2 className="title">See {SITE_BRAND} in action</h2>
              <p className="subtitle" style={{ marginBottom: 0 }}>
                We work with daycares directly. Book a walkthrough for your center
                and we&apos;ll set it up with your real data.
              </p>
              <div className="row mt-3">
                <Link className="btn btn-primary btn-lg" href="/contact">
                  Book a demo
                </Link>
                <Link className="btn btn-ghost btn-lg" href="/features">
                  Explore features
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
