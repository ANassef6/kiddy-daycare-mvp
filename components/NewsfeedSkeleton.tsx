// KID-472: shared newsfeed loading skeleton. Pure markup, no session/i18n
// work, so it renders the instant navigation starts while the RSC response
// streams in — the tap is acknowledged immediately with an accessible busy
// state instead of the old silent window.
export function NewsfeedSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" aria-label="Loading newsfeed">
      <style>{`@keyframes kiddy-pulse{0%{opacity:.55}50%{opacity:1}100%{opacity:.55}}.kiddy-skel{animation:kiddy-pulse 1.2s ease-in-out infinite;background:var(--color-border);border-radius:8px}`}</style>
      <div className="kiddy-skel" style={{ width: 140, height: 18, marginTop: 12 }} />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="card mt-3"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
          aria-hidden="true"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="kiddy-skel" style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div className="kiddy-skel" style={{ width: "40%", minWidth: 110, height: 13 }} />
              <div className="kiddy-skel" style={{ width: "25%", minWidth: 70, height: 11, marginTop: 6 }} />
            </div>
          </div>
          <div className="kiddy-skel" style={{ width: "100%", height: 13 }} />
          <div className="kiddy-skel" style={{ width: "88%", height: 13 }} />
          <div className="kiddy-skel" style={{ width: "55%", height: 13 }} />
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            <div className="kiddy-skel" style={{ width: 64, height: 22, borderRadius: 999 }} />
            <div className="kiddy-skel" style={{ width: 96, height: 22, borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
