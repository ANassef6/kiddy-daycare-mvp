import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const metadata = {
  title: "Features — Parent childcare management software",
  description:
    "Check-in/out, daily reports, newsfeed, messaging, photos, consents, and incident reports — one simple platform for daycares and parents.",
};

const FEATURES: { title: string; body: string }[] = [
  {
    title: "Check-in & check-out",
    body: "Staff and parents tap children in and out in seconds. Real timestamps and live status on every child profile.",
  },
  {
    title: "Attendance & schedules",
    body: "View today's attendance at a glance, plan expected times, and edit a mis-tap with a clear audit trail.",
  },
  {
    title: "Daily reports",
    body: "Meals, sleep, mood, diaper/toilet, a sick flag, and a note from the team — posted every day, seen instantly.",
  },
  {
    title: "Newsfeed",
    body: "Classroom announcements, photos, and updates. Parents like and comment; posts can be tagged to a child.",
  },
  {
    title: "Media gallery",
    body: "A photo and video gallery per child, so families never miss the little moments of the day.",
  },
  {
    title: "Messaging & notifications",
    body: "Direct, private messages between parents and staff, with in-app notifications for status changes.",
  },
  {
    title: "Child records & health",
    body: "Allergies, conditions, health notes, pickup information, and emergency contacts — reliable and private.",
  },
  {
    title: "Consents & approvals",
    body: "Staff send consent requests; parents approve or deny right in the app. No chasing paper.",
  },
  {
    title: "Incident reports",
    body: "Clear, respectful incident and accident reports with parent acknowledgement — built on trust.",
  },
  {
    title: "Rooms, staff & scheduling",
    body: "Set up rooms, staff roles, and room access, then run the day from one staff portal.",
  },
  {
    title: "White-label branding",
    body: "Your daycare's name, logo, and colors across every surface. Swapping branding is a config change, not a code change.",
  },
  {
    title: "Parent onboarding",
    body: "Invites and account linking make it easy for families to connect in under five minutes.",
  },
];

export default function FeaturesPage() {
  return (
    <>
      <SiteHeader active="/features" />
      <main id="main">
        <section className="section section-head">
          <div className="container">
            <p className="hero-eyebrow">Feature overview</p>
            <h1 className="page-title">Everything a childcare day needs</h1>
            <p className="subtitle">
              One platform for the daily loop — from check-in to the evening
              report — for staff, centers, and parents.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="container grid">
            {FEATURES.map((f) => (
              <div className="card feature-card" key={f.title}>
                <h3 className="mt-2">{f.title}</h3>
                <p className="muted small mt-1">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section section-cta">
          <div className="container">
            <div className="card cta-card">
              <h2 className="title">See it with your own daycare&apos;s data</h2>
              <p className="subtitle" style={{ marginBottom: 0 }}>
                Book a demo, or spin up the seeded demo environment today.
              </p>
              <div className="row mt-3">
                <Link className="btn btn-primary btn-lg" href="/contact">
                  Book a demo
                </Link>
                <Link className="btn btn-ghost btn-lg" href="/login">
                  Try the demo
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