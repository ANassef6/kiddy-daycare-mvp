// KID-260: the staff support-ticket inbox moved from /portal/support, which is
// now the staff Help Center landing (Knowledge Base). The inbox stayed byte
// for byte as it was; it is the human escalation path referenced from the KB.
import { requireSession } from "@/lib/require";
import { listSupportTickets } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { setTicketStatusAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateFor, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function badge(s: string) {
  if (s === "closed") return "badge badge-gray";
  if (s === "answered") return "badge badge-green";
  return "badge";
}

export default async function PortalSupportInboxPage() {
  const session = await requireSession();
  const { dict, locale, timeZone } = await i18nForAccount(session.accountId);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{tr(dict, "learning.noInstitute")}</p>;
  const tickets = await listSupportTickets(instituteId);

  return (
    <div>
      <h1 className="title">{tr(dict, "supportInbox.title")}</h1>
      <div className="subtitle">{tr(dict, "supportInbox.subtitle")}</div>
      {tickets.length === 0 && <p className="muted">{tr(dict, "supportInbox.empty")}</p>}
      {tickets.map((t: any) => (
        <div className="card mb-4" key={t.id}>
          <div className="status-card">
            <div>
              <div style={{ fontWeight: 700 }}>{t.subject} <span className={`${badge(t.status)}`} style={{ marginLeft: 8 }}>{tr(dict, t.status === "closed" ? "supportInbox.statusClosed" : t.status === "answered" ? "supportInbox.statusAnswered" : "supportInbox.statusOpen")}</span></div>
              <div className="muted small">{t.author_name ?? tr(dict, "supportInbox.anonymous")} · {fmtDateFor(locale, t.created_at, timeZone)}</div>
              <p className="small mt-2">{t.body}</p>
            </div>
          </div>
          <form action={setTicketStatusAction} className="mt-2 row">
            <input type="hidden" name="ticketId" value={t.id} />
            <select className="select small" name="status" style={{ width: 160 }}>
              <option value="open" selected={t.status === "open"}>{tr(dict, "supportInbox.statusOpen")}</option>
              <option value="answered" selected={t.status === "answered"}>{tr(dict, "supportInbox.statusAnswered")}</option>
              <option value="closed" selected={t.status === "closed"}>{tr(dict, "supportInbox.statusClosed")}</option>
            </select>
            <button className="btn btn-ghost small" type="submit">{tr(dict, "supportInbox.update")}</button>
          </form>
        </div>
      ))}
    </div>
  );
}
