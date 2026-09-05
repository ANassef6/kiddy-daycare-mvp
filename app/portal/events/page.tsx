import { requireSession } from "@/lib/require";
import { listEvents, eventMedia } from "@/lib/store";
import { firstInstituteId, cap, fmtTime } from "@/lib/helpers";
import { createEventAction, addEventMediaAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PortalEventsPage({ searchParams }: { searchParams: { open?: string } }) {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const events = await listEvents(instituteId);
  const withMedia = await Promise.all(events.map(async (e: any) => ({ ...e, media: await eventMedia(e.id) })));
  const openId = searchParams.open;

  return (
    <div>
      <h1 className="title">Events &amp; video</h1>

      <div className="card mb-4">
        <h3 className="subtitle">Add an event</h3>
        <form action={createEventAction}>
          <div className="row">
            <div className="col field"><label className="label">Title</label><input className="input" name="title" required /></div>
            <div className="col field"><label className="label">Date</label><input className="input" type="date" name="eventDate" required /></div>
            <div className="col field"><label className="label">Start</label><input className="input" type="time" name="startTime" /></div>
            <div className="col field"><label className="label">End</label><input className="input" type="time" name="endTime" /></div>
          </div>
          <div className="field"><label className="label">Location</label><input className="input" name="location" placeholder="e.g. Main gym / Field trip" /></div>
          <div className="field"><label className="label">Description</label><textarea className="textarea" name="description" /></div>
          <button className="btn btn-primary" type="submit">Add event</button>
        </form>
      </div>

      <div className="grid">
        {withMedia.map((e: any) => (
          <div className="card" key={e.id}>
            <div className="status-card">
              <div className="badge">{cap(e.event_date)}</div>
              <div className="muted small">{e.media_count} media</div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 17, marginTop: 8 }}>{e.title}</div>
            {e.start_time && <div className="muted small">{fmtTime(e.start_time)}{e.end_time ? ` – ${fmtTime(e.end_time)}` : ""}</div>}
            {e.location && <div className="muted small">📍 {e.location}</div>}
            {e.description && <p className="small mt-2">{e.description}</p>}
            {e.media.length > 0 && (
              <div className="row mt-2">
                {e.media.map((m: any) => (
                  <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
                    <img src={m.url} alt={m.caption ?? e.title} width={80} height={60} style={{ objectFit: "cover", borderRadius: 8 }} />
                  </a>
                ))}
              </div>
            )}
            {openId === e.id && (
              <form action={addEventMediaAction} className="mt-3 row">
                <input type="hidden" name="eventId" value={e.id} />
                <input className="input" name="url" placeholder="Media URL (photo/video)" required style={{ flex: 1 }} />
                <select className="select" name="kind" style={{ width: 110 }}>
                  <option value="image">Photo</option><option value="video">Video</option>
                </select>
                <button className="btn btn-ghost" type="submit">Attach</button>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}