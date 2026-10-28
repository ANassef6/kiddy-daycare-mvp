// KID-254: the child detail route was the heaviest parent surface (layout +
// ~10 queries through store.ts) and the ONLY /child route without a loading
// boundary. With no boundary, Next.js prefetches an empty skeleton for the
// dynamic route and the tap navigation stays completely silent — URL and
// screen unchanged — until the whole RSC round trip finishes (1.7-2.3s on the
// warm production server, far worse on a cold lambda or Android cellular; an
// interrupted fetch dies with no feedback at all). That silent window is the
// parent-reported "tapping the child's name does nothing" on Android.
//
// A loading boundary flips the navigation into an instantly-acknowledged
// state: the URL updates and this skeleton renders the moment the card is
// tapped, while the child's data streams in. Static on purpose — it renders
// before any session/tenant/i18n work happens, on every host.
export default function ChildDetailLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <style>{`@keyframes kiddy-pulse{0%{opacity:.55}50%{opacity:1}100%{opacity:.55}}.kiddy-skel{animation:kiddy-pulse 1.2s ease-in-out infinite;background:var(--color-border);border-radius:8px}`}</style>
      <div className="muted small" style={{ width: 96, height: 14, marginTop: 12 }} />
      <div className="card mt-3">
        <div className="status-card">
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            <div className="kiddy-skel" style={{ width: 56, height: 56, borderRadius: "50%", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 120 }}>
              <div className="kiddy-skel" style={{ width: "70%", minWidth: 140, height: 22 }} />
              <div className="kiddy-skel" style={{ width: "45%", minWidth: 100, height: 13, marginTop: 8 }} />
            </div>
          </div>
          <div className="kiddy-skel" style={{ width: 92, height: 24, borderRadius: 999, flexShrink: 0 }} />
        </div>
        <div className="kiddy-skel mt-4" style={{ width: "100%", height: 40 }} />
      </div>
      <div className="card mt-3" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="kiddy-skel" style={{ width: "100%", height: 14 }} />
        <div className="kiddy-skel" style={{ width: "100%", height: 14 }} />
        <div className="kiddy-skel" style={{ width: "60%", height: 14 }} />
      </div>
    </div>
  );
}
