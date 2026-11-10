import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { SITE_BRAND } from "@/lib/site";

export const metadata = {
  title: `${SITE_BRAND} — childcare management software for Egyptian daycares`,
  description:
    "Check-in, check-out, daily reports, and the newsfeed — in one simple app. Your daycare's day, in one place.",
};

// KID-1632 rebrand — "the center's day". The landing shows the product's own
// world instead of selling at it: a live day panel in the hero, a timeline
// band anchoring the app to the real rhythm of a center, feature rows tied to
// the moment of the day when each thing happens, and a genuine numbered
// sequence only where the content really is one (getting started).
export default function HomePage() {
  return (
    <>
      <SiteHeader active="/" />
      <main id="main">
        <section className="hero">
          <div className="container hero-grid">
            <div className="hero-copy">
              <h1>One app for the whole daycare day.</h1>
              <p className="hero-sub">
                Check-in, check-out, daily reports, and the newsfeed — built for
                Egyptian daycares and the families they serve.
              </p>
              <div className="row mt-4">
                <Link className="btn btn-deep btn-lg" href="/contact">
                  Book a daycare demo
                </Link>
                <Link className="btn btn-ghost btn-lg" href="/for-parents">
                  I&apos;m a parent
                </Link>
              </div>
            </div>

            <aside className="day-panel" aria-label="A sample day on Kiddy">
              <div className="day-panel-head">
                <h2>Today at your center</h2>
                <p className="muted small">One view shared by staff and parents.</p>
              </div>
              <ul className="day-list">
                <li className="day-row">
                  <span className="day-name">Amira</span>
                  <span className="day-detail">Arrived 7:58</span>
                  <span className="status-chip">Checked in</span>
                </li>
                <li className="day-row">
                  <span className="day-name">Omar</span>
                  <span className="day-detail">Arrived 8:12</span>
                  <span className="status-chip">Checked in</span>
                </li>
                <li className="day-row day-row-report">
                  <div className="day-report-head">
                    <span className="day-name">Noon report: Amira</span>
                    <span className="status-chip status-chip-mood">Cheerful</span>
                  </div>
                  <div className="day-report-chips">
                    <span className="status-chip status-chip-diaper">Lunch: all of it</span>
                    <span className="status-chip status-chip-sleep">Nap: 1h 20m</span>
                  </div>
                  <p className="day-report-note small">
                    Slept well after lunch, played in the garden, very cheerful
                    at pickup.
                  </p>
                </li>
              </ul>
              <p className="day-panel-foot muted small">
                Parents see each of these the moment it happens.
              </p>
            </aside>
          </div>
        </section>

        <section className="day-band" aria-label="How Kiddy follows the daycare day">
          <div className="container day-band-grid">
            <div className="day-band-item">
              <span className="day-band-time">07:30</span>
              <p>Doors open. Staff check children in, and parents see arrival as it happens.</p>
            </div>
            <div className="day-band-item">
              <span className="day-band-time">12:30</span>
              <p>The daily report goes out: meals, sleep, mood, and a note from the team.</p>
            </div>
            <div className="day-band-item">
              <span className="day-band-time">15:00</span>
              <p>Home time. Pickups are logged live, and the day lands in the newsfeed.</p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <h2 className="section-title center">What runs through the app</h2>
            <p className="subtitle center">
              Everything a daycare runs on and a parent wants to know — without
              the paper trails and phone calls.
            </p>
            <div className="feature-rows">
              <div className="feature-row">
                <span className="feature-moment">Morning</span>
                <div>
                  <h3>Check-in &amp; out</h3>
                  <p>
                    Staff tap children in and out; parents see live status the
                    second it happens.
                  </p>
                </div>
              </div>
              <div className="feature-row">
                <span className="feature-moment">Midday</span>
                <div>
                  <h3>Daily reports</h3>
                  <p>
                    Meals, sleep, mood, diaper, and a note from the team — every
                    single day.
                  </p>
                </div>
              </div>
              <div className="feature-row">
                <span className="feature-moment">All day</span>
                <div>
                  <h3>Newsfeed</h3>
                  <p>
                    Photos, announcements, and today&apos;s moments from the
                    classroom.
                  </p>
                </div>
              </div>
            </div>
            <p className="center mt-5">
              <Link href="/features" className="btn btn-ghost">
                Explore all features
              </Link>
            </p>
          </div>
        </section>

        <section className="section section-alt">
          <div className="container">
            <h2 className="section-title center">How a center gets started</h2>
            <ol className="step-flow">
              <li className="step-flow-item">
                <span className="step-num" aria-hidden="true">1</span>
                <h3>Set up your center</h3>
                <p>
                  Rooms, staff, profiles, and each child&apos;s daily rhythm.
                  Parents are invited by the daycare.
                </p>
              </li>
              <li className="step-flow-item">
                <span className="step-num" aria-hidden="true">2</span>
                <h3>The day runs on it</h3>
                <p>
                  Staff check children in and out, and post a daily report
                  before home time.
                </p>
              </li>
              <li className="step-flow-item">
                <span className="step-num" aria-hidden="true">3</span>
                <h3>Families stay close</h3>
                <p>
                  Parents see live status, read the report, and follow the
                  newsfeed from anywhere.
                </p>
              </li>
            </ol>
          </div>
        </section>

        <section className="section">
          <div className="container audience-grid">
            <div className="audience-panel audience-parents">
              <h2>For parents</h2>
              <p className="muted">
                Your child&apos;s day, without the guesswork. See exactly when
                they checked in, what they ate, how they slept, and what they
                learned. Your daycare invites you to the app.
              </p>
              <ul className="audience-list">
                <li>Live check-in &amp; check-out status</li>
                <li>Daily reports from the classroom</li>
                <li>Newsfeed photos &amp; updates</li>
                <li>Direct messaging with staff</li>
              </ul>
              <Link className="btn btn-deep" href="/for-parents">
                Learn more for parents
              </Link>
            </div>
            <div className="audience-panel audience-centers">
              <h2>For centers</h2>
              <p>
                Run the daily operation from one place — attendance, daily care,
                newsfeed, and staff — and keep every family in the loop.
              </p>
              <ul className="audience-list">
                <li>Rooms, staff &amp; child records in one place</li>
                <li>Staff check-in/out and attendance</li>
                <li>Newsfeed, messaging &amp; media gallery</li>
                <li>Your brand, your colors — white-label</li>
              </ul>
              <Link className="btn btn-deep" href="/for-centers">
                Learn more for centers
              </Link>
            </div>
          </div>
        </section>

        <section id="demo" className="section section-cta">
          <div className="container">
            <div className="cta-band">
              <h2>See {SITE_BRAND} in action</h2>
              <p>
                We work with daycares directly. Book a walkthrough for your
                center and we&apos;ll set it up with your real data.
              </p>
              <div className="row">
                <Link className="btn btn-deep btn-lg" href="/contact">
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
