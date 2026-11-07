"use client";

// KID-534 (KID-482 D-2): anything under /child/messages that still throws
// during render (session/tenant gate reads happen before the page's own
// guarded reads) must land on this segment-level boundary — a recoverable
// page with a retry — instead of the unhandled "Application error" digest
// view. Same pattern as app/register/error.tsx (KID-121).
export default function ParentMessagesError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 60 }}>
      <h1 className="title">Messages</h1>
      <p className="subtitle">
        We couldn&apos;t load your messages right now. Your messages are safe. Check your
        connection and try again.
      </p>
      <div className="card">
        <button className="btn btn-primary btn-block" type="button" onClick={() => reset()} data-testid="messages-boundary-retry">
          Try again
        </button>
        <p className="small mt-3">
          <a href="/child">Back to your children</a>
        </p>
      </div>
    </div>
  );
}
