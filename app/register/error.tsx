"use client";

// KID-121: if anything under /register throws during render, show a friendly
// message with a retry instead of the generic "Application error" digest page.
export default function RegisterError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
      <span className="brand">Kiddy</span>
      <h1 className="title mt-4">Activate your parent account</h1>
      <p className="subtitle">
        We couldn&apos;t load the activation form right now. Check your connection and try again —
        your invite code is still valid.
      </p>
      <div className="card">
        <button className="btn btn-primary btn-block" type="button" onClick={() => reset()}>
          Try again
        </button>
        <p className="small mt-3">
          <a href="/login">Already have an account? Sign in</a>
        </p>
      </div>
    </div>
  );
}
