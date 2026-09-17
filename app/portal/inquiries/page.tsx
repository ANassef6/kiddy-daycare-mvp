import { requireSession } from "@/lib/require";
import { listContactRequests } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function PortalInquiriesPage() {
  requireSession();
  const requests = await listContactRequests();

  const newThisWeek = requests.filter((r: Record<string, unknown>) => {
    const at = r.created_at ? new Date(String(r.created_at)).getTime() : 0;
    return Date.now() - at < 7 * 24 * 3600 * 1000;
  }).length;

  return (
    <div>
      <h1 className="title">Inquiries</h1>
      <p className="subtitle">
        Demo bookings and questions submitted from the public site land here.
        Every &quot;Book a demo&quot; form on the marketing site writes a row to the
        <code> contact_request </code> table, and this page reads it.
      </p>

      <div className="grid mb-4">
        <div className="card">
          <div style={{ fontSize: 28, fontWeight: 800 }}>{requests.length}</div>
          <div className="muted">Total inquiries</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 28, fontWeight: 800 }}>{newThisWeek}</div>
          <div className="muted">New this week</div>
        </div>
      </div>

      {requests.length === 0 ? (
        <p className="muted">No inquiries yet. Submissions from the website will appear here.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Received</th>
              <th>Name</th>
              <th>Contact</th>
              <th>Type</th>
              <th>Message</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {requests.map((r: Record<string, unknown>) => {
              const email = String(r.email ?? "");
              const subject = encodeURIComponent("Re: your Kiddy demo request");
              return (
                <tr key={String(r.id)}>
                  <td className="small">{formatDate(r.created_at)}</td>
                  <td><strong>{String(r.name ?? "")}</strong></td>
                  <td className="small">
                    <a href={`mailto:${email}`}>{email}</a>
                    {r.phone ? <div className="muted">{String(r.phone)}</div> : null}
                  </td>
                  <td className="small">
                    <span className="badge">{String(r.role ?? "center")}</span>{" "}
                    <span className="badge badge-green">{String(r.interest ?? "demo")}</span>
                  </td>
                  <td className="small" style={{ maxWidth: 320 }}>
                    {r.message ? String(r.message) : <span className="muted">—</span>}
                  </td>
                  <td>
                    <a className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} href={`mailto:${email}?subject=${subject}`}>
                      Reply
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatDate(v: unknown): string {
  if (!v) return "—";
  return new Date(String(v)).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
