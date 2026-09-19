import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listMedia, listEvents, listNewsfeed } from "@/lib/store";
import { createEventAction } from "@/lib/actions";
import { firstInstituteId, cap } from "@/lib/helpers";

export const dynamic = "force-dynamic";

export default async function PortalActivitiesPage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;

  const [media, events, newsfeed] = await Promise.all([
    listMedia(instituteId),
    listEvents(instituteId, true),
    listNewsfeed(instituteId),
  ]);

  const recentMedia = (media as any[]).slice(0, 10);
  const recentPosts = (newsfeed as any[]).slice(0, 5);

  return (
    <div>
      <h1 className="title">Activities</h1>
      <p className="subtitle">
        Photos, videos, and recent activity moments captured in the center. Create a new activity below —
        full media management stays on the
        <Link href="/portal/events" className="small" style={{ fontWeight: 600, marginLeft: 4 }}>Events &amp; video</Link> page.
      </p>

      <form className="card mb-4" action={createEventAction}>
        <h3 className="subtitle">New activity</h3>
        <input type="hidden" name="returnTo" value="/portal/learning/activities" />
        <div className="row">
          <div className="col field"><label className="label">Title</label><input className="input" name="title" required placeholder="e.g. Water play morning" /></div>
          <div className="col field"><label className="label">Date</label><input className="input" name="eventDate" type="date" required /></div>
        </div>
        <div className="row">
          <div className="col field"><label className="label">Start</label><input className="input" name="startTime" type="time" /></div>
          <div className="col field"><label className="label">End</label><input className="input" name="endTime" type="time" /></div>
          <div className="col field"><label className="label">Location</label><input className="input" name="location" placeholder="e.g. Garden" /></div>
        </div>
        <div className="field"><label className="label">Description</label><textarea className="textarea" name="description" placeholder="What will the children do?" /></div>
        <button className="btn btn-primary" type="submit">Create activity</button>
      </form>

      {recentMedia.length > 0 && (
        <div className="card mb-4">
          <h3 className="subtitle">Recent media</h3>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {recentMedia.map((m: any) => (
              <div key={m.id} style={{ width: 120 }}>
                <Link href={m.url} target="_blank" rel="noreferrer">
                  {m.kind === "video" ? (
                    <div style={{ width: 120, height: 80, borderRadius: 8, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#64748b" }}>▶ Video</div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt={m.caption ?? ""} width={120} height={80} style={{ objectFit: "cover", borderRadius: 8 }} />
                  )}
                </Link>
                {m.caption && <div className="muted small mt-1" style={{ fontSize: 11 }}>{m.caption}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card mb-4">
        <h3 className="subtitle">Upcoming events</h3>
        {events.length === 0 && <p className="muted small">No upcoming events.</p>}
        {(events as any[]).slice(0, 3).map((e: any) => (
          <div className="list-item" key={e.id}>
            <div className="small">
              <span className="badge">{cap(e.event_date)}</span> {e.title}
              {e.location ? <span className="muted"> · {e.location}</span> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="subtitle">Recent newsfeed posts</h3>
        {recentPosts.length === 0 && <p className="muted small">No posts yet.</p>}
        {recentPosts.map((p: any) => (
          <div className="list-item" key={p.id}>
            <div className="small">
              <strong>{p.author_name ?? "Admin"}</strong> · {cap(p.created_at)}
              <div className="muted mt-1">{p.body?.slice(0, 120)}{p.body?.length > 120 ? "…" : ""}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}