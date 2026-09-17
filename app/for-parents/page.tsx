import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { SITE_BRAND } from "@/lib/site";

export const metadata = {
  title: "For parents — see your child's day",
  description:
    "Live check-in, daily reports, newsfeed, and messaging — your child's day at daycare, in your pocket.",
};

const BENEFITS: { title: string; body: string }[] = [
  {
    title: "Live check-in & check-out",
    body: "Know the moment your child arrives and leaves — no more wondering or phone calls to the office.",
  },
  {
    title: "Daily reports",
    body: "Meals, naps, mood, and a note from the team, posted every single day.",
  },
  {
    title: "The newsfeed",
    body: "Photos, announcements, and moments from the classroom that you can like and comment on.",
  },
  {
    title: "Messaging",
    body: "Private messages with your daycare's staff, right where the day's updates live.",
  },
  {
    title: "Media gallery",
    body: "A personal photo and video gallery for your child — download and keep everything.",
  },
  {
    title: "Consents & incidents",
    body: "Approve consent requests and acknowledge incident reports with a tap. Transparent and respectful.",
  },
];

export default function ForParentsPage() {
  return (
    <>
      <SiteHeader active="/for-parents" />
      <main id="main">
        <section className="section section-head">
          <div className="container">
            <p className="hero-eyebrow">For parents</p>
            <h1 className="page-title">Your child&apos;s day, in your pocket</h1>
            <p className="subtitle">
              From the morning check-in to the evening report — everything you want
              to know, without having to ask.
            </p>
            <p className="muted mt-3" style={{ maxWidth: 620 }}>
              {SITE_BRAND} is set up by your daycare, and your daycare invites you.
              You don&apos;t create an account yourself — once your daycare adds your
              child, they&apos;ll send you an invite and you&apos;ll sign in with the
              credentials they give you.
            </p>
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
            <h2 className="title center">A quiet, pressure-free way to stay close</h2>
            <p className="subtitle center" style={{ maxWidth: 640, marginInline: "auto" }}>
              No new group chats, no chasing the office at pickup. Just a calm,
              private feed of your child&apos;s real day from the people who spend it
              with them.
            </p>
            <p className="center muted mt-3" style={{ maxWidth: 640, marginInline: "auto" }}>
              Want your daycare to use {SITE_BRAND}? Ask the front desk to get in
              touch with us — we work with daycares directly.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
