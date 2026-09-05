import { requireSession } from "@/lib/require";
import { listEvents, eventMedia, listVideos } from "@/lib/store";
import { firstInstituteId, cap, fmtTime } from "@/lib/helpers";

export const dynamic = "force-dynamic";

export default async function ParentEventsPage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No daycare configured yet.</p>;

  const [events, videos] = await Promise.all([listEvents(instituteId, true), listVideos(instituteId)]);
  const withMedia = await Promise.all(
    events.map(async (e: any) => ({ ...e, media: await eventMedia(e.id) }))
  );

  return (
    <div>
      <h1 className="title">Events &amp; video</h1>
      <div className="subtitle">Daycare events and recent videos for your family.</div>

      <h3 className="subtitle">Upcoming events</h3>
      {withMedia.length === 0 && <p className="muted small mb-4">No upcoming events right now.</p>}
      <div className="grid mb-4">
        {withMedia.map((e: any) => (
          <div className="card" key={e.id}>
            <div className="badge" style={{ marginBottom: 8 }}>{cap(e.event_date)}</div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{e.title}</div>
            {e.start_time && <div className="muted small">{fmtTime(e.start_time)}{e.end_time ? ` – ${fmtTime(e.end_time)}` : ""}</div>}
            {e.location && <div className="muted small">📍 {e.location}</div>}
            {e.description && <p className="small mt-2">{e.description}</p>}
            {e.media.length > 0 && (
              <div className="row mt-2">
                {e.media.slice(0, 4).map((m: any) => (
                  <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
                    <img src={m.url} alt={m.caption ?? e.title} width={96} height={72} style={{ objectFit: "cover", borderRadius: 8 }} />
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <h3 className="subtitle">Videos</h3>
      {videos.length === 0 && <p className="muted small">No videos shared yet.</p>}
      <div className="grid">
        {videos.map((v: any) => (
          <div className="card" key={v.id}>
            <a href={v.url} target="_blank" rel="noreferrer" style={{ display: "block" }}>
              <video src={v.url} controls style={{ width: "100%", borderRadius: 8, maxHeight: 180, objectFit: "cover" }} />
            </a>
            {v.caption && <p className="small mt-2">{v.caption}</p>}
            {v.first_name && <div className="muted small">{v.first_name} {v.last_name}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}