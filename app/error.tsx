"use client";

import Link from "next/link";

// KID-2457: a transient database/connection failure during a page render must
// never reach the founder as the opaque Next.js "Application error ... Digest"
// screen. The failed render is recoverable: retrying re-runs the server
// component, and the Worker's per-request pool is fresh on the next request.
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 72 }}>
      <h1 className="title">Something went wrong</h1>
      <p className="subtitle">
        We couldn&apos;t load this page right now. Your data is safe. Check your
        connection and try again.
      </p>
      <div className="card">
        <button
          className="btn btn-primary btn-block"
          type="button"
          onClick={() => reset()}
          data-testid="app-error-retry"
        >
          Try again
        </button>
        <p className="small mt-3">
          <Link href="/">Back to home</Link>
        </p>
      </div>
    </div>
  );
}
