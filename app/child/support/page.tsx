import { requireSession } from "@/lib/require";
import { ticketsForAccount } from "@/lib/store";
import { cap } from "@/lib/helpers";
import { createSupportTicketAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function ParentSupportPage({ searchParams }: { searchParams: { sent?: string } }) {
  const session = requireSession();
  const tickets = await ticketsForAccount(session.accountId);

  return (
    <div>
      <h1 className="title">Help &amp; support</h1>
      <div className="subtitle">Questions about your child&apos;s day, billing, or the app? Send a message below.</div>

      {searchParams.sent && <p className="badge badge-green mb-4" style={{ display: "inline-block" }}>✅ Sent. The daycare will reply here and by chat.</p>}

      <div className="grid mb-4">
        <div className="card">
          <h3 className="subtitle">Send a request</h3>
          <form action={createSupportTicketAction}>
            <div className="field"><label className="label">Subject</label><input className="input" name="subject" required placeholder="e.g. Question about my child's schedule" /></div>
            <div className="field"><label className="label">Message</label><textarea className="textarea" name="body" required /></div>
            <button className="btn btn-primary" type="submit">Send request</button>
          </form>
        </div>
        <div className="card">
          <h3 className="subtitle">My requests</h3>
          {tickets.length === 0 && <p className="muted small">No requests yet.</p>}
          {tickets.map((t: any) => (
            <div className="list-item small" key={t.id}>
              <div><strong>{t.subject}</strong><br /><span className="muted">{t.body}</span></div>
              <span className={t.status === "closed" ? "badge badge-gray" : t.status === "answered" ? "badge badge-green" : "badge"}>{cap(t.status)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="subtitle">Frequently asked questions</h3>
        <ul style={{ listStyle: "none" }}>
          <li className="list-item"><strong>How do I check my child in?</strong> <span className="muted small">Open your child&apos;s page and tap Check in, or staff can do it for you.</span></li>
          <li className="list-item"><strong>Where is the daily report?</strong> <span className="muted small">Your child&apos;s page shows today&apos;s report, newsfeed, and media.</span></li>
          <li className="list-item"><strong>Can I fix a wrong check-in time?</strong> <span className="muted small">Ask your daycare to edit it — staff can adjust the attendance record.</span></li>
          <li className="list-item"><strong>How do I add another family member?</strong> <span className="muted small">Share your invite code, or ask the daycare to send a new invite.</span></li>
        </ul>
      </div>
    </div>
  );
}