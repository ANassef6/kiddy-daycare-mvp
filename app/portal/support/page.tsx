import { requireSession } from "@/lib/require";
import { listSupportTickets } from "@/lib/store";
import { firstInstituteId, cap, fmtDate } from "@/lib/helpers";
import { setTicketStatusAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

function badge(s: string) {
  if (s === "closed") return "badge badge-gray";
  if (s === "answered") return "badge badge-green";
  return "badge";
}

export default async function PortalSupportPage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const tickets = await listSupportTickets(instituteId);

  return (
    <div>
      <h1 className="title">Support inbox</h1>
      <div className="subtitle">Parent help requests. Answer them here or in live chat; the parent sees the status.</div>
      {tickets.length === 0 && <p className="muted">No support requests yet.</p>}
      {tickets.map((t: any) => (
        <div className="card mb-4" key={t.id}>
          <div className="status-card">
            <div>
              <div style={{ fontWeight: 700 }}>{t.subject} <span className={`${badge(t.status)}`} style={{ marginLeft: 8 }}>{cap(t.status)}</span></div>
              <div className="muted small">{t.author_name ?? "Anonymous"} · {fmtDate(t.created_at)}</div>
              <p className="small mt-2">{t.body}</p>
            </div>
          </div>
          <form action={setTicketStatusAction} className="mt-2 row">
            <input type="hidden" name="ticketId" value={t.id} />
            <select className="select small" name="status" style={{ width: 160 }}>
              <option value="open" selected={t.status === "open"}>Open</option>
              <option value="answered" selected={t.status === "answered"}>Answered</option>
              <option value="closed" selected={t.status === "closed"}>Closed</option>
            </select>
            <button className="btn btn-ghost small" type="submit">Update</button>
          </form>
        </div>
      ))}
    </div>
  );
}