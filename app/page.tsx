import Link from "next/link";
import { getFirstInstitute, getInstitute } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default function LandingPage() {
  const institute = getFirstInstitute();
  const brand = institute?.name ?? "Kiddy";

  return (
    <div>
      <header style={{ padding: "16px 0", borderBottom: "1px solid var(--color-border)" }}>
        <div className="container row" style={{ justifyContent: "space-between" }}>
          <span className="brand">{brand}</span>
          <nav className="nav">
            <Link href="/login">Parent sign in</Link>
            <a className="btn btn-primary" href="#demo">Book a demo</a>
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="container">
          <h1>Parent — childcare management software, built for Canadian daycares.</h1>
          <p>
            Check-in, check-out, daily reports, and the newsfeed — in one simple app.{" "}
            Your child&apos;s day, in your pocket.
          </p>
          <div className="row mt-4">
            <a className="btn btn-accent" href="#demo">See your child&apos;s day</a>
            <Link className="btn btn-ghost" style={{ background: "#fff", color: "var(--brand-primary)" }} href="/register">
              I&apos;m a parent — get my invite
            </Link>
          </div>
        </div>
      </section>

      <section className="container mt-5">
        <h2 className="title">How it works</h2>
        <div className="grid">
          <div className="card">
            <div className="badge">1</div>
            <h3 className="mt-2">Setup</h3>
            <p className="muted small mt-1">Staff set up rooms, staff, and your child&apos;s profile.</p>
          </div>
          <div className="card">
            <div className="badge">2</div>
            <h3 className="mt-2">The day</h3>
            <p className="muted small mt-1">Staff check your child in and out, and post a daily report.</p>
          </div>
          <div className="card">
            <div className="badge">3</div>
            <h3 className="mt-2">Stay informed</h3>
            <p className="muted small mt-1">You see live status, read the report, and follow the newsfeed from anywhere.</p>
          </div>
        </div>
      </section>

      <section className="container mt-5">
        <div className="row" style={{ justifyContent: "space-around" }}>
          <span className="muted small">Loved by before-&amp;-after-school programs</span>
          <span className="muted small">Real check-in/out records</span>
          <span className="muted small">Daily reports parents actually read</span>
        </div>
      </section>

      <section id="demo" className="container mt-6 mb-4">
        <div className="card">
          <h2 className="title">Book a demo</h2>
          <p className="subtitle">
            This is a demo environment. Use the sign-in links below to explore the{" "}
            <strong>staff portal</strong> and the <strong>parent app</strong> with seeded data.
          </p>
          <div className="row">
            <Link className="btn btn-primary" href="/login">Go to sign in</Link>
          </div>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid var(--color-border)", padding: "24px 0" }} className="mt-4">
        <div className="container muted small">
          © {new Date().getFullYear()} {brand}. White-label childcare management platform.
        </div>
      </footer>
    </div>
  );
}
