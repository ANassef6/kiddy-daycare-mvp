// KID-534 (KID-482 D-2): recoverable state for a parent messages render whose
// data reads partially failed on the server. Before this existed, one
// transient read error (connection-pool pressure on the shared Supabase
// pooler under concurrent traffic) threw inside the server component and
// surfaced as "Application error … Digest" — a dead page with no affordance.
// A pure server-rendered panel (an anchor retry works without JavaScript)
// keeps the failure bounded and the recovery visible, in the same "say so
// instead of a silent crash" style as the ?error= send banner (KID-169).
export default function MessagesLoadError({
  title,
  hint,
  action,
  retryHref,
}: {
  title: string;
  hint: string;
  action: string;
  retryHref: string;
}) {
  return (
    <div className="card mb-4" role="alert" data-testid="messages-load-error">
      <h4 className="subtitle">{title}</h4>
      <p className="muted small">{hint}</p>
      <a className="btn btn-primary" href={retryHref} data-testid="messages-retry">
        {action}
      </a>
    </div>
  );
}
