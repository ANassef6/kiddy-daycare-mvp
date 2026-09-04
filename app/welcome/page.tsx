import Link from "next/link";
import { requireSession } from "@/lib/require";
import { redirect } from "next/navigation";
import ResendConfirmButton from "@/components/resend-confirm";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const session = requireSession();
  if (session.emailConfirmed) {
    redirect(session.role === "parent" ? "/child" : "/portal/dashboard");
  }
  const home = session.role === "parent" ? "/child" : "/portal/dashboard";

  return (
    <div className="container" style={{ maxWidth: 520, paddingTop: 80 }}>
      <span className="brand">Kiddy</span>
      <div className="card mt-4">
        <h1 className="title">Confirm your email</h1>
        <p className="subtitle">
          Almost there! We sent a confirmation link to <strong>{session.email}</strong>.
          Click it to enable password sign-in to your account.
        </p>
        <div className="card" style={{ background: "var(--color-surface-alt, #f9fafb)", marginTop: 16 }}>
          <p className="small muted" style={{ margin: 0 }}>
            <strong>Your session is already active</strong> — you can start using the app now. Confirming the email
            only unlocks Supabase password sign-in. If the confirmation email didn&apos;t arrive, the provider may be
            rate-limiting sends right now; you can resend it or just keep using the app.
          </p>
        </div>
        <div className="row mt-4" style={{ gap: 8, flexWrap: "wrap" }}>
          <ResendConfirmButton />
          <Link className="btn btn-primary" href={home}>
            Continue to the app →
          </Link>
        </div>
      </div>
      <p className="small mt-3">
        <a href="/api/logout">Not {session.email}? Sign out</a>
      </p>
    </div>
  );
}